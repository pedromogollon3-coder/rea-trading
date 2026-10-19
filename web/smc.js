/* Smart Money Concepts en JavaScript.
 * Traducción fiel de smartmoneyconcepts 0.0.27 (swing_highs_lows, fvg, bos_choch, ob,
 * liquidity), para que Trading Pedro funcione en el navegador sin Python.
 * Recibe velas { time, open, high, low, close, volume } y devuelve lo mismo que
 * compute_smc() de trading_pedro.py.
 */
(function (global) {
  'use strict';

  // Swings: el máximo (mínimo) más alto (bajo) de las `len` velas anteriores y posteriores.
  function swingHighsLows(c, len) {
    const n = c.length, hl = new Array(n).fill(null);
    // Igual que pandas: high == high.shift(-len).rolling(2*len).max(), que exige la
    // ventana completa: i >= 2*len - 1 e i + len <= n - 1.
    for (let i = 2 * len - 1; i + len <= n - 1; i++) {
      let mx = -Infinity, mn = Infinity;
      for (let k = i - len + 1; k <= i + len; k++) {
        if (c[k].high > mx) mx = c[k].high;
        if (c[k].low < mn) mn = c[k].low;
      }
      if (c[i].high === mx) hl[i] = 1;
      else if (c[i].low === mn) hl[i] = -1;
    }
    // Se eliminan swings consecutivos del mismo tipo, dejando el más extremo.
    for (;;) {
      const pos = [];
      for (let i = 0; i < n; i++) if (hl[i] !== null) pos.push(i);
      if (pos.length < 2) break;
      const remove = new Array(pos.length).fill(false);
      for (let k = 0; k < pos.length - 1; k++) {
        const a = pos[k], b = pos[k + 1];
        if (hl[a] === 1 && hl[b] === 1) {
          if (c[a].high < c[b].high) remove[k] = true; else remove[k + 1] = true;
        } else if (hl[a] === -1 && hl[b] === -1) {
          if (c[a].low > c[b].low) remove[k] = true; else remove[k + 1] = true;
        }
      }
      if (!remove.some(Boolean)) break;
      pos.forEach((p, k) => { if (remove[k]) hl[p] = null; });
    }
    // El paquete fuerza además un swing en la primera y la última vela para alternar;
    // no son picos reales y trading_pedro.py los descarta, así que aquí no se añaden.
    const level = hl.map((d, i) => (d === null ? null : d === 1 ? c[i].high : c[i].low));
    return { hl, level };
  }

  function fvg(c) {
    const n = c.length, out = [];
    for (let i = 1; i < n - 1; i++) {
      const bull = c[i].close > c[i].open;
      const isBull = c[i - 1].high < c[i + 1].low && bull;
      const isBear = c[i - 1].low > c[i + 1].high && c[i].close < c[i].open;
      if (!isBull && !isBear) continue;
      const dir = bull ? 1 : -1;
      const top = bull ? c[i + 1].low : c[i - 1].low;
      const bottom = bull ? c[i - 1].high : c[i + 1].high;
      let mitigated = 0;
      for (let j = i + 2; j < n; j++) {
        if (dir === 1 ? c[j].low <= top : c[j].high >= bottom) { mitigated = j; break; }
      }
      out.push({ i, dir, top, bottom, mitigated });
    }
    return out;
  }

  function bosChoch(c, sw) {
    const n = c.length;
    // Float32Array: el paquete guarda los niveles en float32 y compara contra ellos.
    const bos = new Int8Array(n), choch = new Int8Array(n), level = new Float32Array(n);
    const lv = [], hls = [], last = [];
    const is = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    for (let i = 0; i < n; i++) {
      if (sw.hl[i] === null) continue;
      lv.push(sw.level[i]); hls.push(sw.hl[i]);
      if (lv.length >= 4) {
        const p = last[last.length - 2];
        const h4 = hls.slice(-4);
        const [L0, L1, L2, L3] = lv.slice(-4); // [-4], [-3], [-2], [-1]
        const up = is(h4, [-1, 1, -1, 1]), down = is(h4, [1, -1, 1, -1]);
        bos[p] = up && L0 < L2 && L2 < L1 && L1 < L3 ? 1 : 0;
        level[p] = bos[p] !== 0 ? L1 : 0;
        bos[p] = down && L0 > L2 && L2 > L1 && L1 > L3 ? -1 : bos[p];
        level[p] = bos[p] !== 0 ? L1 : 0;
        choch[p] = up && L3 > L1 && L1 > L0 && L0 > L2 ? 1 : 0;
        level[p] = choch[p] !== 0 ? L1 : level[p];
        choch[p] = down && L3 < L1 && L1 < L0 && L0 < L2 ? -1 : choch[p];
        level[p] = choch[p] !== 0 ? L1 : level[p];
      }
      last.push(i);
    }
    const broken = new Int32Array(n);
    const active = () => { const r = []; for (let i = 0; i < n; i++) if (bos[i] || choch[i]) r.push(i); return r; };
    for (const i of active()) {
      let j = 0;
      if (bos[i] === 1 || choch[i] === 1) {
        for (let k = i + 2; k < n; k++) if (c[k].close > level[i]) { j = k; break; }
      } else if (bos[i] === -1 || choch[i] === -1) {
        for (let k = i + 2; k < n; k++) if (c[k].close < level[i]) { j = k; break; }
      }
      if (j) {
        broken[i] = j;
        // se descartan los niveles anteriores que se rompieron a la vez o después
        for (const k of active()) {
          if (k < i && broken[k] >= j) { bos[k] = 0; choch[k] = 0; level[k] = 0; }
        }
      }
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      if (!(bos[i] || choch[i])) continue;
      if (broken[i] === 0) continue; // sin romper: se descarta
      if (bos[i]) out.push({ i, kind: 'BOS', dir: bos[i], level: level[i], broken: broken[i] });
      if (choch[i]) out.push({ i, kind: 'CHOCH', dir: choch[i], level: level[i], broken: broken[i] });
    }
    return out;
  }

  function orderBlocks(c, sw) {
    const n = c.length;
    const crossed = new Uint8Array(n), breaker = new Uint8Array(n);
    const ob = new Int8Array(n), top = new Float32Array(n), bottom = new Float32Array(n);
    const pct = new Float32Array(n), mitig = new Int32Array(n);
    const highs = [], lows = [];
    for (let i = 0; i < n; i++) { if (sw.hl[i] === 1) highs.push(i); else if (sw.hl[i] === -1) lows.push(i); }
    // último índice de `arr` estrictamente menor que x (np.searchsorted por la izquierda)
    const lastBefore = (arr, x) => {
      let lo = 0, hi = arr.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
      return lo > 0 ? arr[lo - 1] : null;
    };
    const reset = (idx) => { ob[idx] = 0; top[idx] = 0; bottom[idx] = 0; mitig[idx] = 0; pct[idx] = 0; };
    const strength = (hiV, loV) => { const mx = Math.max(hiV, loV); return mx !== 0 ? (Math.min(hiV, loV) / mx) * 100 : 100; };
    const vol = (k) => (k >= 0 ? c[k].volume : 0);

    let activeBull = [];
    for (let i = 0; i < n; i++) {
      for (const idx of activeBull.slice()) {
        if (breaker[idx]) {
          if (c[i].high > top[idx]) { reset(idx); activeBull = activeBull.filter((x) => x !== idx); }
        } else if (c[i].low < bottom[idx]) { breaker[idx] = 1; mitig[idx] = i - 1; }
      }
      const t = lastBefore(highs, i);
      if (t !== null && c[i].close > c[t].high && !crossed[t]) {
        crossed[t] = 1;
        let obIndex = i - 1, obBtm = c[i - 1].high, obTop = c[i - 1].low;
        if (i - t > 1) {
          let mn = Infinity, cand = -1;
          for (let k = t + 1; k < i; k++) if (c[k].low <= mn) { mn = c[k].low; cand = k; } // empate: el último
          if (cand >= 0) { obBtm = c[cand].low; obTop = c[cand].high; obIndex = cand; }
        }
        ob[obIndex] = 1; top[obIndex] = obTop; bottom[obIndex] = obBtm;
        pct[obIndex] = strength(vol(i) + vol(i - 1), vol(i - 2));
        activeBull.push(obIndex);
      }
    }

    let activeBear = [];
    for (let i = 0; i < n; i++) {
      for (const idx of activeBear.slice()) {
        if (breaker[idx]) {
          if (c[i].low < bottom[idx]) { reset(idx); activeBear = activeBear.filter((x) => x !== idx); }
        } else if (c[i].high > top[idx]) { breaker[idx] = 1; mitig[idx] = i; }
      }
      const b = lastBefore(lows, i);
      if (b !== null && c[i].close < c[b].low && !crossed[b]) {
        crossed[b] = 1;
        let obIndex = i - 1, obTop = c[i - 1].high, obBtm = c[i - 1].low;
        if (i - b > 1) {
          let mx = -Infinity, cand = -1;
          for (let k = b + 1; k < i; k++) if (c[k].high >= mx) { mx = c[k].high; cand = k; }
          if (cand >= 0) { obTop = c[cand].high; obBtm = c[cand].low; obIndex = cand; }
        }
        ob[obIndex] = -1; top[obIndex] = obTop; bottom[obIndex] = obBtm;
        pct[obIndex] = strength(vol(i - 2), vol(i) + vol(i - 1));
        activeBear.push(obIndex);
      }
    }

    const out = [];
    for (let i = 0; i < n; i++) {
      if (ob[i]) out.push({ i, dir: ob[i], top: top[i], bottom: bottom[i], strength: pct[i], mitigated: mitig[i] });
    }
    return out;
  }

  function liquidity(c, sw, rangePercent = 0.01) {
    const n = c.length;
    let hi = -Infinity, lo = Infinity;
    for (const k of c) { if (k.high > hi) hi = k.high; if (k.low < lo) lo = k.low; }
    const pip = (hi - lo) * rangePercent;
    const hl = sw.hl.slice(), lvl = sw.level;
    const out = [];
    for (const dir of [1, -1]) {
      const idxs = [];
      for (let i = 0; i < n; i++) if (hl[i] === dir) idxs.push(i);
      for (const i of idxs) {
        if (hl[i] !== dir) continue;
        const rLow = lvl[i] - pip, rHigh = lvl[i] + pip;
        const group = [lvl[i]];
        let end = i, swept = 0;
        for (let k = i + 1; k < n; k++) {
          if (dir === 1 ? c[k].high >= rHigh : c[k].low <= rLow) { swept = k; break; }
        }
        for (const j of idxs) {
          if (j <= i) continue;
          if (swept && j >= swept) break;
          if (hl[j] === dir && lvl[j] >= rLow && lvl[j] <= rHigh) { group.push(lvl[j]); end = j; hl[j] = 0; }
        }
        if (group.length > 1) {
          out.push({ i, dir, level: Math.fround(group.reduce((a, b) => a + b, 0) / group.length), end, swept });
        }
      }
    }
    return out.sort((a, b) => a.i - b.i);
  }

  const round2 = (v) => (v == null || isNaN(v) ? null : Math.round(v * 100) / 100);

  /** Igual que compute_smc() de trading_pedro.py: solo velas cerradas (sin la última). */
  function computeSmc(candles, swingLength) {
    const c = candles.slice(0, -1), n = c.length;
    const T = (i) => (i && i > 0 && i < n ? c[i].time : null);
    const sw = swingHighsLows(c, swingLength);
    const out = { swings: [], fvg: [], structure: [], ob: [], liquidity: [] };
    sw.hl.forEach((d, i) => { if (d !== null) out.swings.push({ time: c[i].time, dir: d, level: round2(sw.level[i]) }); });
    fvg(c).forEach((z) => out.fvg.push({ time: c[z.i].time, dir: z.dir, top: round2(z.top), bottom: round2(z.bottom), mitigated: T(z.mitigated) }));
    bosChoch(c, sw).forEach((e) => out.structure.push({ time: c[e.i].time, kind: e.kind, dir: e.dir, level: round2(e.level), broken: T(e.broken) }));
    orderBlocks(c, sw).forEach((z) => out.ob.push({ time: c[z.i].time, dir: z.dir, top: round2(z.top), bottom: round2(z.bottom), strength: round2(z.strength), mitigated: T(z.mitigated) }));
    liquidity(c, sw).forEach((l) => out.liquidity.push({ time: c[l.i].time, dir: l.dir, level: round2(l.level), end: T(l.end), swept: T(l.swept) }));
    return out;
  }

  global.SMC = { computeSmc, swingHighsLows, fvg, bosChoch, orderBlocks, liquidity };
  if (typeof module !== 'undefined') module.exports = global.SMC;
})(typeof window !== 'undefined' ? window : globalThis);
