"""Trading Pedro: gráfico BTC/USDT en vivo con Smart Money Concepts y predicción IA (Kronos).

Uso:
    python trading_pedro.py              # abre http://127.0.0.1:8050 en el navegador
    python trading_pedro.py --no-browser
"""
import json
import math
import os
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("PYTHONUTF8", "1")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
import pandas as pd
from smartmoneyconcepts import smc

import kronos_ia

HOST, PORT = "127.0.0.1", 8050
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
SYMBOL = "BTCUSDT"
VERSION = "3.0 (31 oct 2026)"  # se muestra en la app; súbela en cada entrega
INTERVALS = {"1m", "5m", "15m", "1h", "4h", "1d"}
# data-api.binance.vision es el servidor de datos públicos de Binance; api.binance.com
# queda como respaldo (desde algunas ubicaciones responde 451).
BINANCE_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com",
                 "https://api-gcp.binance.com", "https://api1.binance.com"]
INTERVAL_SEC = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}

MAX_CANDLES = 3000
BINANCE_PAGE = 1000  # máximo de velas por petición en Binance

_cache = {}  # temporalidad -> DataFrame con las últimas velas
_cache_lock = threading.Lock()


_paused_until = 0.0  # Binance pidió pausar (429/418): no se consulta hasta esta hora


def _ban_until(e: urllib.error.HTTPError, body: str) -> float:
    """Fin del bloqueo según Binance ("IP banned until <ms>"), Retry-After o una pausa prudente."""
    m = re.search(r"until (\d{13})", body)
    if m:
        return int(m.group(1)) / 1000 + 2
    try:
        ra = float(e.headers.get("Retry-After") or 0)
    except ValueError:
        ra = 0
    return time.time() + (ra or (300 if e.code == 418 else 60)) + 2


def _fetch_page(interval: str, limit: int, end_time=None) -> list:
    global _paused_until
    if time.time() < _paused_until:
        hora = time.strftime("%H:%M", time.localtime(_paused_until))
        raise RuntimeError(f"Binance limitó las consultas; se reanudan a las {hora}")
    errors = []
    for host in BINANCE_HOSTS:
        url = f"{host}/api/v3/klines?symbol={SYMBOL}&interval={interval}&limit={limit}"
        if end_time is not None:
            url += f"&endTime={end_time}"
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            try:
                body = e.read().decode("utf-8", "replace")[:150]
            except Exception:  # noqa: BLE001
                body = ""
            if e.code in (418, 429):
                # Insistir durante un bloqueo lo alarga: se pausa todo hasta que termine.
                _paused_until = max(_paused_until, _ban_until(e, body))
                hora = time.strftime("%H:%M", time.localtime(_paused_until))
                print(f"[Binance] Pausa por exceso de consultas (HTTP {e.code}) hasta las {hora}.")
                raise RuntimeError(f"Binance limitó las consultas; se reanudan a las {hora}") from e
            errors.append(f"{host.split('//')[1]} -> HTTP {e.code} {body}")
        except Exception as e:  # noqa: BLE001
            errors.append(f"{host.split('//')[1]} -> {e}")
    raise RuntimeError("No se pudo descargar de Binance: " + " | ".join(errors))


def _to_df(raw: list) -> pd.DataFrame:
    df = pd.DataFrame([row[:6] for row in raw],
                      columns=["time", "open", "high", "low", "close", "volume"])
    df["time"] = df["time"] // 1000  # segundos UTC
    df = df.astype({c: float for c in ["open", "high", "low", "close", "volume"]})
    return df.drop_duplicates("time", keep="last").sort_values("time").reset_index(drop=True)


def get_klines(interval: str, limit: int) -> pd.DataFrame:
    """Descarga las últimas `limit` velas en bloques de 1000, los anteriores en paralelo."""
    first = _fetch_page(interval, min(BINANCE_PAGE, limit))
    raw = list(first)
    pages = math.ceil(limit / BINANCE_PAGE) - 1
    if first and len(first) == BINANCE_PAGE and pages > 0:
        step_ms = INTERVAL_SEC[interval] * 1000 * BINANCE_PAGE
        ends = [first[0][0] - 1 - k * step_ms for k in range(pages)]
        with ThreadPoolExecutor(max_workers=pages) as pool:
            for page in pool.map(lambda e: _fetch_page(interval, BINANCE_PAGE, e), ends):
                raw.extend(page)
    return _to_df(raw).tail(limit).reset_index(drop=True)


_fetched_at = {}  # temporalidad -> momento de la última actualización
_interval_locks = {iv: threading.Lock() for iv in INTERVAL_SEC}
REFRESH_EVERY = 15  # segundos que se reutiliza la caché sin preguntar a Binance


