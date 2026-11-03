/* Estrategia TradingLatino (Jaime Merino) para Trading Pedro.
 *
 * Lee EMA 10 y 55, Squeeze Momentum (el "monitor"), ADX con nivel 23 y perfil de volumen
 * en 1H, 4H y Diario, y aplica las reglas: matriz monitor + ADX, entradas en largo y en
 * corto, "le pasó el tiempo", divergencias y las advertencias de la estrategia.
 *
 * Las reglas están escritas con palabras; aquí se traducen a números con estos valores:
 *   cerca de la EMA 55 o de un nodo .... a menos de NEAR_ATR rangos medios de vela (ATR 14)
 *   cerca del punto 0 .................. el valle bajó a menos del ZERO_FRAC de su máximo
 *   valle desarrollado ................. al menos DEVELOPED velas
 *   precio lejos de las medias ......... a más de FAR_ATR ATR de la EMA 55
 * Es una aplicación mecánica de las reglas, no un consejo de inversión.
 */
(function () {
  'use strict';
  const NEAR_ATR = 0.5, ZERO_FRAC = 0.3, DEVELOPED = 6, FAR_ATR = 2, ADX_LEVEL = 23;
  const VP_CANDLES = 150; // velas para el perfil de volumen (lo que se ve en el gráfico)

  const HORIZON = {
    '1h': 'próximas 12–24 h · solo para afinar la entrada',
    '4h': 'próximas 24–48 h',
    '1d': 'próximos 10–15 días',
  };
  const MON_TXT = {
    vc: 'verde claro: impulso alcista',
    vo: 'verde oscuro: el impulso alcista se debilita',
    ro: 'rojo oscuro: impulso bajista',
    rc: 'rojo claro: la caída se frena',
  };

  // Tramos seguidos del monitor con el mismo signo (valles verdes > 0 y rojos < 0).
  function valleys(val, cs) {
    const out = [];
    let cur = null;
    for (let i = 0; i < val.length; i++) {
      const v = val[i];
      if (v == null) continue;
      const sign = v >= 0 ? 1 : -1;
      if (!cur || cur.sign !== sign) {
        cur = { sign, start: i, end: i, peak: 0, hi: -Infinity, lo: Infinity, closeBefore: cs[Math.max(0, i - 1)].close };
        out.push(cur);
      }
      cur.end = i;
      cur.peak = Math.max(cur.peak, Math.abs(v));
      cur.hi = Math.max(cur.hi, cs[i].high);
      cur.lo = Math.min(cur.lo, cs[i].low);
    }
    out.forEach((w) => { w.len = w.end - w.start + 1; w.closeEnd = cs[w.end].close; });
    return out;
  }

  // Cruce de EMA 10 y 55 en las últimas velas, con retroceso a apoyar en la EMA 55 y continuación.
  function breakAndRetest(cs, e10, e55, a, n) {
    for (let i = n; i > Math.max(1, n - 30); i--) {
      if (e10[i] == null || e55[i] == null || e10[i - 1] == null || e55[i - 1] == null) return null;
      const up = e10[i] > e55[i] && e10[i - 1] <= e55[i - 1];
      const down = e10[i] < e55[i] && e10[i - 1] >= e55[i - 1];
      if (!up && !down) continue;
      const dir = up ? 1 : -1;
      let touched = false;
      for (let j = i + 1; j <= n; j++) {
        const dist = dir === 1 ? cs[j].low - e55[j] : e55[j] - cs[j].high;
        if (dist <= 0.3 * a) touched = true;
      }
      const holds = dir === 1 ? cs[n].close > e55[n] : cs[n].close < e55[n];
      return { dir, ago: n - i, confirmed: touched && holds };
    }
    return null;
  }

  function readTf(tf, cs, ind) {
    const n = cs.length - 1;
    if (n < 120) return null;
    const close = cs.map((c) => c.close);
    const e10 = ind.ema(close, 10), e55 = ind.ema(close, 55);
    const sq = ind.squeeze(cs), ad = ind.adx(cs), atr = ind.atr(cs);
    const a = atr[n], price = close[n], v = sq.val[n], vPrev = sq.val[n - 1];
    const vp = ind.vpvr(cs.slice(-VP_CANDLES), 48);
    if (v == null || ad.adx[n] == null || e55[n] == null || !a || !vp) return null;

    // EMAs y estructura
    const trend = e10[n] > e55[n] ? 'up' : 'down';
    const above = price > e55[n];
    const rr = breakAndRetest(cs, e10, e55, a, n);
    const emaTxt = trend === 'up'
      ? `Alcista: EMA 10 sobre EMA 55 · precio ${above ? 'sobre' : 'bajo'} la EMA 55`
      : `Bajista: EMA 10 bajo EMA 55 · precio ${above ? 'sobre' : 'bajo'} la EMA 55`;

    // Monitor
    const mon = ind.monColor(v, vPrev);
    const vs = valleys(sq.val, cs), cur = vs[vs.length - 1], prev = vs[vs.length - 2];
    const nearZero = Math.abs(v) <= ZERO_FRAC * cur.peak;
    const young = cur.len <= 3; // valle recién nacido
    const monTxt = `${MON_TXT[mon]} · valle ${cur.sign > 0 ? 'verde' : 'rojo'} de ${cur.len} vela${cur.len === 1 ? '' : 's'}`
      + (nearZero && cur.len > 2 ? ', cerca del punto 0' : '');

    // ADX
    const adxV = ad.adx[n], adxUp = adxV > ad.adx[n - 1], strong = adxV >= ADX_LEVEL;
    const adxTxt = `${adxV.toFixed(1).replace('.', ',')} · ${strong ? 'sobre' : 'bajo'} 23 · pendiente ${adxUp ? 'positiva' : 'negativa'}`
      + ` → ${strong && adxUp ? 'con fuerza' : !adxUp ? 'pierde fuerza' : 'sin fuerza'}`;

    // Volumen
    const pocPos = vp.poc > price ? 'resistencia (encima del precio)' : 'soporte (debajo del precio)';
    const nodesAbove = vp.nodes.filter((p) => p > price + 0.3 * a).sort((x, y) => x - y);
    const nodesBelow = vp.nodes.filter((p) => p < price - 0.3 * a).sort((x, y) => y - x);
    const volTxt = `POC ${ind.fmt(vp.poc)} · ${pocPos}`;

    // Matriz monitor + ADX (sección 3 de la estrategia)
    const dirUp = mon === 'vc' || mon === 'rc';
    let matrix;
    if (dirUp && adxUp && strong) {
      matrix = { dir: 'up', text: 'Movimiento alcista con fuerza', note: 'Si ya subió, no se entra en la punta: se protege con stop en la entrada o se toma ganancia.' };
    } else if (mon === 'rc' && !adxUp) {
      matrix = { dir: 'range-up', text: 'La caída perdió fuerza: rango o subida', note: 'Zona óptima de compra si apoya en soporte o en un nodo de volumen.' };
    } else if (mon === 'vo' && !adxUp) {
      matrix = { dir: 'range-down', text: 'El impulso alcista perdió fuerza: rango o caída', note: 'Momento de cerrar largos o tomar ganancias.' };
    } else if (mon === 'ro' && adxUp && strong) {
      matrix = { dir: 'down', text: 'Caída con fuerza ("cuchillo cayendo")', note: 'Prohibido comprar hasta que el monitor gire a rojo claro y el ADX pierda pendiente.' };
    } else if (mon === 'vo' && adxUp && strong) {
      matrix = { dir: 'down', text: 'El giro bajista toma fuerza: caída', note: '' };
    } else if (mon === 'vc' && !adxUp) {
      matrix = { dir: 'range-up', text: 'Impulso alcista sin fuerza (ADX bajando): rango o subida', note: '' };
    } else if (mon === 'ro' && !adxUp) {
      matrix = { dir: 'range-down', text: 'Caída sin fuerza (ADX bajando): rango o caída', note: '' };
    } else {
      matrix = { dir: 'range', text: `Impulso ${dirUp ? 'alcista' : 'bajista'} todavía sin fuerza (ADX bajo 23): rango`, note: '' };
    }

    // Proyección: la matriz dentro de la tendencia de las medias
    let projection = matrix.text, projDir = matrix.dir, matrixNote = matrix.note;
    if (trend === 'up' && above && (matrix.dir === 'range-down' || matrix.dir === 'down')) {
      projection = 'Retroceso a la EMA 55 para seguir subiendo'; projDir = 'range-down';
      matrixNote = `${matrix.text}, pero la tendencia es alcista: el retroceso hacia la EMA 55 (${ind.fmt(e55[n])}) es zona de compra, no de venta.`;
    } else if (trend === 'down' && !above && (matrix.dir === 'range-up' || matrix.dir === 'up')) {
      projection = 'Rebote a la EMA 55 para seguir cayendo'; projDir = 'range-up';
      matrixNote = `${matrix.text}, pero la tendencia es bajista: el rebote hacia la EMA 55 (${ind.fmt(e55[n])}) es zona de venta; comprar aquí sería contra tendencia.`;
    }

    const notes = [];
    if (matrixNote) notes.push({ kind: 'info', text: matrixNote });
    if (rr && rr.confirmed) {
      notes.push({ kind: rr.dir > 0 ? 'up' : 'down', text: `Rompe y apoya ${rr.dir > 0 ? 'alcista' : 'bajista'}: las medias se cruzaron hace ${rr.ago} velas y el precio apoyó en la EMA 55.` });
    }

    // Regla del tiempo: un valle completo hasta el punto 0 sin que el precio se moviera a su favor
    const done = young && prev ? prev : (nearZero && cur.len >= DEVELOPED ? cur : null);
    if (done && done.len >= DEVELOPED) {
      const moved = (done.closeEnd - done.closeBefore) / a;
      if (done.sign < 0 && moved > -NEAR_ATR && close[done.end] > e55[done.end]) {
        notes.push({ kind: 'up', text: 'A los bajistas "les pasó el tiempo": hubo un valle rojo completo y el precio no cayó. Lo más probable es subir al pasar a valle verde.' });
      } else if (done.sign > 0 && moved < NEAR_ATR && close[done.end] < e55[done.end]) {
        notes.push({ kind: 'down', text: 'A los alcistas "les pasó el tiempo": hubo un valle verde completo y el precio no subió. Lo más probable es caer en el próximo valle rojo.' });
      }
    }

    // Divergencias: comparar el valle actual (o el recién terminado) con el anterior del mismo color
    const lastOf = (sign) => vs.filter((w) => w.sign === sign && w.len >= 3).slice(-2);
    const [gA, gB] = lastOf(1), [rA, rB] = lastOf(-1);
    if (gA && gB && n - gB.end <= 5 && gB.hi > gA.hi && gB.peak < gA.peak) {
      notes.push({ kind: 'down', text: `Divergencia bajista: el precio hizo un máximo más alto pero el valle verde es más pequeño. Proyecta caída hacia la EMA 55 (${ind.fmt(e55[n])}).` });
    }
    if (rA && rB && n - rB.end <= 5 && rB.lo < rA.lo && rB.peak < rA.peak) {
      notes.push({ kind: 'up', text: `Divergencia alcista: el precio hizo un mínimo más bajo pero el valle rojo es más pequeño. Proyecta rebote hacia la EMA 55 (${ind.fmt(e55[n])}).` });
    }

    // No perseguir el precio
    if (mon === 'vc' && cur.sign > 0 && cur.len >= 5 && price - e55[n] > FAR_ATR * a) {
      notes.push({ kind: 'warn', text: 'Valle verde desarrollado y precio lejos de las medias: "ahí no se compra, ahí se vende o se protege".' });
    }

    // Condiciones de entrada (sección 4)
    const recent = cs.slice(-3);
    const minLow = Math.min(...recent.map((c) => c.low)), maxHigh = Math.max(...recent.map((c) => c.high));
    const nodeBelow = nodesBelow[0], nodeAbove = nodesAbove[0];
    const resistAbove = [e55[n], vp.poc].filter((p) => p > price && p - price < NEAR_ATR * a);
    const supportBelow = [e55[n], vp.poc].filter((p) => p < price && price - p < NEAR_ATR * a);

    const long = [
      { ok: (above && trend === 'up') || !!(rr && rr.confirmed && rr.dir > 0), text: 'A favor de tendencia: precio y EMA 10 sobre la EMA 55 (o rompe y apoya alcista)' },
      { ok: Math.abs(minLow - e55[n]) <= NEAR_ATR * a || (nodeBelow != null && price - nodeBelow <= NEAR_ATR * a) || (price - vp.poc >= -0.1 * a && price - vp.poc <= NEAR_ATR * a),
        text: 'Retroceso a la EMA 55 o a un nodo de volumen' },
      { ok: (mon === 'rc' && nearZero) || (cur.sign > 0 && young && prev && prev.sign < 0), text: 'Monitor: valle rojo que gira a rojo claro cerca del punto 0 (o nace el valle verde)' },
      { ok: !adxUp || (cur.sign > 0 && young), text: 'ADX: la caída pierde fuerza (pendiente negativa) o se quiebra al alza con el valle verde' },
    ];
    const short = [
      { ok: (!above && trend === 'down') || !!(rr && rr.confirmed && rr.dir < 0), text: 'A favor de tendencia: precio y EMA 10 bajo la EMA 55 (o rompe y apoya bajista)' },
      { ok: Math.abs(maxHigh - e55[n]) <= NEAR_ATR * a || (nodeAbove != null && nodeAbove - price <= NEAR_ATR * a) || (vp.poc - price >= -0.1 * a && vp.poc - price <= NEAR_ATR * a),
        text: 'Rebote a la EMA 55 o al POC por encima' },
      { ok: mon === 'vo' || (cur.sign < 0 && young && prev && prev.sign > 0), text: 'Monitor: valle verde que gira a verde oscuro (o nace el valle rojo)' },
      { ok: !adxUp || (cur.sign < 0 && young), text: 'ADX: la subida pierde fuerza o toma pendiente positiva con el valle rojo' },
    ];
    const longOk = long.every((c) => c.ok), shortOk = short.every((c) => c.ok);
    if (longOk && resistAbove.length) {
      notes.push({ kind: 'warn', text: `Entrada alcista chocando con resistencia (${resistAbove.map(ind.fmt).join(' y ')} justo encima): se invalida o se opera con precaución extrema.` });
    }
    if (shortOk && supportBelow.length) {
      notes.push({ kind: 'warn', text: `Entrada bajista sobre soporte (${supportBelow.map(ind.fmt).join(' y ')} justo debajo): precaución.` });
    }

    return {
      tf, horizon: HORIZON[tf], price, atr: a, e10: e10[n], e55: e55[n], trend, above,
      mon, monDirUp: dirUp, nearZero, valley: cur, adx: adxV, adxUp, strong, vp, nodesAbove, nodesBelow,
      emaTxt, monTxt, adxTxt, volTxt, projection, projDir, notes,
      long, short, longOk: longOk && !resistAbove.length, shortOk: shortOk && !supportBelow.length,
      // mínimo y máximo del retroceso: últimas 6 velas
      recentLow: Math.min(...cs.slice(-6).map((c) => c.low)), recentHigh: Math.max(...cs.slice(-6).map((c) => c.high)),
      swingLow: Math.min(...cs.slice(-50).map((c) => c.low)), swingHigh: Math.max(...cs.slice(-50).map((c) => c.high)),
    };
  }

  // Plan operativo en 4H, con el gatillo afinado en 1H y el contexto del Diario.
  function plan(r4, r1, rd, fmt) {
    if (!r4) return null;
    const side = r4.longOk ? 'long' : r4.shortOk ? 'short' : null;
    if (!side) {
      // qué falta para la entrada a favor de la tendencia de 4H
      const want = r4.trend === 'up' ? 'long' : 'short';
      const missing = r4[want].filter((c) => !c.ok).map((c) => c.text);
      return { side: null, want, missing };
    }
    const entry = r4.price, a = r4.atr;
    const counter = rd && rd.trend !== (side === 'long' ? 'up' : 'down');
    let stop, target, stopWhy, targetWhy;
    if (side === 'long') {
      stop = r4.recentLow - 0.2 * a;
      stopWhy = 'por debajo del último mínimo de 4H';
      if (counter && rd.e55 > entry + 0.3 * a) { target = rd.e55; targetWhy = 'EMA 55 diaria (operación contra la tendencia diaria: tomar ganancias rápido)'; }
      else if (r4.vp.poc > entry + 0.3 * a) { target = r4.vp.poc; targetWhy = 'POC por encima'; }
      else if (r4.nodesAbove.length) { target = r4.nodesAbove[0]; targetWhy = 'siguiente nodo de volumen por encima'; }
      else if (r4.swingHigh > entry + 0.3 * a) { target = r4.swingHigh; targetWhy = 'último máximo de 4H'; }
    } else {
      // sobre la EMA 55 solo si el precio está topando con ella; si no, sobre el máximo del rebote
      const atEma = r4.e55 > entry && r4.e55 - entry <= a;
      stop = Math.max(r4.recentHigh, atEma ? r4.e55 : -Infinity) + 0.2 * a;
      stopWhy = atEma ? 'sobre la EMA 55 y el último máximo de 4H' : 'sobre el último máximo de 4H';
      if (counter && rd.e55 < entry - 0.3 * a) { target = rd.e55; targetWhy = 'EMA 55 diaria (operación contra la tendencia diaria: tomar ganancias rápido)'; }
      else if (r4.vp.poc < entry - 0.3 * a) { target = r4.vp.poc; targetWhy = 'POC por debajo'; }
      else if (r4.nodesBelow.length) { target = r4.nodesBelow[0]; targetWhy = 'siguiente nodo de volumen por debajo'; }
      else if (r4.swingLow < entry - 0.3 * a) { target = r4.swingLow; targetWhy = 'último mínimo de 4H'; }
    }
    let trigger = null;
    if (r1) {
      trigger = side === 'long'
        ? { ok: r1.mon === 'rc' || (r1.valley.sign > 0 && r1.valley.len <= 3), text: 'Gatillo en 1H: monitor en rojo claro o naciendo el valle verde' }
        : { ok: r1.mon === 'vo' || (r1.valley.sign < 0 && r1.valley.len <= 3), text: 'Gatillo en 1H: monitor en verde oscuro o naciendo el valle rojo' };
    }
    const exit = side === 'long' ? 'o cuando el monitor de 4H gire a verde oscuro' : 'o cuando el monitor de 4H gire a rojo claro';
    // un stop a más de 3 velas medias de distancia suele indicar que se entra tarde
    const wide = Math.abs(entry - stop) > 3 * a;
    return {
      side, entry, stop, target: target ?? null, stopWhy, targetWhy: targetWhy || 'sin objetivo claro en el volumen', exit, counter, trigger, wide,
      zone: `cerca de ${fmt(r4.e55)} (EMA 55 de 4H)`,
    };
  }

  /**
   * byTf: { '1h': velas, '4h': velas, '1d': velas }.
   * ind: funciones de indicadores de la app { ema, squeeze, adx, atr, vpvr, monColor, fmt }.
   */
  function analyze(byTf, ind) {
    const reads = {};
    for (const tf of ['1h', '4h', '1d']) reads[tf] = byTf[tf] ? readTf(tf, byTf[tf], ind) : null;
    const r4 = reads['4h'], rd = reads['1d'];
    const global = [];
    if (r4 && rd) {
      if (r4.longOk && rd.trend === 'down') global.push({ kind: 'warn', text: 'El largo de 4H va contra la tendencia bajista del Diario: es solo un rebote, con más riesgo. Tomar ganancias rápido en la EMA 55 diaria.' });
      if (r4.shortOk && rd.trend === 'up') global.push({ kind: 'warn', text: 'El corto de 4H va contra la tendencia alcista del Diario: es solo un retroceso. Tomar ganancias rápido en la EMA 55 diaria.' });
    }
    return { reads, plan: plan(r4, reads['1h'], rd, ind.fmt), global };
  }

  window.TPStrategies = { tradingLatino: { name: 'TradingLatino (Jaime Merino)', intervals: ['1h', '4h', '1d'], analyze } };
})();
