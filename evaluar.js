/* Evaluador de Trading Pedro: mide con datos históricos cómo le habría ido a la estrategia.
 *
 * Usa el MISMO código que la app (web/indicadores.js, web/calc.js y las estrategias
 * web/tradinglatino.js y web/estrategia_pedro.js), así que mide lo que se ve en pantalla.
 * Evalúa todas las estrategias en BTC, ETH y SOL: más monedas dan más operaciones, y con
 * más operaciones cuesta menos distinguir una mejora real de la casualidad.
 *
 * Uso:
 *   node evaluar.js --descargar          baja (o actualiza) las velas de 1H a datos/
 *   node evaluar.js                      evalúa el tramo de desarrollo y guarda el resultado
 *   node evaluar.js --fijar-base         además deja este resultado como base de comparación
 *   node evaluar.js --reserva            muestra también el tramo de reserva (ver abajo)
 * Opciones: --simbolo BTCUSDT,ETHUSDT   --estrategia pedro   --dias 1095  --comision 0
 *           --max-dias 30  --operaciones
 *           --sin-salida-monitor   (mide solo con stop y objetivo, como antes)
 *
 * Cómo se evalúa, sin ver el futuro:
 *   - Cada vez que cierra una vela de 4H se le pasan a la estrategia las velas de 1H, 4H y
 *     Diario tal como estaban en ese instante (la diaria, a medio hacer).
 *   - Si el plan da entrada con stop y objetivo, se abre una operación al cierre de esa vela
 *     y se sigue vela a vela de 1H hasta tocar el stop o el objetivo. Si una vela toca los
 *     dos, cuenta el stop (criterio prudente, el mismo de la práctica de la app).
 *   - Salida por monitor, como dice el plan ("o cuando el monitor de 4H gire a verde oscuro"
 *     en largos, "a rojo claro" en cortos): si al cerrar una vela de 4H el monitor acaba de
 *     girar a ese color, la operación se cierra al precio de cierre de esa vela.
 *   - Una operación a la vez. Si pasa --max-dias sin resolverse, se cierra al precio de cierre.
 *   - El resultado se mide en R: 1 R = lo que se arriesga en la operación. +2 R es ganar el
 *     doble de lo arriesgado; −1 R es perder el stop.
 *
 * Reserva: el último 25 % del periodo NO se usa para decidir mejoras. Solo se mira con
 * --reserva, al final, para confirmar que una mejora no es un ajuste a los datos pasados.
 *
 * Es una medición mecánica de las reglas. Un buen resultado pasado no garantiza el futuro.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

globalThis.window = globalThis; // tradinglatino.js se registra en window
const IND = require('./web/indicadores.js');
const CALC = require('./web/calc.js');
require('./web/tradinglatino.js');
require('./web/estrategia_pedro.js');
const ESTRATEGIAS = globalThis.TPStrategies; // { tradingLatino, pedro }
const SIMBOLOS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

const ROOT = __dirname;
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const H1 = 3600, H4 = 4 * H1, D1 = 24 * H1;
// La app pide 3000 velas por temporalidad. Con 600 los indicadores dan lo mismo (la EMA 55
// ya no "recuerda" nada tan atrás) y la evaluación tarda mucho menos.
const VENTANA = 600;
const MIN_DIARIAS = 200; // días de historia antes de empezar a evaluar
const RESERVA = 0.25;

// ---------- opciones ----------
function opciones(argv) {
  const o = { simbolos: SIMBOLOS, estrategias: Object.keys(ESTRATEGIAS), dias: 1095, comision: 0, maxDias: 30 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const num = () => { const v = Number(argv[++i]); if (!isFinite(v)) throw new Error(`Falta un número después de ${a}`); return v; };
    if (a === '--descargar') o.descargar = true;
    else if (a === '--reserva') { o.reserva = true; o.noGuardar = true; } // la reserva no se guarda
    else if (a === '--fijar-base') o.fijarBase = true;
    else if (a === '--operaciones') o.operaciones = true;
    else if (a === '--no-guardar') o.noGuardar = true;
    else if (a === '--simbolo') { o.simbolos = String(argv[++i] || '').toUpperCase().split(','); o.parcial = true; }
    else if (a === '--estrategia') { o.estrategias = [String(argv[++i] || '')]; o.parcial = true; }
    else if (a === '--dias') o.dias = num();
    else if (a === '--comision') o.comision = num();
    else if (a === '--max-dias') o.maxDias = num();
    else if (a === '--sin-salida-monitor') o.sinSalidaMonitor = true;
    else throw new Error(`Opción desconocida: ${a}`);
  }
  for (const sim of o.simbolos) if (!/^[A-Z0-9]{5,20}$/.test(sim)) throw new Error('Símbolo no válido: ' + sim);
  for (const e of o.estrategias) if (!ESTRATEGIAS[e]) throw new Error(`Estrategia desconocida: ${e}. Hay: ${Object.keys(ESTRATEGIAS).join(', ')}`);
  if (o.parcial && o.fijarBase) throw new Error('La base se fija con todas las monedas y estrategias: quita --simbolo y --estrategia.');
  return o;
}

// ---------- datos ----------
const archivoDatos = (simbolo) => path.join(ROOT, 'datos', `${simbolo}_1h.csv`);

function leerDatos(simbolo) {
  const f = archivoDatos(simbolo);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
    const [time, open, high, low, close, volume] = l.split(',').map(Number);
    return { time, open, high, low, close, volume };
  });
}

function guardarDatos(simbolo, velas) {
  fs.mkdirSync(path.dirname(archivoDatos(simbolo)), { recursive: true });
  const filas = velas.map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume].join(','));
  fs.writeFileSync(archivoDatos(simbolo), ['time,open,high,low,close,volume', ...filas].join('\n') + '\n');
}

async function pedir(ruta) {
  let ultimo;
  for (const host of HOSTS) {
    try {
      const r = await fetch(host + ruta);
      if (r.status === 429 || r.status === 418) throw new Error('Binance limitó las consultas. Espera unos minutos y vuelve a intentar.');
      if (!r.ok) throw new Error(`Binance respondió ${r.status}`);
      return await r.json();
    } catch (e) {
      if (/limitó/.test(e.message)) throw e; // no insistir con otro servidor
      ultimo = e;
    }
  }
  throw new Error(`No se pudo descargar de Binance: ${ultimo && ultimo.message}`);
}

async function descargar(o, simbolo) {
  // Hasta el último día completo (UTC), para que las velas de 4H y Diario salgan enteras.
  const fin = Math.floor(Date.now() / 1000 / D1) * D1;
  const inicio = fin - o.dias * D1, previas = leerDatos(simbolo);
  // si lo guardado ya cubre el inicio, solo se añaden las velas nuevas; si no, se baja todo
  const velas = previas.length && previas[0].time <= inicio ? previas : [];
  let desde = velas.length ? velas[velas.length - 1].time + H1 : inicio;
  process.stdout.write(`Descargando ${simbolo} 1H desde ${fecha(desde)} hasta ${fecha(fin)} `);
  while (desde < fin) {
    const raw = await pedir(`/api/v3/klines?symbol=${simbolo}&interval=1h&startTime=${desde * 1000}&endTime=${fin * 1000 - 1}&limit=1000`);
    if (!raw.length) break;
    for (const k of raw) velas.push({ time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });
    desde = velas[velas.length - 1].time + H1;
    process.stdout.write('.');
    await new Promise((ok) => setTimeout(ok, 250));
  }
  guardarDatos(simbolo, velas);
  console.log(`\n${velas.length} velas guardadas en ${path.relative(ROOT, archivoDatos(simbolo))}`);
}

// ---------- velas de 4H y Diario a partir de las de 1H ----------
function agrupar(velas, paso) {
  const out = [];
  let cur = null;
  velas.forEach((c, i) => {
    const t = Math.floor(c.time / paso) * paso;
    if (!cur || cur.time !== t) { cur = { time: t, open: c.open, high: c.high, low: c.low, close: c.close, volume: 0, primera: i, ultima: i }; out.push(cur); }
    cur.high = Math.max(cur.high, c.high); cur.low = Math.min(cur.low, c.low);
    cur.close = c.close; cur.volume += c.volume; cur.ultima = i;
  });
  return out;
}

// ---------- simulación ----------
const fmt = (v) => v.toFixed(2);
const fecha = (t) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
const stInd = { ema: IND.ema, squeeze: IND.squeeze, adx: IND.adx, atr: IND.atr, vpvr: IND.vpvr, monColor: IND.monColor, fmt };

function simular(v1, o, estrategia = ESTRATEGIAS.pedro) {
  const v4 = agrupar(v1, H4), vd = agrupar(v1, D1);
  const maxVelas = Math.round(o.maxDias * 24);
  // color del monitor de 4H en cada vela, y a qué vela de 4H pertenece cada vela de 1H
  const sq4 = IND.squeeze(v4).val;
  const mon4 = sq4.map((v, i) => (v == null || sq4[i - 1] == null ? null : IND.monColor(v, sq4[i - 1])));
  const en4 = new Int32Array(v1.length);
  v4.forEach((c, i) => { for (let j = c.primera; j <= c.ultima; j++) en4[j] = i; });
  const cierre = (t, x) => (t.side === 'short' ? -1 : 1) * (x - t.entry) * t.size - (o.comision / 100) * t.size * (t.entry + x);
  const ops = [];
  const cuenta = { lecturas: 0, senales: 0, sinObjetivo: 0, planInvalido: 0, abierta: 0 };
  let libreDesde = 0; // índice de 1H a partir del cual se puede volver a entrar
  let d = 0;
  for (let k = 0; k < v4.length; k++) {
    const b = v4[k], h = b.ultima;
    while (d + 1 < vd.length && vd[d + 1].time <= b.time) d++;
    if (d < MIN_DIARIAS || h < libreDesde) continue;
    // la vela diaria en curso, tal como iba al cerrar esta vela de 4H
    const hoy = vd[d].ultima === h ? vd[d] : agrupar(v1.slice(vd[d].primera, h + 1), D1)[0];
    const porTf = {
      '1h': v1.slice(Math.max(0, h + 1 - VENTANA), h + 1),
      '4h': v4.slice(Math.max(0, k + 1 - VENTANA), k + 1),
      '1d': vd.slice(Math.max(0, d - VENTANA + 1), d).concat(hoy),
    };
    const res = estrategia.analyze(porTf, stInd);
    cuenta.lecturas++;
    const p = res.plan;
    if (!p || !p.side) continue;
    cuenta.senales++;
    if (p.target == null) { cuenta.sinObjetivo++; continue; }
    const c = CALC.compute({ side: p.side, entry: p.entry, stop: p.stop, target: p.target, risk: 1, feePct: o.comision });
    if (c.error) { cuenta.planInvalido++; continue; }
    const t = { side: p.side, entry: p.entry, stop: p.stop, target: p.target, size: c.size, risk: 1 };
    let fin = null;
    for (let j = h + 1; j < v1.length && j <= h + maxVelas; j++) {
      const s = CALC.settle(t, v1[j], o.comision);
      if (s) { fin = { salida: s.result === 'target' ? 'objetivo' : 'stop', r: s.r, j }; break; }
      const q = en4[j];
      if (!o.sinSalidaMonitor && v4[q].ultima === j) { // cierra una vela de 4H: ¿giró el monitor?
        const giro = p.side === 'long' ? 'vo' : 'rc';
        if (mon4[q] === giro && mon4[q - 1] !== giro) { fin = { salida: 'monitor', r: cierre(t, v1[j].close), j }; break; }
      }
      if (j === h + maxVelas) fin = { salida: 'tiempo', r: cierre(t, v1[j].close), j };
    }
    if (!fin) { cuenta.abierta++; break; } // se acabaron los datos con la operación abierta
    ops.push({
      entrada: b.time + H4, lado: p.side === 'long' ? 'largo' : 'corto', precio: p.entry, stop: p.stop, objetivo: p.target,
      rrPlan: c.rr, salida: fin.salida, r: fin.r, horas: fin.j - h,
      contraDiario: !!p.counter, gatillo1h: !!(p.trigger && p.trigger.ok), stopAmplio: !!p.wide,
      objetivoPor: p.targetWhy,
    });
    libreDesde = fin.j;
  }
  const t0 = vd[Math.min(MIN_DIARIAS, vd.length - 1)].time, t1 = v1[v1.length - 1].time + H1;
  return { ops, cuenta, desde: t0, hasta: t1, corte: Math.floor((t0 + (t1 - t0) * (1 - RESERVA)) / D1) * D1 };
}

// ---------- medidas ----------
function medir(ops) {
  const n = ops.length;
  if (!n) return { operaciones: 0 };
  const rs = ops.map((x) => x.r), suma = rs.reduce((a, b) => a + b, 0), media = suma / n;
  const gan = rs.filter((r) => r > 0), per = rs.filter((r) => r <= 0);
  const sd = n > 1 ? Math.sqrt(rs.reduce((a, r) => a + (r - media) ** 2, 0) / (n - 1)) : 0;
  const margen = n > 1 ? 1.96 * sd / Math.sqrt(n) : null;
  let acum = 0, pico = 0, caida = 0, racha = 0, peorRacha = 0;
  for (const r of rs) {
    acum += r; pico = Math.max(pico, acum); caida = Math.max(caida, pico - acum);
    racha = r <= 0 ? racha + 1 : 0; peorRacha = Math.max(peorRacha, racha);
  }
  const perdido = -per.reduce((a, b) => a + b, 0);
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  return {
    operaciones: n,
    aciertos: r2(100 * gan.length / n),
    rMedio: r2(media),            // lo que deja cada operación, en promedio
    rMedioMin: r2(margen == null ? null : media - margen), // intervalo de confianza del 95 %
    rMedioMax: r2(margen == null ? null : media + margen),
    rTotal: r2(suma),
    factor: perdido > 0 ? r2(gan.reduce((a, b) => a + b, 0) / perdido) : null, // ganado / perdido
    peorCaida: r2(caida),
    peorRacha,
    rrPlan: r2(ops.reduce((a, x) => a + x.rrPlan, 0) / n),
    horas: Math.round(ops.reduce((a, x) => a + x.horas, 0) / n),
    salidas: { objetivo: ops.filter((x) => x.salida === 'objetivo').length, stop: ops.filter((x) => x.salida === 'stop').length, tiempo: ops.filter((x) => x.salida === 'tiempo').length, monitor: ops.filter((x) => x.salida === 'monitor').length },
  };
}

const GRUPOS = [
  ['Largos', (x) => x.lado === 'largo'], ['Cortos', (x) => x.lado === 'corto'],
  ['A favor del Diario', (x) => !x.contraDiario], ['Contra el Diario', (x) => x.contraDiario],
  ['Con gatillo de 1H', (x) => x.gatillo1h], ['Sin gatillo de 1H', (x) => !x.gatillo1h],
  ['Stop normal', (x) => !x.stopAmplio], ['Stop amplio', (x) => x.stopAmplio],
];

function resumen(ops, simbolos) {
  const grupos = {};
  for (const [nombre, f] of GRUPOS) grupos[nombre] = medir(ops.filter(f));
  if (simbolos.length > 1) for (const sim of simbolos) grupos[sim] = medir(ops.filter((x) => x.simbolo === sim));
  return { total: medir(ops), grupos };
}

// ---------- salida ----------
const num = (v, d = 2) => (v == null ? '—' : v.toFixed(d).replace('.', ','));
const signo = (v, d = 2) => (v == null ? '—' : (v > 0 ? '+' : '') + num(v, d));

function fila(nombre, m) {
  if (!m.operaciones) return `  ${nombre.padEnd(20)}${'0'.padStart(5)}`;
  const ic = m.rMedioMin == null ? '' : `(${signo(m.rMedioMin)} a ${signo(m.rMedioMax)})`;
  return `  ${nombre.padEnd(20)}${String(m.operaciones).padStart(5)}${(num(m.aciertos, 0) + ' %').padStart(9)}${signo(m.rMedio).padStart(9)}  ${ic.padEnd(18)}`
    + `${signo(m.rTotal, 1).padStart(8)}${num(m.factor).padStart(8)}${num(m.peorCaida, 1).padStart(8)}${String(m.peorRacha).padStart(7)}`;
}

function imprimir(titulo, r, rango) {
  console.log(`\n${titulo}  ·  ${fecha(rango[0]).slice(0, 10)} a ${fecha(rango[1]).slice(0, 10)}`);
  console.log(`  ${''.padEnd(20)}${'Oper.'.padStart(5)}${'Aciertos'.padStart(9)}${'R medio'.padStart(9)}  ${'(margen 95 %)'.padEnd(18)}${'R total'.padStart(8)}${'Factor'.padStart(8)}${'Caída'.padStart(8)}${'Racha'.padStart(7)}`);
  console.log(fila('TOTAL', r.total));
  for (const nombre of Object.keys(r.grupos)) console.log(fila(nombre, r.grupos[nombre]));
  const t = r.total;
  if (t.operaciones) {
    console.log(`  Salidas: ${t.salidas.objetivo} en objetivo, ${t.salidas.stop} en stop, ${t.salidas.monitor || 0} por giro del monitor, ${t.salidas.tiempo} por tiempo  ·  R:B medio del plan ${num(t.rrPlan)}  ·  duración media ${t.horas} h`);
  }
}

function comparar(base, ahora, clave) {
  const eb = base.estrategias && base.estrategias[clave], ea = ahora.estrategias[clave];
  if (!eb) { console.log(`\nSin base para ${ea.nombre}: fíjala con --fijar-base.`); return; }
  const a = eb.desarrollo.total, b = ea.desarrollo.total;
  if (!a.operaciones || !b.operaciones) return;
  console.log(`\nComparación con la base (${base.version}, ${base.commit}) — ${ea.nombre}, tramo de desarrollo`);
  const igual = (k) => JSON.stringify(base[k]) === JSON.stringify(ahora[k]);
  if (!['datos', 'comision', 'maxDias', 'salidaMonitor'].every(igual)) {
    console.log('  Ojo: la base se midió con otros datos u otras opciones; la comparación no es justa. Vuelve a fijar la base con --fijar-base.');
  }
  const lin = (n, x, y, d = 2) => console.log(`  ${n.padEnd(22)}${num(x, d).padStart(9)} → ${num(y, d).padStart(9)}   ${signo(y - x, d)}`);
  lin('Operaciones', a.operaciones, b.operaciones, 0);
  lin('Aciertos (%)', a.aciertos, b.aciertos, 0);
  lin('R medio', a.rMedio, b.rMedio);
  lin('R total', a.rTotal, b.rTotal, 1);
  lin('Peor caída (R)', a.peorCaida, b.peorCaida, 1);
  if (a.operaciones === b.operaciones && a.rTotal === b.rTotal) { console.log('  Sin cambios respecto a la base.'); return; }
  // ¿la diferencia supera el ruido? Los márgenes del 95 % no deben solaparse.
  if (a.rMedioMin != null && b.rMedioMin != null) {
    const clara = b.rMedioMin > a.rMedioMax || b.rMedioMax < a.rMedioMin;
    console.log(clara
      ? '  La diferencia en R medio es clara: los márgenes no se solapan.'
      : '  Ojo: los márgenes de R medio se solapan; la diferencia puede ser casualidad.');
  }
}

function git(cmd) { try { return execSync(`git ${cmd}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } }

// Resumen para la app: lo que muestra el panel de estrategias (web/medicion.js).
function guardarMedicion(out) {
  const mes = (t) => new Date(t.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('es', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const med = {};
  for (const [clave, e] of Object.entries(out.estrategias)) {
    const t = e.desarrollo.total;
    med[clave] = {
      simbolo: out.simbolos.map((x) => x.replace(/USDT$/, '')).join(', '), desde: mes(e.desarrollo.desde), hasta: mes(e.desarrollo.hasta),
      operaciones: t.operaciones, aciertos: t.aciertos, rMedio: t.rMedio, rMedioMin: t.rMedioMin, rMedioMax: t.rMedioMax,
    };
  }
  fs.writeFileSync(path.join(ROOT, 'web', 'medicion.js'),
    '/* Generado por "node evaluar.js --fijar-base". No editar a mano. */\nwindow.TPMedicion = ' + JSON.stringify(med, null, 1) + ';\n');
}

