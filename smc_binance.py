"""Descarga velas de Binance (API pública, sin clave) y las analiza con smartmoneyconcepts.

Uso:
    python smc_binance.py                       # BTCUSDT, 1h, 500 velas
    python smc_binance.py ETHUSDT 15m 1000
"""
import json
import os
import sys
import urllib.request

os.environ.setdefault("PYTHONUTF8", "1")

import pandas as pd
from smartmoneyconcepts import smc

HOSTS = ["https://api.binance.com", "https://data-api.binance.vision"]


def get_klines(symbol: str, interval: str, limit: int) -> pd.DataFrame:
    last_err = None
    for host in HOSTS:
        url = f"{host}/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}"
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                raw = json.load(r)
            break
        except Exception as e:  # noqa: BLE001
            last_err = e
    else:
        raise SystemExit(f"No se pudo descargar de Binance: {last_err}")

    df = pd.DataFrame(
        raw,
        columns=["time", "open", "high", "low", "close", "volume", "close_time",
                 "quote_vol", "trades", "taker_base", "taker_quote", "ignore"],
    )
    df["time"] = pd.to_datetime(df["time"], unit="ms")
    df = df.set_index("time")[["open", "high", "low", "close", "volume"]].astype(float)
    return df


def main() -> None:
    symbol = sys.argv[1].upper() if len(sys.argv) > 1 else "BTCUSDT"
    interval = sys.argv[2] if len(sys.argv) > 2 else "1h"
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else 500

    df = get_klines(symbol, interval, limit)
    print(f"{symbol} {interval}: {len(df)} velas, {df.index[0]} -> {df.index[-1]}")
    print(f"Último cierre: {df['close'].iloc[-1]:.2f}\n")

    swings = smc.swing_highs_lows(df, swing_length=10)
    fvg = smc.fvg(df)
    structure = smc.bos_choch(df, swings)
    ob = smc.ob(df, swings)

    n_fvg = fvg["FVG"].notna().sum()
    n_bos = structure["BOS"].notna().sum()
    n_choch = structure["CHOCH"].notna().sum()
    n_ob = ob["OB"].notna().sum()
    print(f"FVG detectados:        {n_fvg}")
    print(f"BOS (rupturas):        {n_bos}")
    print(f"CHOCH (cambios):       {n_choch}")
    print(f"Order blocks:          {n_ob}")

    # smc devuelve índices 0..n; se alinean con las fechas antes de unir.
    parts = [swings.add_prefix("swing_"), fvg.add_prefix("fvg_"),
             structure.add_prefix("struct_"), ob.add_prefix("ob_")]
    for p in parts:
        p.index = df.index
    out = df.join(parts)
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"{symbol}_{interval}_smc.csv")
    try:
        out.to_csv(path)
    except PermissionError:  # el archivo está abierto (p. ej. en Excel)
        path = path.replace(".csv", f"_{pd.Timestamp.now():%Y%m%d_%H%M}.csv")
        out.to_csv(path)
    print(f"\nResultado completo guardado en: {path}")
    print("Solo análisis sobre datos históricos; no es una recomendación de operar.")


if __name__ == "__main__":
    main()