def get_candles(interval: str, limit: int, max_age: float = REFRESH_EVERY) -> pd.DataFrame:
    """Velas con caché: tras la primera descarga solo se piden las velas nuevas.

    Un candado por temporalidad evita descargar lo mismo dos veces cuando la
    precarga y una petición del navegador coinciden.
    """
    # Vía rápida sin esperar al candado: caché reciente y sin vela nueva desde entonces.
    with _cache_lock:
        cached = _cache.get(interval)
        age = time.time() - _fetched_at.get(interval, 0)
    if (cached is not None and len(cached) >= limit and age < max_age
            and time.time() < cached["time"].iloc[-1] + INTERVAL_SEC[interval]):
        return cached.tail(limit).reset_index(drop=True)

    with _interval_locks[interval]:
        with _cache_lock:
            cached = _cache.get(interval)
            age = time.time() - _fetched_at.get(interval, 0)
        if cached is not None and len(cached) >= limit:
            # Si ya empezó una vela nueva, la caché se actualiza aunque sea reciente,
            # para que Smart Money incluya la vela que acaba de cerrar.
            candle_open = time.time() < cached["time"].iloc[-1] + INTERVAL_SEC[interval]
            if age < max_age and candle_open:
                return cached.tail(limit).reset_index(drop=True)
            behind = (time.time() - cached["time"].iloc[-1]) / INTERVAL_SEC[interval]
            if behind < BINANCE_PAGE - 10:
                new = _to_df(_fetch_page(interval, int(behind) + 2))
                df = pd.concat([cached, new]).drop_duplicates("time", keep="last") \
                       .sort_values("time").tail(MAX_CANDLES).reset_index(drop=True)
                with _cache_lock:
                    _cache[interval], _fetched_at[interval] = df, time.time()
                return df.tail(limit).reset_index(drop=True)
        df = get_klines(interval, MAX_CANDLES)
        with _cache_lock:
            _cache[interval], _fetched_at[interval] = df, time.time()
        return df.tail(limit).reset_index(drop=True)


_smc_cache = {}  # (temporalidad, swing, nº velas) -> (última vela cerrada, resultado)


def get_smc(interval: str, df: pd.DataFrame, swing: int) -> dict:
    """Smart Money solo se recalcula cuando cierra una vela nueva."""
    key, last_closed = (interval, swing, len(df)), int(df["time"].iloc[-2])
    hit = _smc_cache.get(key)
    if hit and hit[0] == last_closed:
        return hit[1]
    result = compute_smc(df, swing)
    _smc_cache[key] = (last_closed, result)
    return result


def keep_warm(swing: int = 10):
    """Precarga todas las temporalidades y las mantiene al día en segundo plano."""
    def warm(iv):
        try:
            get_smc(iv, get_candles(iv, MAX_CANDLES, max_age=0), swing)
        except Exception as e:  # noqa: BLE001
            print(f"[precarga {iv}] {e}")

    order = ["15m", "1m", "5m", "1h", "4h", "1d"]  # primero la temporalidad por defecto
    while True:
        with ThreadPoolExecutor(max_workers=len(order)) as pool:
            list(pool.map(warm, order))
        time.sleep(REFRESH_EVERY)


def _num(v):
    if v is None:
        return None
    v = float(v)
    return None if math.isnan(v) else round(v, 2)