async function main() {
  const o = opciones(process.argv.slice(2));
  if (o.descargar) { for (const sim of o.simbolos) await descargar(o, sim); return; }
  const datos = {}, info = {};
  for (const sim of o.simbolos) {
    const v1 = leerDatos(sim);
    if (!v1.length) throw new Error(`No hay datos de ${sim}. Ejecuta primero:  node evaluar.js --descargar`);
    if (v1.length < (MIN_DIARIAS + 60) * 24) throw new Error(`Hay muy pocos datos de ${sim}. Descarga más días con --descargar --dias 1095`);
    datos[sim] = v1;
    info[sim] = { desde: fecha(v1[0].time), hasta: fecha(v1[v1.length - 1].time + H1), velas: v1.length };
  }
  const rangos = new Set(Object.values(info).map((d) => d.desde + d.hasta));
  if (rangos.size > 1) throw new Error('Las monedas no cubren las mismas fechas. Ejecuta:  node evaluar.js --descargar');

  const version = (/^VERSION = "([^"]+)"/m.exec(fs.readFileSync(path.join(ROOT, 'trading_pedro.py'), 'utf8')) || [])[1] || '?';
  const commit = git('rev-parse --short HEAD') + (git('status --porcelain -- web evaluar.js') ? ' + cambios sin guardar' : '');
  const out = { version, commit, simbolos: o.simbolos, comision: o.comision, maxDias: o.maxDias, salidaMonitor: !o.sinSalidaMonitor, datos: info, estrategias: {} };
  console.log(`Trading Pedro ${version} (${commit}) · ${o.simbolos.join(', ')} · comisión ${num(o.comision)} %`);

  const dir = path.join(ROOT, 'evaluaciones'), archivoBase = path.join(dir, 'base.json');
  const base = fs.existsSync(archivoBase) && !o.fijarBase ? JSON.parse(fs.readFileSync(archivoBase, 'utf8')) : null;
  let rango;
  for (const clave of o.estrategias) {
    const E = ESTRATEGIAS[clave], ops = [], cuenta = {};
    for (const sim of o.simbolos) {
      const r = simular(datos[sim], o, E);
      rango = r;
      for (const x of r.ops) ops.push({ simbolo: sim, ...x });
      for (const k of Object.keys(r.cuenta)) cuenta[k] = (cuenta[k] || 0) + r.cuenta[k];
    }
    ops.sort((a, b) => a.entrada - b.entrada);
    const dev = ops.filter((x) => x.entrada < rango.corte), res = ops.filter((x) => x.entrada >= rango.corte);
    const e = out.estrategias[clave] = { nombre: E.name, cuenta, desarrollo: { desde: fecha(rango.desde), hasta: fecha(rango.corte), ...resumen(dev, o.simbolos) } };

    console.log(`\n=== ${E.name} ===`);
    console.log(`Lecturas de 4H: ${cuenta.lecturas} · con entrada: ${cuenta.senales} · sin objetivo: ${cuenta.sinObjetivo} · plan no válido: ${cuenta.planInvalido}`);
    imprimir('DESARROLLO (para decidir mejoras)', e.desarrollo, [rango.desde, rango.corte]);
    if (o.reserva) {
      e.reserva = { desde: fecha(rango.corte), hasta: fecha(rango.hasta), ...resumen(res, o.simbolos) };
      imprimir('RESERVA (solo para confirmar)', e.reserva, [rango.corte, rango.hasta]);
    }
    if (o.operaciones) {
      console.log('\nOperaciones del tramo de desarrollo:');
      for (const x of dev) console.log(`  ${fecha(x.entrada)}  ${x.simbolo.padEnd(8)} ${x.lado.padEnd(5)} ${fmt(x.precio).padStart(10)}  stop ${fmt(x.stop).padStart(10)}  obj ${fmt(x.objetivo).padStart(10)}  ${x.salida.padEnd(8)} ${signo(x.r).padStart(6)} R  ${String(x.horas).padStart(4)} h${x.contraDiario ? '  contra Diario' : ''}`);
    }
    if (base) comparar(base, out, clave);
    e.operaciones = dev; // las de la reserva no se guardan: no deben servir para ajustar
  }
  if (!o.reserva) console.log(`\nReserva sin mirar: ${fecha(rango.corte).slice(0, 10)} a ${fecha(rango.hasta).slice(0, 10)} (usa --reserva solo para confirmar una mejora ya decidida).`);
  if (o.simbolos.length > 1) console.log('Nota: las monedas suelen moverse juntas, así que sus operaciones no son del todo independientes y el margen real es algo más ancho que el indicado.');

  if (!o.noGuardar) {
    fs.mkdirSync(dir, { recursive: true });
    const sello = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const f = path.join(dir, `${sello}.json`);
    fs.writeFileSync(f, JSON.stringify(out, null, 1));
    console.log(`\nGuardado: ${path.relative(ROOT, f)}`);
    if (o.fijarBase) {
      fs.writeFileSync(archivoBase, JSON.stringify(out, null, 1));
      guardarMedicion(out);
      console.log('Fijado como base de comparación: evaluaciones' + path.sep + 'base.json (y web' + path.sep + 'medicion.js para la app)');
    }
  }
}

if (require.main === module) main().catch((e) => { console.error('Error: ' + e.message); process.exit(1); });
module.exports = { leerDatos, agrupar, simular, medir };
