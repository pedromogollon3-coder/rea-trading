/* Evaluador de Trading Pedro: mide con datos históricos cómo le habría ido a la estrategia.
 *
 * Usa el MISMO código que la app (web/indicadores.js, web/tradinglatino.js, web/calc.js),
 * así que lo que mide es exactamente lo que se ve en pantalla.
 *
 * Uso:
 *   node evaluar.js --descargar          baja (o actualiza) las velas de 1H a datos/
 *   node evaluar.js                      evalúa el tramo de desarrollo y guarda el resultado
 *   node evaluar.js --fijar-base         además deja este resultado como base de comparación
 *   node evaluar.js --reserva            muestra también el tramo de reserva (ver abajo)
 * Opciones: --simbolo BTCUSDT  --dias 1095  --comision 0  --max-dias 30  --operaciones
 *
 * Cómo se evalúa, sin ver el futuro:
 *   - Cada vez que cierra una vela de 4H se le pasan a la estrategia las velas de 1H, 4H y
 *     Diario tal como estaban en ese instante (la diaria, a medio hacer).
 *   - Si el plan da entrada con stop y objetivo, se abre una operación al cierre de esa vela
 *     y se sigue vela a vela de 1H hasta tocar el stop o el objetivo. Si una vela toca los
 *     dos, cuenta el stop (criterio prudente, el mismo de la práctica de la app).
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
const ESTRATEGIA = globalThis.TPStrategies.tradingLatino;

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
  const o = { simbolo: 'BTCUSDT', dias: 1095, comision: 0, maxDias: 30 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const num = () => { const v = Number(argv[++i]); if (!isFinite(v)) throw new Error(`Falta un número después de ${a}`); return v; };
    if (a === '--descargar') o.descargar = true;
    else if (a === '--reserva') { o.reserva = true; o.noGuardar = true; } // la reserva no se guarda
    else if (a === '--fijar-base') o.fijarBase = true;
    else if (a === '--operaciones') o.operaciones = true;
    else if (a === '--no-guardar') o.noGuardar = true;
    else if (a === '--simbolo') o.simbolo = String(argv[++i] || '').toUpperCase();
    else if (a === '--dias') o.dias = num();
    else if (a === '--comision') o.comision = num();
    else if (a === '--max-dias') o.maxDias = num();
    else throw new Error(`Opción desconocida: ${a}`);
  }
  if (!/^[A-Z0-9]{5,20}$/.test(o.simbolo)) throw new Error('Símbolo no válido');
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

async function descargar(o) {
  // Hasta el último día completo (UTC), para que las velas de 4H y Diario salgan enteras.
  const fin = Math.floor(Date.now() / 1000 / D1) * D1;
  const inicio = fin - o.dias * D1, previas = leerDatos(o.simbolo);
  // si lo guardado ya cubre el inicio, solo se añaden las velas nuevas; si no, se baja todo
  const velas = previas.length && previas[0].time <= inicio ? previas : [];
  let desde = velas.length ? velas[velas.length - 1].time + H1 : inicio;
  process.stdout.write(`Descargando ${o.simbolo} 1H desde ${fecha(desde)} hasta ${fecha(fin)} `);
  while (desde < fin) {
    const raw = await pedir(`/api/v3/klines?symbol=${o.simbolo}&interval=1h&startTime=${desde * 1000}&endTime=${fin * 1000 - 1}&limit=1000`);
    if (!raw.length) break;
    for (const k of raw) velas.push({ time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });
    desde = velas[velas.length - 1].time + H1;
    process.stdout.write('.');
    await new Promise((ok) => setTimeout(ok, 250));
  }
  guardarDatos(o.simbolo, velas);
  console.log(`\n${velas.length} velas guardadas en ${path.relative(ROOT, archivoDatos(o.simbolo))}`);
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

function simular(v1, o) {
  const v4 = agrupar(v1, H4), vd = agrupar(v1, D1);
  const maxVelas = Math.round(o.maxDias * 24);
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
    const res = ESTRATEGIA.analyze(porTf, stInd);
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
      if (j === h + maxVelas) {
        const dir = p.side === 'short' ? -1 : 1, x = v1[j].close;
        fin = { salida: 'tiempo', r: dir * (x - t.entry) * t.size - (o.comision / 100) * t.size * (t.entry + x), j };
      }
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
    salidas: { objetivo: ops.filter((x) => x.salida === 'objetivo').length, stop: ops.filter((x) => x.salida === 'stop').length, tiempo: ops.filter((x) => x.salida === 'tiempo').length },
  };
}

const GRUPOS = [
  ['Largos', (x) => x.lado === 'largo'], ['Cortos', (x) => x.lado === 'corto'],
  ['A favor del Diario', (x) => !x.contraDiario], ['Contra el Diario', (x) => x.contraDiario],
  ['Con gatillo de 1H', (x) => x.gatillo1h], ['Sin gatillo de 1H', (x) => !x.gatillo1h],
  ['Stop normal', (x) => !x.stopAmplio], ['Stop amplio', (x) => x.stopAmplio],
];

function resumen(ops) {
  const grupos = {};
  for (const [nombre, f] of GRUPOS) grupos[nombre] = medir(ops.filter(f));
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
  for (const [nombre] of GRUPOS) console.log(fila(nombre, r.grupos[nombre]));
  const t = r.total;
  if (t.operaciones) {
    console.log(`  Salidas: ${t.salidas.objetivo} en objetivo, ${t.salidas.stop} en stop, ${t.salidas.tiempo} por tiempo  ·  R:B medio del plan ${num(t.rrPlan)}  ·  duración media ${t.horas} h`);
  }
}

function comparar(base, ahora) {
  const a = base.desarrollo.total, b = ahora.desarrollo.total;
  if (!a.operaciones || !b.operaciones) return;
  console.log(`\nComparación con la base (${base.version}, ${base.commit}) — tramo de desarrollo`);
  if (base.datos.desde !== ahora.datos.desde || base.datos.hasta !== ahora.datos.hasta || base.comision !== ahora.comision) {
    console.log('  Ojo: la base se midió con otros datos u otra comisión; la comparación no es justa. Vuelve a fijar la base con --fijar-base.');
  }
  const lin = (n, x, y, d = 2) => console.log(`  ${n.padEnd(22)}${num(x, d).padStart(9)} → ${num(y, d).padStart(9)}   ${signo(y - x, d)}`);
  lin('Operaciones', a.operaciones, b.operaciones, 0);
  lin('Aciertos (%)', a.aciertos, b.aciertos, 0);
  lin('R medio', a.rMedio, b.rMedio);
  lin('R total', a.rTotal, b.rTotal, 1);
  lin('Peor caída (R)', a.peorCaida, b.peorCaida, 1);
  // ¿la diferencia supera el ruido? Los márgenes del 95 % no deben solaparse.
  if (a.rMedioMin != null && b.rMedioMin != null) {
    const clara = b.rMedioMin > a.rMedioMax || b.rMedioMax < a.rMedioMin;
    console.log(clara
      ? `  La diferencia en R medio es clara: los márgenes no se solapan.`
      : `  Ojo: los márgenes de R medio se solapan; la diferencia puede ser casualidad.`);
  }
}

function git(cmd) { try { return execSync(`git ${cmd}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } }

async function main() {
  const o = opciones(process.argv.slice(2));
  if (o.descargar) { await descargar(o); return; }
  const v1 = leerDatos(o.simbolo);
  if (!v1.length) throw new Error(`No hay datos de ${o.simbolo}. Ejecuta primero:  node evaluar.js --descargar`);
  if (v1.length < (MIN_DIARIAS + 60) * 24) throw new Error('Hay muy pocos datos para evaluar. Descarga más días con --descargar --dias 1095');

  const sim = simular(v1, o);
  const dev = sim.ops.filter((x) => x.entrada < sim.corte), res = sim.ops.filter((x) => x.entrada >= sim.corte);
  const version = (/^VERSION = "([^"]+)"/m.exec(fs.readFileSync(path.join(ROOT, 'trading_pedro.py'), 'utf8')) || [])[1] || '?';
  const commit = git('rev-parse --short HEAD') + (git('status --porcelain -- web') ? ' + cambios sin guardar' : '');
  const out = {
    version, commit, estrategia: ESTRATEGIA.name, simbolo: o.simbolo, comision: o.comision, maxDias: o.maxDias,
    datos: { desde: fecha(v1[0].time), hasta: fecha(v1[v1.length - 1].time + H1), velas: v1.length },
    cuenta: sim.cuenta,
    desarrollo: { desde: fecha(sim.desde), hasta: fecha(sim.corte), ...resumen(dev) },
  };

  console.log(`Trading Pedro ${version} (${commit}) · ${ESTRATEGIA.name} · ${o.simbolo} · comisión ${num(o.comision)} %`);
  console.log(`Lecturas de 4H: ${sim.cuenta.lecturas} · con entrada: ${sim.cuenta.senales} · sin objetivo: ${sim.cuenta.sinObjetivo} · plan no válido: ${sim.cuenta.planInvalido}`);
  imprimir('DESARROLLO (para decidir mejoras)', out.desarrollo, [sim.desde, sim.corte]);
  if (o.reserva) {
    out.reserva = { desde: fecha(sim.corte), hasta: fecha(sim.hasta), ...resumen(res) };
    imprimir('RESERVA (solo para confirmar)', out.reserva, [sim.corte, sim.hasta]);
  } else {
    console.log(`\nReserva sin mirar: ${fecha(sim.corte).slice(0, 10)} a ${fecha(sim.hasta).slice(0, 10)} (usa --reserva solo para confirmar una mejora ya decidida).`);
  }
  if (o.operaciones) {
    console.log('\nOperaciones del tramo de desarrollo:');
    for (const x of dev) console.log(`  ${fecha(x.entrada)}  ${x.lado.padEnd(5)} ${fmt(x.precio).padStart(10)}  stop ${fmt(x.stop).padStart(10)}  obj ${fmt(x.objetivo).padStart(10)}  ${x.salida.padEnd(8)} ${signo(x.r).padStart(6)} R  ${String(x.horas).padStart(4)} h${x.contraDiario ? '  contra Diario' : ''}`);
  }

  const dir = path.join(ROOT, 'evaluaciones'), base = path.join(dir, 'base.json');
  if (fs.existsSync(base) && !o.fijarBase) comparar(JSON.parse(fs.readFileSync(base, 'utf8')), out);
  if (!o.noGuardar) {
    fs.mkdirSync(dir, { recursive: true });
    out.operaciones = dev; // las de la reserva no se guardan: no deben servir para ajustar
    const sello = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const f = path.join(dir, `${sello}_${o.simbolo}.json`);
    fs.writeFileSync(f, JSON.stringify(out, null, 1));
    console.log(`\nGuardado: ${path.relative(ROOT, f)}`);
    if (o.fijarBase) { fs.writeFileSync(base, JSON.stringify(out, null, 1)); console.log('Fijado como base de comparación: evaluaciones' + path.sep + 'base.json'); }
  }
}

if (require.main === module) main().catch((e) => { console.error('Error: ' + e.message); process.exit(1); });
module.exports = { leerDatos, agrupar, simular, medir };
