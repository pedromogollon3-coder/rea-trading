/* Indicadores de Trading Pedro (sin dependencias, para poder probarlos y evaluarlos aparte).
 * Los usan la app (app.js), el evaluador (evaluar.js) y las pruebas (pruebas.js): un solo
 * código, para que lo que se mide sea exactamente lo que se ve en pantalla.
 */
(function (global) {
  'use strict';

  function sma(v, p) {
    const out = new Array(v.length).fill(null); let s = 0;
    for (let i = 0; i < v.length; i++) {
      s += v[i]; if (i >= p) s -= v[i - p];
      if (i >= p - 1) out[i] = s / p;
    }
    return out;
  }
  function ema(v, p) {
    const out = new Array(v.length).fill(null);
    const first = v.findIndex((x) => x != null);
    if (first < 0 || v.length - first < p) return out;
    const k = 2 / (p + 1);
    let prev = 0;
    for (let i = first; i < first + p; i++) prev += v[i];
    prev /= p; out[first + p - 1] = prev;
    for (let i = first + p; i < v.length; i++) { prev = v[i] * k + prev * (1 - k); out[i] = prev; }
    return out;
  }
  function bollinger(v, p = 20, m = 2) {
    const mid = sma(v, p), up = [], lo = [];
    for (let i = 0; i < v.length; i++) {
      if (mid[i] == null) { up.push(null); lo.push(null); continue; }
      let s = 0;
      for (let j = i - p + 1; j <= i; j++) s += (v[j] - mid[i]) ** 2;
      const sd = Math.sqrt(s / p);
      up.push(mid[i] + m * sd); lo.push(mid[i] - m * sd);
    }
    return { mid, up, lo };
  }
  function rsi(v, p = 14) {
    const out = new Array(v.length).fill(null); let g = 0, l = 0;
    for (let i = 1; i < v.length; i++) {
      const d = v[i] - v[i - 1], G = Math.max(d, 0), L = Math.max(-d, 0);
      if (i <= p) { g += G; l += L; if (i < p) continue; g /= p; l /= p; }
      else { g = (g * (p - 1) + G) / p; l = (l * (p - 1) + L) / p; }
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }
  function macd(v) {
    const a = ema(v, 12), b = ema(v, 26);
    const m = v.map((_, i) => (a[i] != null && b[i] != null ? a[i] - b[i] : null));
    const s = ema(m, 9);
    const h = m.map((x, i) => (x != null && s[i] != null ? x - s[i] : null));
    return { m, s, h };
  }
  // Media móvil de Wilder (ta.rma de TradingView): arranca con la media simple de los primeros p.
  function rma(v, p) {
    const out = new Array(v.length).fill(null);
    const first = v.findIndex((x) => x != null);
    if (first < 0 || v.length - first < p) return out;
    let prev = 0;
    for (let i = first; i < first + p; i++) prev += v[i];
    prev /= p; out[first + p - 1] = prev;
    for (let i = first + p; i < v.length; i++) { prev = (prev * (p - 1) + v[i]) / p; out[i] = prev; }
    return out;
  }
  const trueRange = (cs) => cs.map((c, i) => (i === 0 ? c.high - c.low
    : Math.max(c.high - c.low, Math.abs(c.high - cs[i - 1].close), Math.abs(c.low - cs[i - 1].close))));
  // ADX con +DI y −DI (Wilder).
  function adx(cs, p = 14) {
    const n = cs.length, up = new Array(n).fill(null), dn = new Array(n).fill(null);
    for (let i = 1; i < n; i++) {
      const u = cs[i].high - cs[i - 1].high, d = cs[i - 1].low - cs[i].low;
      up[i] = u > d && u > 0 ? u : 0; dn[i] = d > u && d > 0 ? d : 0;
    }
    const tr = trueRange(cs); tr[0] = null;
    const atr = rma(tr, p), sUp = rma(up, p), sDn = rma(dn, p);
    const pdi = atr.map((a, i) => (a ? 100 * sUp[i] / a : null));
    const mdi = atr.map((a, i) => (a ? 100 * sDn[i] / a : null));
    const dx = pdi.map((x, i) => (x == null ? null : x + mdi[i] === 0 ? 0 : 100 * Math.abs(x - mdi[i]) / (x + mdi[i])));
    return { adx: rma(dx, p), pdi, mdi };
  }
  // Squeeze Momentum de LazyBear: Bollinger (20, 2) dentro del Keltner (20, 1,5) = compresión.
  function squeeze(cs, p = 20, mBB = 2, mKC = 1.5) {
    const close = cs.map((c) => c.close), bb = bollinger(close, p, mBB), rng = sma(trueRange(cs), p);
    const val = new Array(cs.length).fill(null), st = new Array(cs.length).fill(null), d = [];
    for (let i = 0; i < cs.length; i++) {
      if (bb.mid[i] == null) { d.push(null); continue; }
      let hi = -Infinity, lo = Infinity;
      for (let j = i - p + 1; j <= i; j++) { hi = Math.max(hi, cs[j].high); lo = Math.min(lo, cs[j].low); }
      d.push(close[i] - ((hi + lo) / 2 + bb.mid[i]) / 2);
      const kUp = bb.mid[i] + rng[i] * mKC, kLo = bb.mid[i] - rng[i] * mKC;
      st[i] = bb.lo[i] > kLo && bb.up[i] < kUp ? 'on' : bb.lo[i] < kLo && bb.up[i] > kUp ? 'off' : 'none';
      if (i < 2 * p - 2) continue;
      // regresión lineal de las últimas p diferencias, evaluada en la vela actual
      let sx = 0, sy = 0, sxy = 0, sxx = 0;
      for (let k = 0; k < p; k++) { const y = d[i - p + 1 + k]; sx += k; sy += y; sxy += k * y; sxx += k * k; }
      const slope = (p * sxy - sx * sy) / (p * sxx - sx * sx);
      val[i] = (sy - slope * sx) / p + slope * (p - 1);
    }
    return { val, st };
  }
  const monColor = (v, prev) => (v >= 0 ? (v >= (prev ?? v) ? 'vc' : 'vo') : (v < (prev ?? v) ? 'ro' : 'rc'));
  const atr = (cs, p = 14) => rma(trueRange(cs), p);

  // Perfil de volumen: el volumen de cada vela se reparte por igual entre los niveles de precio
  // que tocó. POC = nivel con más volumen; área de valor = 70 % del volumen alrededor del POC;
  // nodos = picos locales de volumen (al menos la mitad del POC).
  function vpvr(cs, n = 48) {
    if (!cs.length) return null;
    const lo = Math.min(...cs.map((c) => c.low)), hi = Math.max(...cs.map((c) => c.high));
    if (!(hi > lo)) return null;
    const step = (hi - lo) / n;
    const rows = Array.from({ length: n }, (_, i) => ({ p0: lo + i * step, p1: lo + (i + 1) * step, up: 0, down: 0 }));
    for (const c of cs) {
      const span = Math.max(c.high - c.low, step * 1e-6);
      const a = Math.min(n - 1, Math.floor((c.low - lo) / step)), b = Math.min(n - 1, Math.floor((c.high - lo) / step));
      for (let i = a; i <= b; i++) {
        const part = c.high === c.low ? 1 : (Math.min(c.high, rows[i].p1) - Math.max(c.low, rows[i].p0)) / span;
        rows[i][c.close >= c.open ? 'up' : 'down'] += c.volume * Math.max(0, part);
      }
    }
    rows.forEach((r) => { r.tot = r.up + r.down; r.mid = (r.p0 + r.p1) / 2; });
    let pi = 0;
    rows.forEach((r, i) => { if (r.tot > rows[pi].tot) pi = i; });
    const total = rows.reduce((s, r) => s + r.tot, 0);
    let a = pi, b = pi, inVa = rows[pi].tot;
    while (inVa < total * 0.7 && (a > 0 || b < n - 1)) {
      const da = a > 0 ? rows[a - 1].tot : -1, db = b < n - 1 ? rows[b + 1].tot : -1;
      if (db >= da) inVa += rows[++b].tot; else inVa += rows[--a].tot;
    }
    const max = rows[pi].tot;
    const nodes = rows.filter((r, i) => r.tot >= max * 0.5
      && r.tot >= (rows[i - 1]?.tot ?? 0) && r.tot >= (rows[i + 1]?.tot ?? 0)).map((r) => r.mid);
    return { rows, max, poc: rows[pi].mid, vah: rows[b].p1, val: rows[a].p0, nodes };
  }

  global.TPInd = { sma, ema, bollinger, rsi, macd, rma, trueRange, adx, squeeze, monColor, atr, vpvr };
  if (typeof module !== 'undefined') module.exports = global.TPInd;
})(typeof window !== 'undefined' ? window : globalThis);
