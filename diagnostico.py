"""Diagnostico de conexion a Binance para Trading Pedro. Solo lee, no cambia nada."""
import json
import platform
import sys
import time
import urllib.error
import urllib.request

HOSTS = ["https://data-api.binance.vision", "https://api.binance.com",
         "https://api-gcp.binance.com", "https://api1.binance.com"]

print("Python:", sys.version.split()[0], "|", platform.platform())
print("Hora UTC del equipo:", time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()))
print("Proxy detectado por Python:", urllib.request.getproxies() or "ninguno")
print()
for host in HOSTS:
    for extra in ("", "&endTime=1700000000000"):
        url = f"{host}/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3{extra}"
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                n = len(json.load(r))
            print(f"OK    {host}{' (con endTime)' if extra else ''}: {n} velas")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:200].replace("\n", " ")
            print(f"FALLO {host}{' (con endTime)' if extra else ''}: HTTP {e.code} {body}")
        except Exception as e:  # noqa: BLE001
            print(f"FALLO {host}{' (con endTime)' if extra else ''}: {e}")
print()
print("Toma una foto o captura de esta ventana y enviasela a Pedro.")
