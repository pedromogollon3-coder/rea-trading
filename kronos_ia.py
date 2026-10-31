"""Predicción con Kronos, el modelo de IA para velas japonesas, dentro de Trading Pedro.

Kronos (https://github.com/shiyu-coder/Kronos, licencia MIT) aprendió el "lenguaje"
de las velas de más de 45 mercados. Aquí se le dan las últimas velas cerradas de
BTC/USDT y se le pide que imagine varios escenarios de las próximas velas; con
todos ellos se calcula el camino medio, el rango probable y la probabilidad de
que el precio termine más arriba.

Es opcional: necesita PyTorch (lo instala "4_Instalar IA Kronos.bat"). Si no está
instalado, Trading Pedro funciona igual y la tarjeta de Kronos lo explica.

Uso suelto (descarga el modelo y hace una prueba):
    python kronos_ia.py
"""
import os
import sys
import threading
import time

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "kronos"))  # código del modelo copiado de Kronos
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

# Kronos-small: 24,7 millones de parámetros, rápido en un procesador normal.
MODEL_NAME = "Kronos-small"
MODEL_ID = "NeoQuasar/Kronos-small"
TOKENIZER_ID = "NeoQuasar/Kronos-Tokenizer-base"
MAX_CONTEXT = 512  # velas que el modelo puede mirar hacia atrás

_predictor = None
_installed = None
_error = None
_loading = False
_load_lock = threading.Lock()
_run_lock = threading.Lock()  # una predicción a la vez: usan todos los núcleos
_cache = {}  # (temporalidad, velas, escenarios, desfase, última vela) -> resultado


def installed() -> bool:
    global _installed
    if _installed is None:
        try:
            import torch  # noqa: F401
            import einops  # noqa: F401
            import huggingface_hub  # noqa: F401
            import safetensors  # noqa: F401
            _installed = True
        except ImportError:
            _installed = False
    return _installed


def status() -> dict:
    return {"installed": installed(), "loaded": _predictor is not None, "loading": _loading,
            "model": MODEL_NAME, "error": _error}


def load():
    """Carga el modelo (la primera vez lo descarga de Hugging Face, unos 100 MB)."""
    global _predictor, _error, _loading
    if _predictor is not None:
        return _predictor
    if not installed():
        raise RuntimeError("Falta instalar la IA: abre \"4_Instalar IA Kronos.bat\"")
    with _load_lock:
        if _predictor is None:
            _loading = True
            try:
                import torch
                from model import Kronos, KronosPredictor, KronosTokenizer
                torch.set_grad_enabled(False)
                tokenizer = KronosTokenizer.from_pretrained(TOKENIZER_ID)
                model = Kronos.from_pretrained(MODEL_ID)
                model.eval()
                tokenizer.eval()
                _predictor = KronosPredictor(model, tokenizer, device="cpu", max_context=MAX_CONTEXT)
                _error = None
            except Exception as e:  # noqa: BLE001
                _error = f"No se pudo cargar Kronos: {e}"
                raise RuntimeError(_error) from e
            finally:
                _loading = False
    return _predictor


def _r(v):
    return [round(float(x), 2) for x in v]


def forecast(closed: pd.DataFrame, interval: str, step_sec: int, horizon: int,
             samples: int, offset: int = 0) -> dict:
    """Predice `horizon` velas a partir de las velas cerradas `closed`.

    Con `offset` > 0 se ignoran las últimas `offset` velas, para comparar la
    predicción con lo que de verdad pasó.
    """
    if offset:
        closed = closed.iloc[:-offset]
    closed = closed.tail(MAX_CONTEXT).reset_index(drop=True)
    if len(closed) < 100:
        raise ValueError("Hacen falta al menos 100 velas cerradas")
    base_time = int(closed["time"].iloc[-1])
    key = (interval, horizon, samples, offset, base_time)
    if key in _cache:
        return _cache[key]

    predictor = load()
    import torch

    x = closed[["open", "high", "low", "close", "volume"]]
    x_ts = pd.Series(pd.to_datetime(closed["time"], unit="s"))
    times = [base_time + step_sec * (k + 1) for k in range(horizon)]
    y_ts = pd.Series(pd.to_datetime(times, unit="s"))

    with _run_lock:
        # Misma semilla para la misma vela: repetir la predicción da lo mismo.
        torch.manual_seed(base_time)
        np.random.seed(base_time % (2 ** 32))
        t0 = time.time()
        # Cada copia de la serie es un escenario independiente, todos en un solo lote.
        paths = predictor.predict_batch([x] * samples, [x_ts] * samples, [y_ts] * samples,
                                        pred_len=horizon, T=1.0, top_p=0.9,
                                        sample_count=1, verbose=False)
        elapsed = time.time() - t0

    ohlc = np.stack([p[["open", "high", "low", "close"]].to_numpy() for p in paths])  # (escenarios, velas, 4)
    mean = ohlc.mean(axis=0)
    o, c = mean[:, 0], mean[:, 3]
    h = np.maximum(mean[:, 1], np.maximum(o, c))
    lo = np.minimum(mean[:, 2], np.minimum(o, c))
    closes = ohlc[:, :, 3]
    q10, q90 = np.percentile(closes, 10, axis=0), np.percentile(closes, 90, axis=0)
    base_close = float(closed["close"].iloc[-1])
    end = closes[:, -1]

    result = {
        "model": MODEL_NAME, "interval": interval, "horizon": horizon, "samples": samples,
        "offset": offset, "base_time": base_time, "base_close": round(base_close, 2),
        "context": len(closed), "times": times,
        "open": _r(o), "high": _r(h), "low": _r(lo), "close": _r(c),
        "q10": _r(q10), "q90": _r(q90),
        "p_up": round(float((end > base_close).mean()), 3),
        "end": {"mean": round(float(end.mean()), 2), "q10": round(float(q10[-1]), 2),
                "q90": round(float(q90[-1]), 2)},
        "elapsed": round(elapsed, 1), "made_at": int(time.time()),
    }
    if len(_cache) > 40:
        _cache.clear()
    _cache[key] = result
    return result


if __name__ == "__main__":
    import trading_pedro as tp
    print("Cargando Kronos (la primera vez se descarga, unos 100 MB)...")
    load()
    print("Modelo listo. Probando con BTC/USDT 1h...")
    df = tp.get_candles("1h", 600, max_age=0)
    r = forecast(df.iloc[:-1], "1h", 3600, 24, 8)
    print(f"Listo en {r['elapsed']} s. Cierre actual {r['base_close']:,.2f}; "
          f"en 24 h: {r['end']['mean']:,.2f} (rango {r['end']['q10']:,.2f} – {r['end']['q90']:,.2f}), "
          f"probabilidad de subir {r['p_up'] * 100:.0f} %")