def compute_smc(df: pd.DataFrame, swing_length: int) -> dict:
    """Calcula SMC solo con velas cerradas (se excluye la vela en curso)."""
    closed = df.iloc[:-1].reset_index(drop=True)
    ohlc = closed[["open", "high", "low", "close", "volume"]]
    times = closed["time"].tolist()
    n = len(closed)

    def t(i):
        if i is None or (isinstance(i, float) and math.isnan(i)):
            return None
        i = int(i)
        return times[i] if 0 < i < n else None

    swings = smc.swing_highs_lows(ohlc, swing_length=swing_length)
    # El paquete fuerza un pico en la primera y la última vela para alternar;
    # no son picos reales, así que se eliminan antes de calcular lo demás.
    swings.loc[[0, n - 1], ["HighLow", "Level"]] = np.nan

    fvg = smc.fvg(ohlc)
    struct = smc.bos_choch(ohlc, swings, close_break=True)
    ob = smc.ob(ohlc, swings)
    liq = smc.liquidity(ohlc, swings)

    out = {"swings": [], "fvg": [], "structure": [], "ob": [], "liquidity": []}
    for i in range(n):
        if not math.isnan(swings["HighLow"][i]):
            out["swings"].append({"time": times[i], "dir": int(swings["HighLow"][i]),
                                  "level": _num(swings["Level"][i])})
        if not math.isnan(fvg["FVG"][i]):
            out["fvg"].append({"time": times[i], "dir": int(fvg["FVG"][i]),
                               "top": _num(fvg["Top"][i]), "bottom": _num(fvg["Bottom"][i]),
                               "mitigated": t(fvg["MitigatedIndex"][i])})
        for kind in ("BOS", "CHOCH"):
            if not math.isnan(struct[kind][i]):
                out["structure"].append({"time": times[i], "kind": kind,
                                         "dir": int(struct[kind][i]),
                                         "level": _num(struct["Level"][i]),
                                         "broken": t(struct["BrokenIndex"][i])})
        if not math.isnan(ob["OB"][i]):
            out["ob"].append({"time": times[i], "dir": int(ob["OB"][i]),
                              "top": _num(ob["Top"][i]), "bottom": _num(ob["Bottom"][i]),
                              "strength": _num(ob["Percentage"][i]),
                              "mitigated": t(ob["MitigatedIndex"][i])})
        if not math.isnan(liq["Liquidity"][i]):
            out["liquidity"].append({"time": times[i], "dir": int(liq["Liquidity"][i]),
                                     "level": _num(liq["Level"][i]),
                                     "end": t(liq["End"][i]),
                                     "swept": t(liq["Swept"][i])})
    return out


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def log_message(self, fmt, *args):  # silenciar el log de cada petición
        pass

    def end_headers(self):
        # La web se revalida siempre, para que tras una actualización el navegador
        # no siga usando una versión vieja de app.js o style.css.
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == "/api/data":
            return self.api_data(urllib.parse.parse_qs(url.query))
        if url.path == "/api/version":
            return self._json(200, {"version": VERSION})
        if url.path == "/api/kronos/status":
            return self._json(200, kronos_ia.status())
        if url.path == "/api/kronos":
            return self.api_kronos(urllib.parse.parse_qs(url.query))
        return super().do_GET()

    def api_kronos(self, q):
        try:
            interval = q.get("interval", ["1h"])[0]
            if interval not in INTERVALS:
                raise ValueError(f"Temporalidad no válida: {interval}")
            horizon = max(1, min(120, int(q.get("horizon", ["24"])[0])))
            samples = max(1, min(64, int(q.get("samples", ["16"])[0])))
            offset = max(0, min(1000, int(q.get("offset", ["0"])[0])))
            df = get_candles(interval, MAX_CANDLES, max_age=120)
            # solo velas cerradas: la vela en curso es la primera que se predice
            self._json(200, kronos_ia.forecast(df.iloc[:-1], interval, INTERVAL_SEC[interval],
                                               horizon, samples, offset))
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def api_data(self, q):
        try:
            interval = q.get("interval", ["1h"])[0]
            if interval not in INTERVALS:
                raise ValueError(f"Temporalidad no válida: {interval}")
            limit = max(100, min(MAX_CANDLES, int(q.get("limit", [str(MAX_CANDLES)])[0])))
            swing = max(2, min(100, int(q.get("swing", ["10"])[0])))
            # El precio en vivo llega al navegador por WebSocket; aquí basta una
            # caché de hasta 2 minutos (se renueva igual si cerró una vela).
            df = get_candles(interval, limit, max_age=120)
            body = {"symbol": SYMBOL, "interval": interval,
                    "candles": df.to_dict("records"),
                    "smc": get_smc(interval, df, swing)}
            self._json(200, body)
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _json(self, code, body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


class ExclusiveServer(ThreadingHTTPServer):
    # Sin esto, en Windows dos copias pueden escuchar en el mismo puerto a la vez.
    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):  # solo existe en Windows
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def running_version(url: str):
    """Versión de la copia que ya ocupa el puerto (None si es antigua o no responde)."""
    try:
        with urllib.request.urlopen(f"{url}/api/version", timeout=3) as r:
            return json.load(r).get("version")
    except Exception:  # noqa: BLE001
        return None


def preload_kronos():
    """Si la IA está instalada, el modelo se carga por detrás para que la primera predicción sea rápida."""
    if not kronos_ia.installed():
        return
    try:
        kronos_ia.load()
        print("IA Kronos lista.")
    except Exception as e:  # noqa: BLE001
        print(f"[Kronos] {e}")


def main():
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else PORT
    url = f"http://{HOST}:{port}"
    try:
        server = ExclusiveServer((HOST, port), Handler)
    except OSError:
        running = running_version(url)
        if running == VERSION:
            print(f"Trading Pedro ya está abierto en {url}; abriendo el navegador.")
            if "--no-browser" not in sys.argv:
                webbrowser.open(url)
        else:
            print("=" * 64)
            print(f"  Ya hay OTRA copia de Trading Pedro abierta ({running or 'versión antigua'}).")
            print(f"  Esta es la versión {VERSION}.")
            print()
            print("  Cierra todas las ventanas negras de Trading Pedro")
            print("  y vuelve a abrir este archivo.")
            print("  Si no encuentras la ventana, reinicia el equipo.")
            print("=" * 64)
        return
    print(f"Trading Pedro funcionando en {url}  (Ctrl+C para salir)")
    threading.Thread(target=keep_warm, daemon=True).start()
    threading.Thread(target=preload_kronos, daemon=True).start()
    if "--no-browser" not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nTrading Pedro detenido.")


if __name__ == "__main__":
    main()
