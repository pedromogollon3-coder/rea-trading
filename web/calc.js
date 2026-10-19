/* Calculadora de riesgo de Trading Pedro (sin dependencias, para poder probarla aparte).
 *
 * Dada la entrada, el stop, el objetivo y el dinero que se acepta perder, calcula el
 * tamaño de la posición, la pérdida en el stop, la ganancia en el objetivo (con una
 * salida parcial opcional) y la relación riesgo/beneficio. La comisión se cobra sobre
 * el valor de la operación al entrar y al salir (en Quantfury es 0).
 */
(function (global) {
  'use strict';

  /**
   * @param {object} c
   * @param {'long'|'short'} c.side
   * @param {number} c.entry  @param {number} c.stop  @param {number} [c.target]
   * @param {number} c.risk   dólares que se aceptan perder si toca el stop
   * @param {number} [c.feePct] comisión en % por operación (0,1 = 0,1 %)
   * @param {number} [c.tp1]  objetivo parcial  @param {number} [c.tp1Pct] % que se cierra en tp1
   * @returns {{error:string}|object}
   */
  function compute(c) {
    const E = c.entry, S = c.stop, T = c.target, R = c.risk;
    const f = (c.feePct || 0) / 100;
    const dir = c.side === 'short' ? -1 : 1;
    const ok = (v) => typeof v === 'number' && isFinite(v) && v > 0;
    if (!ok(E) || !ok(S)) return { error: 'Escribe el precio de entrada y el del stop.' };
    if (!ok(R)) return { error: 'Escribe cuánto dinero aceptas perder.' };
    if ((E - S) * dir <= 0) {
      return { error: dir === 1 ? 'En largo el stop va por debajo de la entrada.' : 'En corto el stop va por encima de la entrada.' };
    }
    const fees = (exit) => f * (E + exit); // comisión por unidad: entrada + salida
    const lossPerUnit = Math.abs(E - S) + fees(S);
    const size = R / lossPerUnit;
    const out = {
      side: c.side === 'short' ? 'short' : 'long',
      size, notional: size * E,
      loss: R, stopPct: (Math.abs(E - S) / E) * 100,
      feesAtStop: size * fees(S),
    };
    if (T == null || T === '' || !isFinite(T)) return out;
    if (!ok(T) || (T - E) * dir <= 0) {
      return { ...out, error: dir === 1 ? 'En largo el objetivo va por encima de la entrada.' : 'En corto el objetivo va por debajo de la entrada.' };
    }
    const gain = (exit) => Math.abs(exit - E) - fees(exit); // ganancia neta por unidad
    let profit = size * gain(T), feesAtTarget = size * fees(T), partial = null;
    if (c.tp1 != null && isFinite(c.tp1) && c.tp1Pct > 0 && c.tp1Pct < 100) {
      if ((c.tp1 - E) * dir <= 0 || (T - c.tp1) * dir <= 0) {
        return { ...out, error: 'El objetivo 1 tiene que estar entre la entrada y el objetivo final.' };
      }
      const q = c.tp1Pct / 100;
      const p1 = size * q * gain(c.tp1), p2 = size * (1 - q) * gain(T);
      partial = { profit1: p1, profit2: p2, size1: size * q, size2: size * (1 - q) };
      profit = p1 + p2;
      feesAtTarget = size * q * fees(c.tp1) + size * (1 - q) * fees(T);
    }
    const rr = profit / R;
    return {
      ...out,
      profit, targetPct: (Math.abs(T - E) / E) * 100, feesAtTarget, partial,
      rr,
      // con este R:R, porcentaje de operaciones que hay que acertar para no perder dinero
      breakEvenWinRate: rr > 0 ? 100 / (1 + rr) : 100,
    };
  }

  /**
   * Comprueba si una vela cierra una operación de práctica.
   * Criterio prudente: si la vela toca el stop y el objetivo a la vez, cuenta el stop.
   * Si la vela abre ya más allá del stop (hueco), sale al precio de apertura.
   * @param {{side:'long'|'short', entry:number, stop:number, target:number, size:number, risk:number}} t
   * @param {{open:number, high:number, low:number}} k
   * @returns {null|{result:'stop'|'target', exit:number, pnl:number, r:number}}
   */
  function settle(t, k, feePct) {
    const f = (feePct || 0) / 100, dir = t.side === 'short' ? -1 : 1;
    const hitStop = dir === 1 ? k.low <= t.stop : k.high >= t.stop;
    const hitTarget = t.target != null && (dir === 1 ? k.high >= t.target : k.low <= t.target);
    if (!hitStop && !hitTarget) return null;
    let result, exit;
    if (hitStop) {
      result = 'stop';
      const gapped = dir === 1 ? k.open < t.stop : k.open > t.stop;
      exit = gapped ? k.open : t.stop;
    } else {
      result = 'target';
      const gapped = dir === 1 ? k.open > t.target : k.open < t.target;
      exit = gapped ? k.open : t.target;
    }
    const pnl = dir * (exit - t.entry) * t.size - f * t.size * (t.entry + exit);
    return { result, exit, pnl, r: t.risk ? pnl / t.risk : 0 };
  }

  global.TPCalc = { compute, settle };
  if (typeof module !== 'undefined') module.exports = global.TPCalc;
})(typeof window !== 'undefined' ? window : globalThis);
