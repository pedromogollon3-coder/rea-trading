/* Datos para Trading Pedro sin servidor: descarga las velas de Binance desde el
 * navegador y calcula Smart Money con smc.js. Hace lo mismo que /api/data de
 * trading_pedro.py, para que la app funcione como un único archivo .html.
 */
(function () {
  'use strict';
  const SYMBOL = 'BTCUSDT';
  const IV_SEC = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
  const MAX = 3000, PAGE = 1000;
  const cache = {};   // temporalidad -> { candles, at }
  const pending = {}; // temporalidad -> promesa en curso (evita descargas duplicadas)
  const smcCache = {}; // `${iv}|${swing}` -> { lastClosed, smc }

  function fetchPage(interval, limit, endTime) {
    let path = `/api/v3/klines?symbol=${SYMBOL}&interval=${interval}&limit=${limit}`;
    if (endTime != null) path += `&endTime=${endTime}`;
    return window.TPBinance.getJson(path); // respeta los límites de Binance
  }

  const toCandles = (raw) => {
    const byTime = new Map();
    for (const k of raw) {
      byTime.set(Math.floor(k[0] / 1000), {
        time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
      });
    }
    return [...byTime.values()].sort((a, b) => a.time - b.time);
  };

  // Las últimas MAX velas: el bloque más reciente primero y los anteriores en paralelo.
  async function download(interval) {
    const first = await fetchPage(interval, PAGE);
    let raw = first.slice();
    const pages = Math.ceil(MAX / PAGE) - 1;
    if (first.length === PAGE && pages > 0) {
      const step = IV_SEC[interval] * 1000 * PAGE;
      const ends = Array.from({ length: pages }, (_, k) => first[0][0] - 1 - k * step);
      const rest = await Promise.all(ends.map((e) => fetchPage(interval, PAGE, e)));
      rest.forEach((p) => { raw = raw.concat(p); });
    }
    return toCandles(raw).slice(-MAX);
  }

  async function update(interval) {
    const c = cache[interval];
    if (c) {
      const behind = (Date.now() / 1000 - c.candles[c.candles.length - 1].time) / IV_SEC[interval];
      if (behind < PAGE - 10) {
        const fresh = toCandles(await fetchPage(interval, Math.floor(behind) + 2));
        const byTime = new Map(c.candles.map((k) => [k.time, k]));
        fresh.forEach((k) => byTime.set(k.time, k));
        const candles = [...byTime.values()].sort((a, b) => a.time - b.time).slice(-MAX);
        cache[interval] = { candles, at: Date.now() };
        return candles;
      }
    }
    const candles = await download(interval);
    cache[interval] = { candles, at: Date.now() };
    return candles;
  }

  // Caché de hasta 2 minutos; se renueva antes si ya empezó una vela nueva, para que
  // Smart Money incluya la vela que acaba de cerrar.
  async function getCandles(interval, maxAge = 120000) {
    const c = cache[interval];
    if (c && Date.now() - c.at < maxAge
        && Date.now() / 1000 < c.candles[c.candles.length - 1].time + IV_SEC[interval]) {
      return c.candles;
    }
    if (!pending[interval]) pending[interval] = update(interval).finally(() => { delete pending[interval]; });
    return pending[interval];
  }

  function getSmc(interval, candles, swing) {
    const key = `${interval}|${swing}`, lastClosed = candles[candles.length - 2].time;
    const hit = smcCache[key];
    if (hit && hit.lastClosed === lastClosed && hit.n === candles.length) return hit.smc;
    const smc = window.SMC.computeSmc(candles, swing);
    smcCache[key] = { lastClosed, n: candles.length, smc };
    return smc;
  }

  async function getData(interval, swing) {
    if (!IV_SEC[interval]) throw new Error(`Temporalidad no válida: ${interval}`);
    const candles = await getCandles(interval);
    return { symbol: SYMBOL, interval, candles, smc: getSmc(interval, candles, swing) };
  }

  // Precarga de las demás temporalidades, una tras otra, para cambiar al instante.
  let warmed = false;
  function warm(swing) {
    if (warmed) return;
    warmed = true;
    const order = ['15m', '1m', '5m', '1h', '4h', '1d'];
    (async () => {
      for (const iv of order) {
        try { getSmc(iv, await getCandles(iv), swing); } catch { /* se reintenta al pedirla */ }
      }
    })();
  }

  window.TP_DATA = { getData, warm };
})();
