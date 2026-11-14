/* Pruebas de Trading Pedro: comprueban que un cambio no rompió lo que ya funcionaba.
 *
 * Uso:
 *   node pruebas.js                 corre todas las pruebas
 *   node pruebas.js --actualizar    guarda los valores actuales como referencia
 *                                   (solo cuando un cálculo se cambió A PROPÓSITO)
 *
 * Los valores de referencia están en pruebas/referencia.json y salen de 500 velas fijas
 * (BTCUSDT_1h_smc.csv). Si una prueba falla sin haber tocado ese cálculo, el cambio rompió algo.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

globalThis.window = globalThis;
const IND = require('./web/indicadores.js');
const SMC = require('./web/smc.js');
const CALC = require('./web/calc.js');
require('./web/tradinglatino.js');
const EV = require('./evaluar.js');

const REF = path.join(__dirname, 'pruebas', 'referencia.json');
const ACTUALIZAR = process.argv.includes('--actualizar');

// 500 velas fijas de 1H
const velas = fs.readFileSync(path.join(__dirname, 'BTCUSDT_1h_smc.csv'), 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).slice(1).map((l) => {
  const p = l.split(',');
  return { time: Date.parse(p[0].replace(' ', 'T') + 'Z') / 1000, open: +p[1], high: +p[2], low: +p[3], close: +p[4], volume: +p[5] };
});
const r6 = (v) => (v == null ? null : Math.round(v * 1e6) / 1e6);
const cola = (a, n = 5) => a.slice(-n).map(r6);

function valoresActuales() {
  const close = velas.map((c) => c.close);
  const ad = IND.adx(velas), sq = IND.squeeze(velas), md = IND.macd(close), bb = IND.bollinger(close), vp = IND.vpvr(velas.slice(-150), 48);
  const smc = SMC.computeSmc(velas, 10);
  const stInd = { ema: IND.ema, squeeze: IND.squeeze, adx: IND.adx, atr: IND.atr, vpvr: IND.vpvr, monColor: IND.monColor, fmt: (v) => v.toFixed(2) };
  const tl = globalThis.TPStrategies.tradingLatino.analyze({ '1h': velas, '4h': EV.agrupar(velas, 14400) }, stInd);
  const lectura = (r) => r && {
    tendencia: r.trend, monitor: r.mon, adx: r6(r.adx), adxSube: r.adxUp, proyeccion: r.projection,
    largo: r.long.map((c) => c.ok), corto: r.short.map((c) => c.ok), notas: r.notes.length,
  };
  return {
    indicadores: {
      ema10: cola(IND.ema(close, 10)), ema55: cola(IND.ema(close, 55)), sma200: cola(IND.sma(close, 200)),
      rsi: cola(IND.rsi(close)), macd: cola(md.h), bollingerSup: cola(bb.up), atr: cola(IND.atr(velas)),
      adx: cola(ad.adx), masDI: cola(ad.pdi), menosDI: cola(ad.mdi),
      squeeze: cola(sq.val), compresion: sq.st.slice(-5),
      poc: r6(vp.poc), areaValor: [r6(vp.val), r6(vp.vah)], nodos: vp.nodes.map(r6),
    },
    smc: {
      cuantos: { swings: smc.swings.length, fvg: smc.fvg.length, estructura: smc.structure.length, ob: smc.ob.length, liquidez: smc.liquidity.length },
      ultimos: { swing: smc.swings.at(-1), fvg: smc.fvg.at(-1), estructura: smc.structure.at(-1), ob: smc.ob.at(-1), liquidez: smc.liquidity.at(-1) },
    },
    tradingLatino: { '1h': lectura(tl.reads['1h']), '4h': lectura(tl.reads['4h']), plan: tl.plan && { lado: tl.plan.side, falta: tl.plan.missing || null } },
  };
}

if (ACTUALIZAR) {
  fs.mkdirSync(path.dirname(REF), { recursive: true });
  fs.writeFileSync(REF, JSON.stringify(valoresActuales(), null, 1));
  console.log('Referencia actualizada: pruebas' + path.sep + 'referencia.json');
  return;
}

test('los cálculos dan lo mismo que la referencia', () => {
  assert.ok(fs.existsSync(REF), 'Falta pruebas/referencia.json: ejecuta  node pruebas.js --actualizar');
  const ref = JSON.parse(fs.readFileSync(REF, 'utf8'));
  const hoy = JSON.parse(JSON.stringify(valoresActuales()));
  for (const bloque of Object.keys(ref)) {
    for (const clave of Object.keys(ref[bloque])) {
      assert.deepStrictEqual(hoy[bloque][clave], ref[bloque][clave], `cambió ${bloque} → ${clave}`);
    }
  }
});

test('indicadores: propiedades que siempre deben cumplirse', () => {
  const plano = new Array(100).fill(50);
  assert.strictEqual(IND.ema(plano, 10).at(-1), 50, 'la EMA de un precio fijo es ese precio');
  assert.strictEqual(IND.sma(plano, 20).at(-1), 50);
  const sube = Array.from({ length: 60 }, (_, i) => 100 + i);
  assert.strictEqual(IND.rsi(sube).at(-1), 100, 'si el precio solo sube, el RSI es 100');
  const close = velas.map((c) => c.close);
  for (const v of IND.rsi(close)) assert.ok(v == null || (v >= 0 && v <= 100), 'RSI entre 0 y 100');
  const ad = IND.adx(velas);
  for (const v of ad.adx) assert.ok(v == null || (v >= 0 && v <= 100), 'ADX entre 0 y 100');
  for (const v of IND.atr(velas)) assert.ok(v == null || v > 0, 'ATR positivo');
  const e10 = IND.ema(close, 10), lo = Math.min(...close), hi = Math.max(...close);
  for (const v of e10) assert.ok(v == null || (v >= lo && v <= hi), 'la EMA queda dentro del rango de precios');
  const vp = IND.vpvr(velas, 48);
  assert.ok(vp.val <= vp.poc && vp.poc <= vp.vah, 'el POC está dentro del área de valor');
  const total = vp.rows.reduce((s, r) => s + r.tot, 0), vol = velas.reduce((s, c) => s + c.volume, 0);
  assert.ok(Math.abs(total - vol) / vol < 1e-9, 'el perfil reparte todo el volumen, sin perder ni inventar');
  assert.strictEqual(IND.monColor(2, 1), 'vc'); assert.strictEqual(IND.monColor(1, 2), 'vo');
  assert.strictEqual(IND.monColor(-2, -1), 'ro'); assert.strictEqual(IND.monColor(-1, -2), 'rc');
});

test('indicadores: no miran el futuro', () => {
  // el valor en una vela no puede cambiar al añadir velas posteriores
  const corte = 400, a = velas.slice(0, corte), ca = a.map((c) => c.close), cb = velas.map((c) => c.close);
  const igual = (x, y, n) => assert.strictEqual(r6(x[corte - 1]), r6(y[corte - 1]), n);
  igual(IND.ema(ca, 55), IND.ema(cb, 55), 'EMA 55');
  igual(IND.rsi(ca), IND.rsi(cb), 'RSI');
  igual(IND.adx(a).adx, IND.adx(velas).adx, 'ADX');
  igual(IND.squeeze(a).val, IND.squeeze(velas).val, 'Squeeze');
  igual(IND.atr(a), IND.atr(velas), 'ATR');
});

test('calculadora de riesgo', () => {
  const c = CALC.compute({ side: 'long', entry: 100, stop: 95, target: 110, risk: 50 });
  assert.strictEqual(c.size, 10); assert.strictEqual(c.rr, 2); assert.strictEqual(c.profit, 100);
  assert.ok(Math.abs(c.breakEvenWinRate - 100 / 3) < 1e-9);
  const s = CALC.compute({ side: 'short', entry: 100, stop: 104, target: 92, risk: 40 });
  assert.strictEqual(s.size, 10); assert.strictEqual(s.rr, 2);
  assert.ok(CALC.compute({ side: 'long', entry: 100, stop: 105, risk: 10 }).error, 'stop del lado equivocado');
  const t = { side: 'long', entry: 100, stop: 95, target: 110, size: 10, risk: 50 };
  assert.strictEqual(CALC.settle(t, { open: 100, high: 104, low: 96 }), null);
  assert.strictEqual(CALC.settle(t, { open: 100, high: 111, low: 94 }).result, 'stop', 'si toca los dos, cuenta el stop');
  assert.strictEqual(CALC.settle(t, { open: 100, high: 111, low: 99 }).r, 2);
  assert.strictEqual(CALC.settle(t, { open: 93, high: 94, low: 92 }).exit, 93, 'con hueco, sale a la apertura');
});

test('evaluador: las velas de 4H se arman bien y no se mira el futuro', (t) => {
  const g = EV.agrupar(velas, 14400);
  const completas = g.filter((c) => c.ultima - c.primera === 3);
  for (const c of completas) {
    const h = velas.slice(c.primera, c.ultima + 1);
    assert.strictEqual(c.open, h[0].open); assert.strictEqual(c.close, h[3].close);
    assert.strictEqual(c.high, Math.max(...h.map((x) => x.high))); assert.strictEqual(c.low, Math.min(...h.map((x) => x.low)));
  }
  const v1 = EV.leerDatos('BTCUSDT');
  if (v1.length < 15000) return t.skip('sin datos históricos (node evaluar.js --descargar)');
  // Quitar los últimos meses no puede cambiar las operaciones que ya habían terminado antes.
  const o = { comision: 0, maxDias: 30 };
  const corta = v1.slice(0, 11000), larga = v1.slice(0, 14000), fin = corta.at(-1).time;
  const a = EV.simular(corta, o).ops, b = EV.simular(larga, o).ops.filter((x) => x.entrada + x.horas * 3600 <= fin);
  assert.ok(a.length > 5, 'debería haber operaciones en el tramo');
  assert.deepStrictEqual(a.slice(0, b.length), b, 'las operaciones pasadas cambian al añadir datos futuros');
  assert.ok(a.length - b.length <= 1, 'solo puede diferir la última, que quedó a medias');
});
