/* Trading Pedro: gráfico BTC/USDT con indicadores y Smart Money Concepts. */
(() => {
  const LWC = window.LightweightCharts;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ---------- almacenamiento local (puede no estar disponible) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('tp.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('tp.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  };

  const C = {
    bull: '#2ECC8F', bear: '#F0506E', accent: '#F5B841', text: '#AEB7C8',
    grid: 'rgba(255,255,255,0.035)', border: 'rgba(255,255,255,0.08)',
    ema20: '#F5B841', ema50: '#5AA9FF', sma200: '#B48CFF', ema600: '#FF7A45', bb: 'rgba(141,151,171,0.75)',
    blue: '#5AA9FF', bg: '#0B0F16',
  };

  const DEFAULT_SHOW = {
    ema20: true, ema50: true, sma200: false, ema600: true, bb: false, vol: true, rsi: true, macd: false,
    ob: true, fvg: true, structure: true, swings: true, liquidity: false, autoFib: false, activeOnly: true,
    walls: true, levels: true, sessions: true,
  };

  // Niveles de retroceso de Fibonacci (0 = final del movimiento, 1 = inicio) y su color.
  const FIB = [
    [0, '#8D97AB'], [0.236, '#F0506E'], [0.382, '#F5B841'], [0.5, '#2ECC8F'],
    [0.618, '#5AA9FF'], [0.786, '#B48CFF'], [1, '#8D97AB'], [1.618, '#F5B841'],
  ];
  const fibPrice = (d, r) => d.p2 + (d.p1 - d.p2) * r;

  const state = {
    interval: store.get('interval', '15m'),
    swing: store.get('swing', 10),
    show: Object.assign({}, DEFAULT_SHOW, store.get('show', {})),
    candles: [],
    smc: null,
    drawings: store.get('drawings', []),
    alerts: store.get('alerts', []),
    tool: 'cursor',
    pending: null,
    ghost: null,     // punto bajo el ratón mientras se dibuja una línea de tendencia
    measure: null,   // medición en curso o fijada { t1, p1, t2, p2, fixed }
    // libro de órdenes: `snap` = libro completo (cada 60 s), `live` = 20 mejores niveles en vivo
    book: { snap: null, live: null },
    // calculadora de riesgo (precios en USD; t0 = vela donde empieza el dibujo)
    calc: Object.assign({
      side: 'long', entry: null, stop: null, target: null, risk: 10, fee: '0', feeCustom: null,
      partial: false, tp1: null, tp1Pct: 50, show: true, t0: null,
    }, store.get('calc', {})),
    selected: null,  // línea de tendencia seleccionada
    hover: null,     // línea de tendencia bajo el ratón
    lastPrice: null,
  };

  // ---------- formato ----------
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const pad = (n) => String(n).padStart(2, '0');
  const fmtPrice = (p) => (p == null || isNaN(p)) ? '—'
    : Number(p).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtTime = (t) => {
    const d = new Date(t * 1000);
    return `${pad(d.getDate())} ${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fmtShort = (t) => {
    const d = new Date(t * 1000);
    return `${d.getDate()} ${MESES[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fmtPct = (v) => v.toFixed(2).replace('.', ',');
  const fmtVol = (v) => {
    const [d, u] = v >= 1e9 ? [1e9, 'B'] : v >= 1e6 ? [1e6, 'M'] : v >= 1e3 ? [1e3, 'K'] : [1, ''];
    return (v / d).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + u;
  };
  const fmtDur = (s) => {
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return [d && d + 'd', h && h + 'h', m && m + 'm'].filter(Boolean).join(' ') || '0m';
  };
  const signed = (v, f) => (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v));
  // Las marcas de año, mes y día se colocan en la medianoche UTC; se rotulan en UTC
  // para que no aparezca el día anterior en zonas horarias como la de Venezuela.
  const tickFmt = (t, type) => {
    const d = new Date(t * 1000);
    if (type === 0) return String(d.getUTCFullYear());
    if (type === 1) return MESES[d.getUTCMonth()];
    if (type === 2) return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // ---------- gráficos ----------
  const chartOptions = (timeVisible) => ({
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: C.text, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 },
    grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
    rightPriceScale: { borderColor: C.border, minimumWidth: 86 },
    timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: false, visible: timeVisible, tickMarkFormatter: tickFmt, rightOffset: 10 },
    crosshair: { mode: LWC.CrosshairMode.Normal },
    localization: { timeFormatter: fmtTime, priceFormatter: fmtPrice },
  });
  const line = (color, lineWidth = 2, extra = {}) => Object.assign(
    { color, lineWidth, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, extra);

  const mainEl = $('#chart-main');
  const chart = LWC.createChart(mainEl, chartOptions(true));
  const candles = chart.addCandlestickSeries({
    upColor: C.bull, downColor: C.bear, borderUpColor: C.bull, borderDownColor: C.bear,
    wickUpColor: C.bull, wickDownColor: C.bear,
  });
  candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.18 } });
  const volume = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
  const ema20 = chart.addLineSeries(line(C.ema20));
  const ema50 = chart.addLineSeries(line(C.ema50));
  const sma200 = chart.addLineSeries(line(C.sma200));
  const ema600 = chart.addLineSeries(line(C.ema600));
  const bbUp = chart.addLineSeries(line(C.bb, 1));
  const bbMid = chart.addLineSeries(line(C.bb, 1, { lineStyle: LWC.LineStyle.Dashed }));
  const bbLo = chart.addLineSeries(line(C.bb, 1));

  const rsiEl = $('#chart-rsi');
  const rsiChart = LWC.createChart(rsiEl, chartOptions(false));
  const rsiS = rsiChart.addLineSeries(line('#B48CFF', 2, {
    lastValueVisible: true, priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
    autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
  }));
  rsiS.createPriceLine({ price: 70, color: 'rgba(240,80,110,0.5)', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false });
  rsiS.createPriceLine({ price: 30, color: 'rgba(46,204,143,0.5)', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false });

  const macdEl = $('#chart-macd');
  const macdChart = LWC.createChart(macdEl, chartOptions(false));
  const macdHist = macdChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
  const macdLine = macdChart.addLineSeries(line('#5AA9FF', 2));
  const macdSignal = macdChart.addLineSeries(line('#F5B841', 1));

  const allCharts = [chart, rsiChart, macdChart];
  let syncing = false;
  allCharts.forEach((c) => c.timeScale().subscribeVisibleLogicalRangeChange((r) => {
    if (syncing || !r) return;
    syncing = true;
    allCharts.forEach((o) => { if (o !== c) o.timeScale().setVisibleLogicalRange(r); });
    syncing = false;
  }));

  // ---------- indicadores ----------
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

  function computeIndicators() {
    const cs = state.candles, close = cs.map((c) => c.close), times = cs.map((c) => c.time);
    const ser = (vals) => vals.map((v, i) => (v == null ? { time: times[i] } : { time: times[i], value: v }));
    const bb = bollinger(close), md = macd(close);
    return {
      vol: cs.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(46,204,143,0.35)' : 'rgba(240,80,110,0.35)' })),
      ema20: ser(ema(close, 20)), ema50: ser(ema(close, 50)), sma200: ser(sma(close, 200)),
      ema600: ser(ema(close, 600)),
      bbUp: ser(bb.up), bbMid: ser(bb.mid), bbLo: ser(bb.lo),
      rsi: ser(rsi(close)),
      macd: ser(md.m), signal: ser(md.s),
      hist: md.h.map((v, i) => (v == null ? { time: times[i] }
        : { time: times[i], value: v, color: v >= 0 ? 'rgba(46,204,143,0.6)' : 'rgba(240,80,110,0.6)' })),
    };
  }
  const SERIES = {
    vol: volume, ema20, ema50, sma200, ema600, bbUp, bbMid, bbLo,
    rsi: rsiS, macd: macdLine, signal: macdSignal, hist: macdHist,
  };

  function setAllData() {
    candles.setData(state.candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const ind = computeIndicators();
    for (const k in SERIES) SERIES[k].setData(ind[k]);
  }
  function updateLast() {
    const ind = computeIndicators();
    const c = state.candles[state.candles.length - 1];
    candles.update({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
    for (const k in SERIES) SERIES[k].update(ind[k][ind[k].length - 1]);
  }

  function applyVisibility() {
    const s = state.show;
    requestAnimationFrame(() => redraw());
    setTimeout(() => redraw(), 50);
    volume.applyOptions({ visible: s.vol });
    ema20.applyOptions({ visible: s.ema20 });
    ema50.applyOptions({ visible: s.ema50 });
    sma200.applyOptions({ visible: s.sma200 });
    ema600.applyOptions({ visible: s.ema600 });
    [bbUp, bbMid, bbLo].forEach((x) => x.applyOptions({ visible: s.bb }));
    rsiEl.classList.toggle('hidden', !s.rsi);
    macdEl.classList.toggle('hidden', !s.macd);
    // la escala de tiempo solo se ve en el panel de más abajo
    const bottom = s.macd ? macdChart : s.rsi ? rsiChart : chart;
    allCharts.forEach((c) => c.timeScale().applyOptions({ visible: c === bottom }));
    updateMarkers();
  }

  // ---------- Smart Money ----------
  function updateMarkers() {
    if (!state.show.swings || !state.smc) { candles.setMarkers(practiceMarkers().sort((a, b) => a.time - b.time)); return; }
    let lastH = null, lastL = null;
    const marks = state.smc.swings.map((s) => {
      let text;
      if (s.dir === 1) { text = lastH == null ? 'H' : s.level > lastH ? 'HH' : 'LH'; lastH = s.level; }
      else { text = lastL == null ? 'L' : s.level > lastL ? 'HL' : 'LL'; lastL = s.level; }
      return {
        time: s.time, position: s.dir === 1 ? 'aboveBar' : 'belowBar', shape: 'circle', size: 0.4,
        color: s.dir === 1 ? 'rgba(240,80,110,0.85)' : 'rgba(46,204,143,0.85)', text,
      };
    });
    candles.setMarkers(marks.concat(practiceMarkers()).sort((a, b) => a.time - b.time));
  }

  function lastStructure() {
    if (!state.smc) return null;
    const ev = state.smc.structure.filter((e) => e.broken != null).sort((a, b) => a.broken - b.broken);
    return ev[ev.length - 1] || null;
  }

  function activeZones() {
    if (!state.smc) return [];
    return [
      ...state.smc.ob.filter((z) => z.mitigated == null).map((z) => ({ ...z, type: 'Order block' })),
      ...state.smc.fvg.filter((z) => z.mitigated == null).map((z) => ({ ...z, type: 'FVG' })),
    ];
  }

  function zoneHtml(z) {
    if (!z) return '<span class="muted">ninguna</span>';
    const dir = z.dir === 1 ? '<span class="tag up">alcista</span>' : '<span class="tag down">bajista</span>';
    return `<span class="mono">${fmtPrice(z.bottom)} – ${fmtPrice(z.top)}</span><span class="zone">${z.type} ${dir}</span>`;
  }

  function updatePanel() {
    const box = $('#smc-summary');
    if (!state.smc || !state.candles.length) return;
    const p = state.lastPrice ?? state.candles[state.candles.length - 1].close;
    const ev = lastStructure();
    const zones = activeZones();
    const inside = zones.filter((z) => z.bottom <= p && z.top >= p)[0];
    const above = zones.filter((z) => z.bottom > p).sort((a, b) => a.bottom - b.bottom)[0];
    const below = zones.filter((z) => z.top < p).sort((a, b) => b.top - a.top)[0];
    const sw = state.smc.swings;
    const hi = [...sw].reverse().find((s) => s.dir === 1);
    const lo = [...sw].reverse().find((s) => s.dir === -1);

    let trend = '<p class="trend">Sin estructura clara</p><p class="sub">No hay rupturas en el rango cargado.</p>';
    if (ev) {
      const up = ev.dir === 1;
      const what = ev.kind === 'CHOCH' ? 'Último evento: CHOCH, posible cambio de tendencia' : 'Último evento: BOS, la tendencia continúa';
      trend = `<p class="trend ${up ? 'up' : 'down'}">${up ? 'Alcista ▲' : 'Bajista ▼'}</p>
        <p class="sub">${what}<br>${ev.kind} en ${fmtPrice(ev.level)} · ${fmtShort(ev.broken)}</p>`;
    }
    box.innerHTML = `${trend}
      <dl>
        <dt>Precio</dt><dd class="mono">${fmtPrice(p)}</dd>
        ${inside ? `<dt>Dentro de</dt><dd>${zoneHtml(inside)}</dd>` : ''}
        <dt>Zona arriba</dt><dd>${zoneHtml(above)}</dd>
        <dt>Zona abajo</dt><dd>${zoneHtml(below)}</dd>
        <dt>Último máximo</dt><dd class="mono">${hi ? fmtPrice(hi.level) : '—'}</dd>
        <dt>Último mínimo</dt><dd class="mono">${lo ? fmtPrice(lo.level) : '—'}</dd>
        ${fibRows()}
        ${levelRows()}
      </dl>`;
  }

  // Fibonacci automático sobre el último tramo entre dos swings (de inicio a final).
  function autoFib() {
    const sw = state.smc && state.smc.swings;
    if (!sw || sw.length < 2) return null;
    const a = sw[sw.length - 2], b = sw[sw.length - 1];
    if (a.dir === b.dir) return null;
    return { type: 'f', t1: a.time, p1: a.level, t2: b.time, p2: b.level, ext: true, auto: true };
  }

  // Filas del panel con la zona dorada del Fibonacci automático.
  function fibRows() {
    if (!state.show.autoFib) return '';
    const f = autoFib();
    if (!f) return '<dt>Fibonacci</dt><dd class="muted">sin tramo claro</dd>';
    const a = fibPrice(f, 0.5), b = fibPrice(f, 0.618);
    const leg = f.p2 > f.p1 ? 'tramo alcista' : 'tramo bajista';
    return `<dt>Fib 0,5 – 0,618</dt><dd><span class="mono">${fmtPrice(Math.min(a, b))} – ${fmtPrice(Math.max(a, b))}</span>
      <span class="zone">zona dorada del último ${leg}</span></dd>`;
  }

  // ---------- capa de dibujo (zonas SMC y líneas de tendencia) ----------
  const overlay = $('#overlay');
  const ctx = overlay.getContext('2d');
  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  // Posición lógica (índice de vela, admite decimales) de cualquier instante. Así los
  // dibujos se ven en todas las temporalidades y también en la zona futura del gráfico.
  const IV_SEC = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
  const ivSec = () => IV_SEC[state.dataInterval || state.interval] || 60;
  function timeToLogical(t) {
    const cs = state.candles, n = cs.length;
    if (!n || t == null) return null;
    if (t >= cs[n - 1].time) return n - 1 + (t - cs[n - 1].time) / ivSec();
    if (t <= cs[0].time) return (t - cs[0].time) / ivSec();
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cs[m].time <= t) lo = m; else hi = m; }
    return lo + (t - cs[lo].time) / (cs[hi].time - cs[lo].time);
  }
  function logicalToTime(l) {
    const cs = state.candles, n = cs.length;
    if (!n || l == null) return null;
    if (l >= n - 1) return Math.round(cs[n - 1].time + (l - (n - 1)) * ivSec());
    if (l <= 0) return Math.round(cs[0].time + l * ivSec());
    const i = Math.floor(l);
    return Math.round(cs[i].time + (l - i) * (cs[i + 1].time - cs[i].time));
  }
  const XL = (t) => { const l = timeToLogical(t); return l == null ? null : chart.timeScale().logicalToCoordinate(l); };
  // Punto del gráfico bajo unas coordenadas; `snap` lo ajusta a la vela más cercana.
  function pointAt(x, y, snap = true) {
    let l = chart.timeScale().coordinateToLogical(x);
    const p = candles.coordinateToPrice(y);
    if (l == null || p == null) return null;
    if (snap) l = Math.round(l);
    return { t: logicalToTime(l), p };
  }
  function paneSize() {
    const ts = chart.timeScale();
    return {
      w: mainEl.clientWidth - chart.priceScale('right').width(),
      h: mainEl.clientHeight - (ts.options().visible ? ts.height() : 0),
    };
  }
  // Diferencia de precio, %, barras, duración y volumen entre dos puntos.
  function spanStats(t1, p1, t2, p2) {
    const l1 = timeToLogical(t1), l2 = timeToLogical(t2);
    const bars = Math.round(l2 - l1), diff = p2 - p1;
    let vol = 0;
    const a = Math.max(0, Math.ceil(Math.min(l1, l2))), b = Math.min(state.candles.length - 1, Math.floor(Math.max(l1, l2)));
    for (let i = a; i <= b; i++) vol += state.candles[i].volume;
    return { bars, diff, pct: p1 ? (diff / p1) * 100 : 0, vol, secs: Math.abs(bars) * ivSec() };
  }
  // Coordenadas en pantalla de una línea de tendencia (con su extensión, si la tiene).
  // Precio de la línea base (t1,p1)-(t2,p2) en la posición lógica l (para canales).
  function baseAt(d, l) {
    const l1 = timeToLogical(d.t1), l2 = timeToLogical(d.t2);
    if (l1 == null || l2 == null || l1 === l2) return d.p1;
    return d.p1 + ((d.p2 - d.p1) * (l - l1)) / (l2 - l1);
  }
  const noteBoxes = new Map(); // nota -> caja en pantalla (para seleccionarla)
  function trendGeom(d) {
    const x1 = XL(d.t1), x2 = XL(d.t2), y1 = candles.priceToCoordinate(d.p1), y2 = candles.priceToCoordinate(d.p2);
    if ([x1, x2, y1, y2].some((v) => v == null)) return null;
    let ex = x2, ey = y2;
    if (d.ext && Math.abs(x2 - x1) > 0.5) {
      ex = x2 > x1 ? Math.max(x2, paneSize().w) : Math.min(x2, 0);
      ey = y1 + ((y2 - y1) * (ex - x1)) / (x2 - x1);
    }
    return { x1, y1, x2, y2, ex, ey };
  }

  // Etiqueta con fondo; ax: 'left' | 'center' | 'right', ay: 'top' | 'middle' | 'bottom'.
  function tag(lines, x, y, bg, fg, ax, ay) {
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    const lh = 17, pad = 8, { w: pw, h: ph } = paneSize();
    const w = Math.max(...lines.map((s) => ctx.measureText(s).width)) + pad * 2, h = lines.length * lh + pad;
    let left = ax === 'center' ? x - w / 2 : ax === 'right' ? x - w : x;
    // si no cabe a un lado del punto, se pasa al otro (x viene separado 12 px del punto)
    if (ax === 'left' && left + w > pw - 4) left = x - 24 - w;
    if (ax === 'right' && left < 4) left = x + 24;
    let top = ay === 'bottom' ? y - h : ay === 'middle' ? y - h / 2 : y;
    left = Math.max(4, Math.min(pw - w - 4, left)); top = Math.max(4, Math.min(ph - h - 4, top));
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(left, top, w, h, 5); else ctx.rect(left, top, w, h);
    ctx.fill();
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((s, i) => ctx.fillText(s, left + w / 2, top + pad / 2 + lh * i + lh / 2));
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  function arrow(x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 10) return;
    const a = Math.atan2(y2 - y1, x2 - x1), s = 7;
    ctx.beginPath();
    ctx.moveTo(x2 - s * Math.cos(a - 0.5), y2 - s * Math.sin(a - 0.5));
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - s * Math.cos(a + 0.5), y2 - s * Math.sin(a + 0.5));
    ctx.stroke();
  }

  function drawOverlay() {
    const w = mainEl.clientWidth, h = mainEl.clientHeight, dpr = window.devicePixelRatio || 1;
    if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) {
      overlay.width = Math.round(w * dpr); overlay.height = Math.round(h * dpr);
      overlay.style.width = w + 'px'; overlay.style.height = h + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!state.candles.length) return;

    const ts = chart.timeScale();
    // ts.width() vale 0 cuando la escala de tiempo de este panel está oculta
    const paneW = w - chart.priceScale('right').width();
    const paneH = h - (ts.options().visible ? ts.height() : 0);
    const X = (t) => (t == null ? null : ts.timeToCoordinate(t));
    const Y = (p) => candles.priceToCoordinate(p);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, paneW, paneH); ctx.clip();
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';

    drawSessions(paneW, paneH);
    drawLevels(ctx, candles, paneW);

    const s = state.smc, only = state.show.activeOnly;
    const box = (t1, t2, top, bot, color, alpha, border, label) => {
      const x1 = X(t1); if (x1 == null) return;
      const x2 = t2 == null ? paneW : X(t2); if (x2 == null) return;
      const y1 = Y(top), y2 = Y(bot); if (y1 == null || y2 == null) return;
      ctx.fillStyle = rgba(color, alpha);
      ctx.fillRect(x1, y1, Math.max(2, x2 - x1), Math.max(1, y2 - y1));
      if (border) {
        ctx.strokeStyle = rgba(color, 0.7); ctx.lineWidth = 1;
        ctx.strokeRect(x1 + 0.5, y1 + 0.5, Math.max(2, x2 - x1) - 1, Math.max(1, y2 - y1) - 1);
      }
      if (label && y2 - y1 > 11) { ctx.fillStyle = rgba(color, 0.95); ctx.fillText(label, x1 + 4, y1 + 11); }
    };

    if (s && state.show.fvg) {
      s.fvg.forEach((z) => {
        if (only && z.mitigated != null) return;
        box(z.time, z.mitigated, z.top, z.bottom, z.dir === 1 ? C.bull : C.bear, z.mitigated == null ? 0.16 : 0.07, false, z.mitigated == null ? 'FVG' : '');
      });
    }
    if (s && state.show.ob) {
      s.ob.forEach((z) => {
        if (only && z.mitigated != null) return;
        const label = `OB ${z.dir === 1 ? '▲' : '▼'} ${Math.round(z.strength || 0)}%`;
        box(z.time, z.mitigated, z.top, z.bottom, z.dir === 1 ? C.bull : C.bear, z.mitigated == null ? 0.22 : 0.08, z.mitigated == null, label);
      });
    }
    if (s && state.show.liquidity) {
      s.liquidity.forEach((l) => {
        if (only && l.swept != null) return;
        const x1 = X(l.time), x2 = X(l.swept ?? l.end) ?? paneW, y = Y(l.level);
        if (x1 == null || y == null) return;
        ctx.strokeStyle = rgba(C.accent, 0.85); ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = C.accent; ctx.fillText('$$$', x1 + 3, l.dir === 1 ? y - 4 : y + 12);
      });
    }
    if (s && state.show.structure) {
      let ev = s.structure;
      if (only) ev = [...ev].filter((e) => e.broken != null).sort((a, b) => a.broken - b.broken).slice(-6);
      ev.forEach((e) => {
        const x1 = X(e.time), x2 = e.broken == null ? paneW : X(e.broken), y = Y(e.level);
        if (x1 == null || x2 == null || y == null) return;
        const col = e.dir === 1 ? C.bull : C.bear;
        ctx.strokeStyle = col; ctx.lineWidth = e.kind === 'CHOCH' ? 1.5 : 1;
        ctx.setLineDash(e.kind === 'CHOCH' ? [6, 3] : []);
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.setLineDash([]);
        const tw = ctx.measureText(e.kind).width;
        ctx.fillStyle = col;
        ctx.fillText(e.kind, (x1 + x2) / 2 - tw / 2, e.dir === 1 ? y - 4 : y + 12);
      });
    }

    drawWalls(paneW, paneH);
    drawCalc(paneW);

    // Fibonacci: niveles horizontales entre el inicio (1) y el final (0) del movimiento.
    // La zona 0,5 – 0,618 (la "zona dorada") se sombrea un poco más.
    const drawFib = (d) => {
      const x1 = XL(d.t1), x2 = XL(d.t2);
      if (x1 == null || x2 == null) return;
      const left = Math.min(x1, x2), right = d.ext ? paneW : Math.max(x1, x2);
      const ys = FIB.map(([r]) => Y(fibPrice(d, r)));
      if (ys.some((y) => y == null)) return;
      const yA = Y(fibPrice(d, 0.5)), yB = Y(fibPrice(d, 0.618));
      ctx.fillStyle = rgba(C.accent, 0.08);
      ctx.fillRect(left, Math.min(yA, yB), right - left, Math.abs(yB - yA));
      ctx.font = '600 10px Inter, system-ui, sans-serif';
      FIB.forEach(([r, col], i) => {
        ctx.strokeStyle = rgba(col, r === 1.618 ? 0.55 : 0.9);
        ctx.lineWidth = r === 0.618 || r === 0.5 ? 1.5 : 1;
        ctx.setLineDash(d.auto ? [6, 4] : []);
        ctx.beginPath(); ctx.moveTo(left, ys[i]); ctx.lineTo(right, ys[i]); ctx.stroke();
        ctx.setLineDash([]);
      });
      // Etiquetas solo donde caben, empezando por los niveles más usados.
      const placed = [];
      [0.618, 0.5, 0, 1, 0.382, 0.786, 0.236, 1.618].forEach((r) => {
        const i = FIB.findIndex(([v]) => v === r), y = ys[i];
        if (placed.some((py) => Math.abs(py - y) < 12)) return;
        placed.push(y);
        ctx.fillStyle = FIB[i][1];
        const label = `${d.auto && r === 0 ? 'Fib auto  ' : ''}${String(r).replace('.', ',')} (${fmtPrice(fibPrice(d, r))})`;
        ctx.fillText(label, left + 4, y - 3);
      });
      // diagonal del movimiento medido
      ctx.strokeStyle = rgba('#8D97AB', 0.6); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x1, Y(d.p1)); ctx.lineTo(x2, Y(d.p2)); ctx.stroke(); ctx.setLineDash([]);
      if (d === state.selected || d === state.hover) {
        ctx.lineWidth = 2; ctx.strokeStyle = C.blue; ctx.fillStyle = C.bg;
        [[x1, Y(d.p1)], [x2, Y(d.p2)]].forEach(([x, y]) => {
          ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        });
      }
    };
    if (state.show.autoFib) { const af = autoFib(); if (af) drawFib(af); }
    state.drawings.filter((d) => d.type === 'f').forEach(drawFib);
    if (state.tool === 'fib' && state.pending && state.ghost) {
      drawFib({ t1: state.pending.t, p1: state.pending.p, t2: state.ghost.t, p2: state.ghost.p });
    }

    // ---- rectángulos, canales, rayos y notas ----
    const active = (d) => d === state.selected || d === state.hover;
    const handlesAt = (pts) => {
      ctx.lineWidth = 2; ctx.strokeStyle = C.blue; ctx.fillStyle = C.bg;
      pts.forEach(([hx, hy]) => { ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    };
    const drawRect = (d, preview) => {
      const g = trendGeom({ ...d, ext: false }); if (!g) return;
      const left = Math.min(g.x1, g.x2), right = d.ext ? paneW : Math.max(g.x1, g.x2);
      const top = Math.min(g.y1, g.y2), h = Math.abs(g.y2 - g.y1), col = d.color || C.blue;
      ctx.fillStyle = rgba(col, 0.14); ctx.fillRect(left, top, right - left, h);
      ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = d.width || 1; ctx.setLineDash(preview ? [5, 4] : []);
      ctx.strokeRect(left, top, right - left, h); ctx.setLineDash([]);
      if (!preview && active(d)) handlesAt([[g.x1, g.y1], [g.x2, g.y2]]);
    };
    const drawChannel = (d, preview) => {
      const a = trendGeom(d), b = trendGeom({ ...d, p1: d.p1 + d.dp, p2: d.p2 + d.dp });
      if (!a || !b) return;
      const col = d.color || C.blue;
      ctx.fillStyle = rgba(col, 0.08);
      ctx.beginPath(); ctx.moveTo(a.x1, a.y1); ctx.lineTo(a.ex, a.ey); ctx.lineTo(b.ex, b.ey); ctx.lineTo(b.x1, b.y1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = d.width || 2; ctx.setLineDash(preview ? [5, 4] : []);
      [[a.x1, a.y1, a.ex, a.ey], [b.x1, b.y1, b.ex, b.ey]].forEach(([x1, y1, x2, y2]) => {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      });
      // línea media discontinua, como en TradingView
      ctx.strokeStyle = rgba(col, 0.5); ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(a.x1, (a.y1 + b.y1) / 2); ctx.lineTo(a.ex, (a.ey + b.ey) / 2); ctx.stroke(); ctx.setLineDash([]);
      if (!preview && active(d)) handlesAt([[a.x1, a.y1], [a.x2, a.y2], [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2]]);
    };
    const drawRay = (d) => {
      const x1 = XL(d.t1), y = Y(d.p1); if (x1 == null || y == null) return;
      const col = d.color || C.accent;
      ctx.strokeStyle = col; ctx.lineWidth = d.width || 1;
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(paneW, y); ctx.stroke();
      ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.fillStyle = col; ctx.textBaseline = 'bottom';
      const txt = fmtPrice(d.p1), tw = ctx.measureText(txt).width;
      ctx.fillText(txt, Math.max(x1 + 4, paneW - tw - 8), y - 2); ctx.textBaseline = 'alphabetic';
      if (active(d)) handlesAt([[x1, y]]);
    };
    const drawNote = (d) => {
      const x = XL(d.t1), y = Y(d.p1); if (x == null || y == null) return;
      ctx.font = '500 12px Inter, system-ui, sans-serif';
      const lines = String(d.text || '').split('\n').slice(0, 6);
      const w = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 14, h = lines.length * 16 + 8;
      const col = d.color || '#D5DCEA';
      ctx.fillStyle = 'rgba(22,30,45,0.9)'; ctx.strokeStyle = active(d) ? C.blue : rgba(col, 0.7); ctx.lineWidth = 1;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y - h / 2, w, h, 5); else ctx.rect(x, y - h / 2, w, h);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.textBaseline = 'middle';
      lines.forEach((t, i) => ctx.fillText(t, x + 7, y - h / 2 + 4 + 8 + i * 16));
      ctx.textBaseline = 'alphabetic';
      noteBoxes.set(d, { x, y: y - h / 2, w, h });
    };
    noteBoxes.clear();
    state.drawings.forEach((d) => {
      if (d.type === 'r') drawRect(d); else if (d.type === 'c') drawChannel(d);
      else if (d.type === 'ray') drawRay(d); else if (d.type === 'n') drawNote(d);
    });
    if (state.tool === 'rect' && state.pending && state.ghost) {
      drawRect({ t1: state.pending.t, p1: state.pending.p, t2: state.ghost.t, p2: state.ghost.p }, true);
    }
    if (state.tool === 'channel' && state.pending2 && state.ghost) {
      const base = { t1: state.pending.t, p1: state.pending.p, t2: state.pending2.t, p2: state.pending2.p };
      drawChannel({ ...base, dp: state.ghost.p - baseAt(base, timeToLogical(state.ghost.t)) }, true);
    }

    // líneas de tendencia del usuario; la seleccionada o bajo el ratón muestra sus
    // extremos (para estirarla) y la diferencia de precio entre ellos
    state.drawings.filter((d) => d.type === 't').forEach((d) => {
      const g = trendGeom(d); if (!g) return;
      ctx.strokeStyle = d.color || C.accent; ctx.lineWidth = d.width || 2;
      ctx.beginPath(); ctx.moveTo(g.x1, g.y1); ctx.lineTo(g.ex, g.ey); ctx.stroke();
      if (d !== state.selected && d !== state.hover) return;
      ctx.lineWidth = 2; ctx.strokeStyle = C.blue; ctx.fillStyle = C.bg;
      [[g.x1, g.y1], [g.x2, g.y2]].forEach(([x, y]) => {
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
      const st = spanStats(d.t1, d.p1, d.t2, d.p2);
      tag([`⇕ ${signed(st.diff, fmtPrice)} (${signed(st.pct, fmtPct)}%) · ${st.bars} barras`],
        g.x2 + (g.x2 >= g.x1 ? 12 : -12), g.y2, 'rgba(22,30,45,0.92)', '#D5DCEA', g.x2 >= g.x1 ? 'left' : 'right', 'middle');
    });
    if (state.pending && state.tool !== 'rect' && !state.pending2) {
      const x = XL(state.pending.t), y = Y(state.pending.p);
      ctx.fillStyle = C.accent; ctx.strokeStyle = C.accent;
      if (x != null && y != null) {
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        const gx = state.ghost && XL(state.ghost.t), gy = state.ghost && Y(state.ghost.p);
        if (gx != null && gy != null) {
          ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(gx, gy); ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }

    // medición (como la herramienta "Medir" de TradingView)
    const m = state.measure;
    if (m) {
      const x1 = XL(m.t1), x2 = XL(m.t2), y1 = Y(m.p1), y2 = Y(m.p2);
      if (![x1, x2, y1, y2].some((v) => v == null)) {
        const up = m.p2 >= m.p1, col = up ? C.blue : C.bear;
        ctx.fillStyle = rgba(col, 0.2);
        ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        const xm = (x1 + x2) / 2, ym = (y1 + y2) / 2;
        arrow(xm, y1, xm, y2);
        arrow(x1, ym, x2, ym);
        const st = spanStats(m.t1, m.p1, m.t2, m.p2);
        tag([
          `${signed(st.diff, fmtPrice)} (${signed(st.pct, fmtPct)}%)`,
          `${st.bars} barras, ${fmtDur(st.secs)}`,
          `Vol. ${fmtVol(st.vol)}`,
        ], xm, up ? Math.min(y1, y2) - 8 : Math.max(y1, y2) + 8, rgba(col, 0.95), '#FFFFFF', 'center', up ? 'bottom' : 'top');
      }
    }
    ctx.restore();
  }
  // Se redibuja con cada cambio del gráfico y, además, en cada fotograma para
  // seguir el arrastre de la escala de precios (que no emite eventos).
  const redraw = () => { try { drawOverlay(); } catch (e) { console.error(e); } };
  chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
  chart.timeScale().subscribeSizeChange(redraw);
  chart.subscribeCrosshairMove(redraw);
  new ResizeObserver(redraw).observe(mainEl);
  (function loop() { redraw(); requestAnimationFrame(loop); })();

  // ---------- leyenda OHLC ----------
  const legend = $('#legend');
  function setLegend(c) {
    if (!c) { legend.innerHTML = ''; return; }
    const ch = ((c.close - c.open) / c.open) * 100;
    const col = c.close >= c.open ? C.bull : C.bear;
    legend.innerHTML = `<span>A <b>${fmtPrice(c.open)}</b></span><span>Máx <b>${fmtPrice(c.high)}</b></span>
      <span>Mín <b>${fmtPrice(c.low)}</b></span><span>C <b>${fmtPrice(c.close)}</b></span>
      <span style="color:${col}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</span>`;
  }
  chart.subscribeCrosshairMove((param) => {
    const d = param.time ? param.seriesData.get(candles) : null;
    setLegend(d || state.candles[state.candles.length - 1]);
  });

  // ---------- dibujo de líneas horizontales y alertas ----------
  let priceLines = [];
  function renderPriceLines() {
    priceLines.forEach((pl) => candles.removePriceLine(pl));
    priceLines = [];
    state.drawings.filter((d) => d.type === 'h').forEach((d) => priceLines.push(candles.createPriceLine({
      price: d.price, color: C.accent, lineWidth: 1, lineStyle: LWC.LineStyle.Solid, axisLabelVisible: true, title: '',
    })));
    state.alerts.forEach((a) => priceLines.push(candles.createPriceLine({
      price: a.price, color: '#E7C6FF', lineWidth: 1, lineStyle: LWC.LineStyle.LargeDashed, axisLabelVisible: true, title: '🔔',
    })));
  }
  const saveDrawings = () => store.set('drawings', state.drawings);

  const HINTS = {
    hline: 'Haz clic en el precio donde quieres la línea',
    trend: 'Clic en el primer punto…',
    ray: 'Haz clic donde empieza el nivel',
    rect: 'Clic en una esquina de la zona…',
    channel: 'Clic en el primer punto de la línea base…',
    note: 'Haz clic donde quieres la nota',
    fib: 'Clic en el inicio del movimiento (un máximo o un mínimo)…',
    measure: 'Clic en el punto inicial de la medida…',
    alert: 'Haz clic en el precio de la alerta',
  };
  function setTool(tool) {
    state.tool = tool; state.pending = null; state.pending2 = null; state.ghost = null;
    if (state.measure && !state.measure.fixed) state.measure = null;
    if (tool !== 'cursor') select(null);
    $$('#tools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
    mainEl.classList.toggle('drawing', tool !== 'cursor');
    const hint = $('#hint');
    hint.textContent = HINTS[tool] || '';
    hint.classList.toggle('show', tool !== 'cursor');
  }

  // Clic sobre el gráfico (x, y en píxeles del panel). Shift + clic empieza una medida,
  // como en TradingView.
  function onChartClick(x, y, shift) {
    if (rp.on && rp.picking) { rpPick(x); return; }
    if (state.tool === 'cursor' && shift) { state.measure = null; setTool('measure'); }
    if (state.tool === 'cursor') return;
    const price = candles.coordinateToPrice(y);
    if (price == null) return;
    if (state.tool === 'hline') {
      state.drawings.push({ type: 'h', price }); saveDrawings(); renderPriceLines(); setTool('cursor');
    } else if (state.tool === 'ray' || state.tool === 'note') {
      const pt = pointAt(x, y);
      if (!pt) return;
      let d;
      if (state.tool === 'ray') d = { type: 'ray', t1: pt.t, p1: pt.p, t2: pt.t, p2: pt.p, color: C.accent, width: 1 };
      else {
        const text = (window.prompt('Texto de la nota:') || '').trim();
        if (!text) { setTool('cursor'); return; }
        d = { type: 'n', t1: pt.t, p1: pt.p, t2: pt.t, p2: pt.p, text, color: '#D5DCEA' };
      }
      state.drawings.push(d); saveDrawings(); setTool('cursor'); select(d);
    } else if (state.tool === 'channel') {
      const pt = pointAt(x, y);
      if (!pt) return;
      if (!state.pending) { state.pending = pt; $('#hint').textContent = 'Ahora clic en el segundo punto de la línea base'; return; }
      if (!state.pending2) { state.pending2 = pt; $('#hint').textContent = 'Mueve el ratón para el ancho del canal y haz clic'; return; }
      const base = { t1: state.pending.t, p1: state.pending.p, t2: state.pending2.t, p2: state.pending2.p };
      const d = { type: 'c', ...base, dp: pt.p - baseAt(base, timeToLogical(pt.t)), color: C.blue, width: 2 };
      state.drawings.push(d); saveDrawings(); setTool('cursor'); select(d);
    } else if (state.tool === 'trend' || state.tool === 'fib' || state.tool === 'rect') {
      const pt = pointAt(x, y);
      if (!pt) return;
      if (!state.pending) {
        state.pending = pt;
        $('#hint').textContent = state.tool === 'fib' ? 'Ahora clic en el final del movimiento'
          : state.tool === 'rect' ? 'Ahora clic en la esquina opuesta' : 'Ahora clic en el segundo punto';
      } else {
        const d = state.tool === 'fib'
          ? { type: 'f', t1: state.pending.t, p1: state.pending.p, t2: pt.t, p2: pt.p, ext: true }
          : state.tool === 'rect'
            ? { type: 'r', t1: state.pending.t, p1: state.pending.p, t2: pt.t, p2: pt.p, color: C.blue, width: 1 }
            : { type: 't', t1: state.pending.t, p1: state.pending.p, t2: pt.t, p2: pt.p, color: C.accent, width: 2 };
        state.drawings.push(d);
        saveDrawings(); setTool('cursor'); select(d);
      }
    } else if (state.tool === 'measure') {
      const pt = pointAt(x, y);
      if (!pt) return;
      if (!state.measure) {
        state.measure = { t1: pt.t, p1: pt.p, t2: pt.t, p2: pt.p, fixed: false };
        $('#hint').textContent = 'Mueve el ratón y haz clic para fijar la medida';
      } else {
        Object.assign(state.measure, { t2: pt.t, p2: pt.p, fixed: true });
        setTool('cursor');
      }
    } else if (state.tool === 'alert') {
      addAlert(Math.round(price * 100) / 100); setTool('cursor');
    }
  }

  // La medida y la vista previa de la línea siguen al ratón.
  chart.subscribeCrosshairMove((param) => {
    if (!param.point) return;
    const m = state.measure;
    if (m && !m.fixed) {
      const pt = pointAt(param.point.x, param.point.y);
      if (pt) { m.t2 = pt.t; m.p2 = pt.p; }
    }
    if (['trend', 'fib', 'rect', 'channel'].includes(state.tool) && state.pending) state.ghost = pointAt(param.point.x, param.point.y);
  });

  // ---------- edición de líneas de tendencia (seleccionar, arrastrar, borrar) ----------
  const bar = $('#draw-bar');
  let drag = null;
  const localXY = (e) => { const r = mainEl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    const k = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
    return Math.hypot(px - (x1 + k * dx), py - (y1 + k * dy));
  }
  // Qué parte de qué línea hay bajo el ratón: part 1/2 = extremos, 0 = el trazo.
  function hitTest(x, y) {
    const list = state.drawings.filter((d) => ['t', 'f', 'r', 'c', 'ray', 'n'].includes(d.type)).reverse();
    const order = state.selected ? [state.selected, ...list.filter((d) => d !== state.selected)] : list;
    const geoms = order.map((d) => [d, d.type === 'n' ? {} : trendGeom(d.type === 'r' ? { ...d, ext: false } : d)]).filter(([, g]) => g);
    const pw = paneSize().w;
    for (const [d, g] of geoms) {
      if (d.type === 'n') continue;
      if (Math.hypot(x - g.x1, y - g.y1) <= 8) return { d, part: 1 };
      if (d.type !== 'ray' && Math.hypot(x - g.x2, y - g.y2) <= 8) return { d, part: 2 };
      if (d.type === 'c') {
        const b = trendGeom({ ...d, p1: d.p1 + d.dp, p2: d.p2 + d.dp });
        if (b && Math.hypot(x - (b.x1 + b.x2) / 2, y - (b.y1 + b.y2) / 2) <= 8) return { d, part: 3 };
      }
    }
    for (const [d, g] of geoms) {
      if (d.type === 'n') {
        const bx = noteBoxes.get(d);
        if (bx && x >= bx.x && x <= bx.x + bx.w && y >= bx.y && y <= bx.y + bx.h) return { d, part: 0 };
        continue;
      }
      if (d.type === 't' && distToSeg(x, y, g.x1, g.y1, g.ex, g.ey) <= 6) return { d, part: 0 };
      if (d.type === 'ray' && x >= g.x1 - 4 && Math.abs(y - g.y1) <= 5) return { d, part: 0 };
      if (d.type === 'r') {
        // se agarra por el borde, para que dentro de la zona el gráfico siga moviéndose
        const l = Math.min(g.x1, g.x2), r = d.ext ? pw : Math.max(g.x1, g.x2), t = Math.min(g.y1, g.y2), b = Math.max(g.y1, g.y2);
        const nearV = (x >= l - 5 && x <= r + 5) && (Math.abs(y - t) <= 5 || Math.abs(y - b) <= 5);
        const nearH = (y >= t - 5 && y <= b + 5) && (Math.abs(x - l) <= 5 || Math.abs(x - r) <= 5);
        if (nearV || nearH) return { d, part: 0 };
      }
      if (d.type === 'c') {
        const b = trendGeom({ ...d, p1: d.p1 + d.dp, p2: d.p2 + d.dp });
        if (distToSeg(x, y, g.x1, g.y1, g.ex, g.ey) <= 6 || (b && distToSeg(x, y, b.x1, b.y1, b.ex, b.ey) <= 6)) return { d, part: 0 };
      }
      if (d.type === 'f') {
        // un Fibonacci se agarra por cualquiera de sus niveles o por su diagonal
        const left = Math.min(g.x1, g.x2), right = d.ext ? paneSize().w : Math.max(g.x1, g.x2);
        const onLevel = x >= left && x <= right && FIB.some(([r]) => {
          const ly = candles.priceToCoordinate(fibPrice(d, r));
          return ly != null && Math.abs(y - ly) <= 4;
        });
        if (onLevel || distToSeg(x, y, g.x1, g.y1, g.x2, g.y2) <= 6) return { d, part: 0 };
      }
    }
    return null;
  }
  function setHover(hit) {
    state.hover = hit ? hit.d : null;
    mainEl.classList.toggle('over-line', !!hit && hit.part === 0);
    mainEl.classList.toggle('over-handle', !!hit && hit.part !== 0);
  }
  function syncBar() {
    const d = state.selected;
    bar.hidden = !d;
    if (!d) return;
    bar.classList.toggle('is-fib', d.type === 'f'); // el Fibonacci tiene sus propios colores
    bar.classList.toggle('is-note', d.type === 'n');
    bar.classList.toggle('no-ext', d.type === 'n' || d.type === 'ray');
    bar.classList.toggle('no-width', d.type === 'n');
    $$('#draw-bar [data-color]').forEach((b) => b.classList.toggle('on', b.dataset.color === (d.color || C.accent)));
    bar.querySelector('[data-width]').textContent = `${d.width || 2}px`;
    bar.querySelector('[data-ext]').classList.toggle('on', !!d.ext);
  }
  function select(d) { state.selected = d; syncBar(); }
  function deleteSelected() {
    state.drawings = state.drawings.filter((d) => d !== state.selected);
    select(null); setHover(null); saveDrawings();
  }

  // Los clics se detectan aquí y no con chart.subscribeClick: el gráfico ignora un
  // segundo clic rápido lejos del primero (lo trata como un doble clic fallido).
  // Se escucha en fase de captura para que, al agarrar una línea, el gráfico no se desplace.
  let downAt = null;
  mainEl.addEventListener('pointerdown', (e) => {
    downAt = null;
    if (e.button !== 0 || e.target.closest('#draw-bar')) return;
    const { x, y } = localXY(e), pane = paneSize();
    if (x > pane.w || y > pane.h) return;
    downAt = { x, y, shift: e.shiftKey };
    if (rp.on && rp.picking) return; // eligiendo la vela de inicio: no se agarran dibujos
    if (state.tool !== 'cursor' || e.shiftKey) return;
    if (state.measure && state.measure.fixed) state.measure = null; // el siguiente clic quita la medida
    const ck = calcHit(x, y);
    if (ck) {
      // arrastrar una línea de la calculadora (entrada, stop u objetivo)
      e.preventDefault(); e.stopPropagation();
      drag = { calc: ck, moved: false };
      chart.applyOptions({ handleScroll: false, handleScale: false });
      try { mainEl.setPointerCapture(e.pointerId); } catch { /* sin captura: el arrastre sigue funcionando */ }
      mainEl.classList.add('dragging');
      return;
    }
    const hit = hitTest(x, y);
    if (!hit) { if (state.selected) select(null); return; }
    e.preventDefault(); e.stopPropagation();
    select(hit.d);
    drag = { ...hit, orig: { ...hit.d }, startL: chart.timeScale().coordinateToLogical(x), startP: candles.coordinateToPrice(y), moved: false };
    chart.applyOptions({ handleScroll: false, handleScale: false });
    try { mainEl.setPointerCapture(e.pointerId); } catch { /* sin captura: el arrastre sigue funcionando */ }
    mainEl.classList.add('dragging');
  }, true);

  mainEl.addEventListener('pointermove', (e) => {
    if (e.target.closest('#draw-bar')) return;
    const { x, y } = localXY(e);
    if (!drag) {
      const overCalc = state.tool === 'cursor' && !!calcHit(x, y);
      mainEl.classList.toggle('over-calc', overCalc);
      setHover(state.tool === 'cursor' && !overCalc ? hitTest(x, y) : null);
      return;
    }
    if (drag.calc) {
      const p = candles.coordinateToPrice(y);
      if (p == null) return;
      state.calc[drag.calc] = Math.round(p * 100) / 100;
      drag.moved = true;
      renderCalc();
      return;
    }
    const l = chart.timeScale().coordinateToLogical(x), p = candles.coordinateToPrice(y);
    if (l == null || p == null || drag.startL == null || drag.startP == null) return;
    const d = drag.d, o = drag.orig;
    if (drag.part === 3) { d.dp = p - baseAt(d, l); }
    else if (drag.part === 1) { d.t1 = logicalToTime(Math.round(l)); d.p1 = p; }
    else if (drag.part === 2) { d.t2 = logicalToTime(Math.round(l)); d.p2 = p; }
    else {
      const dl = Math.round(l - drag.startL), dp = p - drag.startP;
      d.t1 = logicalToTime(timeToLogical(o.t1) + dl); d.p1 = o.p1 + dp;
      d.t2 = logicalToTime(timeToLogical(o.t2) + dl); d.p2 = o.p2 + dp;
    }
    if (d.type === 'ray' || d.type === 'n') { d.t2 = d.t1; d.p2 = d.p1; }
    drag.moved = true;
  });

  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) { if (drag.calc) saveCalc(); else saveDrawings(); }
    drag = null;
    chart.applyOptions({ handleScroll: true, handleScale: true });
    mainEl.classList.remove('dragging');
  };
  mainEl.addEventListener('pointerup', (e) => {
    const wasDrag = !!drag, down = downAt;
    endDrag(); downAt = null;
    if (wasDrag || !down) return;
    const { x, y } = localXY(e);
    if (Math.hypot(x - down.x, y - down.y) < 5) onChartClick(x, y, down.shift); // clic sin arrastrar
  }, true);
  mainEl.addEventListener('pointercancel', () => { endDrag(); downAt = null; });
  mainEl.addEventListener('pointerleave', () => { if (!drag) { setHover(null); mainEl.classList.remove('over-calc'); } });

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button'), d = state.selected;
    if (!b || !d) return;
    if (b.dataset.color) d.color = b.dataset.color;
    else if ('width' in b.dataset) d.width = ((d.width || 2) % 4) + 1;
    else if ('ext' in b.dataset) d.ext = !d.ext;
    else if ('del' in b.dataset) { deleteSelected(); return; }
    else if ('edit' in b.dataset) { editNote(d); return; }
    saveDrawings(); syncBar();
  });

  function editNote(d) {
    if (!d || d.type !== 'n') return;
    const text = window.prompt('Texto de la nota:', d.text || '');
    if (text == null) return;
    if (!text.trim()) { deleteSelected(); return; }
    d.text = text.trim(); saveDrawings();
  }
  mainEl.addEventListener('dblclick', (e) => {
    const { x, y } = localXY(e), hit = hitTest(x, y);
    if (hit && hit.d.type === 'n') { e.preventDefault(); e.stopPropagation(); select(hit.d); editNote(hit.d); }
  }, true);

  // ---------- alertas ----------
  let audio;
  function beep() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25].forEach((delay) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.15, audio.currentTime + delay);
        g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + delay + 0.2);
        o.start(audio.currentTime + delay); o.stop(audio.currentTime + delay + 0.2);
      });
    } catch { /* sin audio */ }
  }
  function toast(msg, err) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 7000);
  }
  function addAlert(price) {
    if (!price || isNaN(price)) return;
    const ref = state.lastPrice ?? state.candles[state.candles.length - 1]?.close;
    if (ref == null) return;
    state.alerts.push({ id: Date.now(), price, above: price > ref });
    store.set('alerts', state.alerts);
    renderAlerts(); renderPriceLines();
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch { /* sin audio */ }
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }
  function removeAlert(id) {
    state.alerts = state.alerts.filter((a) => a.id !== id);
    store.set('alerts', state.alerts);
    renderAlerts(); renderPriceLines();
  }
  function renderAlerts() {
    const ul = $('#alert-list');
    if (!state.alerts.length) { ul.innerHTML = '<li class="empty">Sin alertas. También puedes usar la campana de la barra izquierda.</li>'; return; }
    ul.innerHTML = state.alerts.map((a) => `<li><span>${a.above ? '▲ sube a' : '▼ baja a'} <b class="mono">${fmtPrice(a.price)}</b></span>
      <button data-del="${a.id}" title="Quitar">×</button></li>`).join('');
  }
  $('#alert-list').addEventListener('click', (e) => {
    const id = e.target.closest('[data-del]')?.dataset.del;
    if (id) removeAlert(Number(id));
  });
  $('#alert-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseFloat($('#alert-price').value);
    if (!isNaN(v)) { addAlert(v); $('#alert-price').value = ''; }
  });
  function checkAlerts(price) {
    if (rp.on) return; // los precios de la repetición no disparan alertas reales
    const hit = state.alerts.filter((a) => (a.above ? price >= a.price : price <= a.price));
    if (!hit.length) return;
    hit.forEach((a) => {
      notify(`BTC ${a.above ? 'subió a' : 'bajó a'} ${fmtPrice(a.price)} (ahora ${fmtPrice(price)})`);
    });
    state.alerts = state.alerts.filter((a) => !hit.includes(a));
    store.set('alerts', state.alerts);
    renderAlerts(); renderPriceLines();
  }

  // ---------- precio y estado ----------
  function onPrice(p) {
    state.lastPrice = p;
    $('#price').textContent = fmtPrice(p);
    document.title = `${fmtPrice(p)} · Trading Pedro`;
    checkAlerts(p);
    levelsOnPrice(p);
    alertsOnPrice(p);
    updatePanel();
  }
  function setStatus(kind, text) {
    const el = $('#status');
    el.className = 'status ' + kind;
    el.querySelector('.txt').textContent = text;
  }

  // ---------- datos ----------
  // Última respuesta de cada temporalidad: al volver a una ya vista se muestra
  // al instante y se actualiza por detrás.
  const memo = {};
  const memoKey = () => `${state.interval}|${state.swing}`;

  function render(data, keepView) {
    state.candles = data.candles.map((c) => ({ ...c }));
    state.smc = data.smc;
    state.dataInterval = data.interval;
    setAllData();
    applyVisibility();
    renderPriceLines();
    if (!keepView) {
      const n = state.candles.length;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 160), to: n + 10 });
    }
    setLegend(state.candles[state.candles.length - 1]);
    onPrice(state.lastPrice ?? state.candles[state.candles.length - 1].close);
    alertsOnData();
  }

  let loadSeq = 0;
  async function load(keepView) {
    if (rp.on) return; // en repetición no se reemplazan las velas
    const seq = ++loadSeq;
    const key = memoKey();
    let shown = false;
    if (memo[key] && !keepView) { render(memo[key], false); shown = true; }
    else if (!keepView) $('#chart-main').classList.add('loading');
    try {
      let j;
      if (window.TP_DATA) {
        // versión de un solo archivo: los datos se piden a Binance desde el navegador
        j = await window.TP_DATA.getData(state.interval, state.swing);
        window.TP_DATA.warm(state.swing);
      } else {
        const r = await fetch(`/api/data?interval=${state.interval}&swing=${state.swing}&limit=3000`);
        j = await r.json();
        if (!r.ok) throw new Error(j.error || r.statusText);
      }
      memo[`${j.interval}|${state.swing}`] = j;
      if (seq !== loadSeq) return; // llegó una petición más nueva
      render(j, keepView || shown);
    } catch (e) {
      // una pausa de Binance ya se avisa una sola vez (ver TPBinance.onPause)
      if (seq === loadSeq && !(window.TPBinance && e instanceof window.TPBinance.BinancePaused)) {
        toast('No se pudieron cargar los datos: ' + e.message, true);
        setStatus('err', 'Error de datos');
      }
    } finally {
      if (seq === loadSeq) $('#chart-main').classList.remove('loading');
    }
  }

  let smcTimer;
  function refreshSmcSoon(ms = 1500) { clearTimeout(smcTimer); smcTimer = setTimeout(() => load(true), ms); }

  // Cada vela en vivo va al gráfico principal y, si coincide su temporalidad, al de contexto.
  function onKline(k) { onMainKline(k); onCtxKline(k); }
  function onMainKline(k) {
    if (rp.on) return;
    // ignora velas de otra temporalidad mientras se carga la nueva
    if (!state.candles.length || k.i !== state.dataInterval) return;
    const c = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
    const arr = state.candles, last = arr[arr.length - 1];
    if (c.time === last.time) arr[arr.length - 1] = c;
    else if (c.time > last.time) arr.push(c);
    else return;
    updateLast();
    onPrice(c.close);
    redraw();
    if (k.x) refreshSmcSoon(); // vela cerrada: recalcular Smart Money
  }
  function onTicker(d) {
    const p = parseFloat(d.P);
    const el = $('#chg');
    el.textContent = `${p >= 0 ? '+' : ''}${p.toFixed(2)}% 24h`;
    el.className = 'chg mono ' + (p >= 0 ? 'up' : 'down');
  }

  // Servidores oficiales de Binance; si uno está bloqueado se prueba el siguiente.
  const WS_HOSTS = ['wss://data-stream.binance.vision', 'wss://stream.binance.com:9443'];
  let ws, wsRetry, wsFails = 0, wsHost = 0, pollTimer;
  function connect() {
    clearTimeout(wsRetry);
    if (ws) { ws.onclose = null; ws.close(); }
    const extra = ctxState.on && ctxState.interval !== state.interval ? `/btcusdt@kline_${ctxState.interval}` : '';
    const streams = `btcusdt@kline_${state.interval}${extra}/btcusdt@ticker/btcusdt@depth20@100ms`;
    let opened = false;
    ws = new WebSocket(`${WS_HOSTS[wsHost]}/stream?streams=${streams}`);
    ws.onopen = () => { opened = true; wsFails = 0; clearInterval(pollTimer); pollTimer = null; setStatus('live', 'En vivo'); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.stream.endsWith('@ticker')) onTicker(m.data);
      else if (m.stream.includes('@depth')) onDepth(m.data);
      else onKline(m.data.k);
    };
    ws.onclose = () => {
      wsFails++;
      if (!opened) wsHost = (wsHost + 1) % WS_HOSTS.length;
      if (wsFails >= 3 && !pollTimer) {
        // sin WebSocket: se actualiza pidiendo los datos cada 15 s
        setStatus('warn', 'Actualizando cada 15 s');
        pollTimer = setInterval(() => load(true), 15000);
      } else if (!pollTimer) setStatus('warn', 'Reconectando…');
      wsRetry = setTimeout(connect, Math.min(30000, 3000 * wsFails));
    };
    ws.onerror = () => ws.close();
  }

  // ---------- libro de órdenes ----------
  // Libro completo de Binance (5000 niveles por lado, unos ±1 % del precio) cada 60 s,
  // combinado con los 20 mejores niveles que llegan en vivo por el WebSocket.
  const parseSide = (arr) => arr.map(([p, q]) => [+p, +q]).filter(([, q]) => q > 0);
  // El libro de 5000 niveles pesa 250 para Binance (el límite es 6000 por minuto y por
  // conexión, sumando todas las ventanas abiertas), así que se pide solo cada 60 s.
  async function pollDepth() {
    if (document.hidden) return;
    try {
      const d = await window.TPBinance.getJson('/api/v3/depth?symbol=BTCUSDT&limit=5000');
      state.book.snap = { bids: parseSide(d.bids), asks: parseSide(d.asks), at: Date.now() };
      renderBookSoon();
    } catch { /* en pausa o sin conexión: se reintenta en el próximo ciclo */ }
  }
  function onDepth(d) {
    state.book.live = { bids: parseSide(d.bids), asks: parseSide(d.asks), at: Date.now() };
    renderBookSoon();
  }
  // Libro combinado: los niveles en vivo sustituyen a los del libro completo en su tramo.
  function bookSides() {
    const { snap, live } = state.book;
    if (!snap && !live) return null;
    let bids = snap ? snap.bids : [], asks = snap ? snap.asks : [];
    if (live && live.bids.length && live.asks.length) {
      const minBid = live.bids[live.bids.length - 1][0], maxAsk = live.asks[live.asks.length - 1][0];
      bids = live.bids.concat(bids.filter(([p]) => p < minBid));
      asks = live.asks.concat(asks.filter(([p]) => p > maxAsk));
    }
    return bids.length && asks.length ? { bids, asks } : null;
  }
  // Agrupa niveles en tramos de `step` dólares: compras hacia abajo, ventas hacia arriba.
  function groupSide(levels, step, side) {
    const m = new Map();
    for (const [p, q] of levels) {
      const k = side === 'bid' ? Math.floor(p / step) * step : Math.ceil(p / step) * step;
      m.set(k, (m.get(k) || 0) + q);
    }
    return [...m.entries()].map(([p, q]) => ({ p, q }))
      .sort((a, b) => (side === 'bid' ? b.p - a.p : a.p - b.p));
  }
  const fmtBtc = (q) => q.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let bookTimer = null;
  function renderBookSoon() { if (!bookTimer) bookTimer = setTimeout(() => { bookTimer = null; renderBook(); }, 250); }
  function renderBook() {
    const s = bookSides();
    if (!s) return;
    const bid = s.bids[0][0], ask = s.asks[0][0], mid = (bid + ask) / 2;
    $('#bk-bid').textContent = fmtPrice(bid);
    $('#bk-ask').textContent = fmtPrice(ask);
    $('#bk-spread').textContent = fmtPrice(ask - bid);
    // desequilibrio a menos de 0,5 % del precio
    let qb = 0, qa = 0;
    for (const [p, q] of s.bids) { if (p < mid * 0.995) break; qb += q; }
    for (const [p, q] of s.asks) { if (p > mid * 1.005) break; qa += q; }
    const pb = qb + qa ? (qb / (qb + qa)) * 100 : 50;
    $('#bk-imb-bid').style.width = pb + '%';
    $('#bk-imb-ask').style.width = (100 - pb) + '%';
    $('#bk-imb-bid-t').textContent = `Compra ${Math.round(pb)} %`;
    $('#bk-imb-ask-t').textContent = `${Math.round(100 - pb)} % Venta`;
    $('#bk-imb-sub').textContent = `${fmtBtc(qb)} BTC frente a ${fmtBtc(qa)} BTC a ±0,5 % del precio`;

    const step = Number($('#book-step').value) || 50, N = 7;
    const asks = groupSide(s.asks, step, 'ask').slice(0, N).reverse();
    const bids = groupSide(s.bids, step, 'bid').slice(0, N);
    const shown = asks.concat(bids), maxQ = Math.max(...shown.map((l) => l.q), 1e-9);
    const avgQ = shown.reduce((a, l) => a + l.q, 0) / shown.length;
    const row = (l, side) => `<div class="lv ${side}${l.q >= avgQ * 2 ? ' wall' : ''}">
        <i style="width:${(l.q / maxQ) * 100}%"></i><span class="p">${fmtPrice(l.p)}</span><span>${fmtBtc(l.q)}</span></div>`;
    $('#bk-levels').innerHTML = asks.map((l) => row(l, 'ask')).join('')
      + `<div class="lv-mid">${fmtPrice(mid)}</div>`
      + bids.map((l) => row(l, 'bid')).join('');
    const age = state.book.snap ? Math.round((Date.now() - state.book.snap.at) / 1000) : null;
    $('#bk-note').textContent = 'Binance contado BTC/USDT · BTC por tramo de $' + step
      + (age != null && age > 60 ? ` · libro completo de hace ${age} s` : '');
  }

  // Muros: barras horizontales en el borde derecho del gráfico, a la altura de cada tramo
  // de precio, con largo proporcional a las órdenes esperando ahí.
  function drawWalls(paneW, paneH) {
    if (!state.show.walls || rp.on) return;
    const s = bookSides();
    if (!s) return;
    const pTop = candles.coordinateToPrice(0), pBot = candles.coordinateToPrice(paneH);
    if (pTop == null || pBot == null) return;
    const perPx = Math.abs(pTop - pBot) / paneH;
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((v) => v / perPx >= 4) || 1000;
    const lo = Math.min(pTop, pBot), hi = Math.max(pTop, pBot);
    const buckets = [
      ...groupSide(s.bids, step, 'bid').map((b) => ({ ...b, side: 'bid', from: b.p, to: b.p + step })),
      ...groupSide(s.asks, step, 'ask').map((a) => ({ ...a, side: 'ask', from: a.p - step, to: a.p })),
    ].filter((b) => b.to >= lo && b.from <= hi);
    if (!buckets.length) return;
    const qs = buckets.map((b) => b.q).sort((a, b) => a - b);
    const median = qs[Math.floor(qs.length / 2)], maxQ = qs[qs.length - 1];
    const top = new Set(buckets.slice().sort((a, b) => b.q - a.q).slice(0, 6));
    const maxLen = paneW * 0.22;
    ctx.save();
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const b of buckets) {
      const y1 = candles.priceToCoordinate(b.to), y2 = candles.priceToCoordinate(b.from);
      if (y1 == null || y2 == null) continue;
      const wall = top.has(b) && b.q >= median * 3;
      const w = Math.max(1, (b.q / maxQ) * maxLen), h = Math.max(1, Math.abs(y2 - y1) - 1);
      ctx.fillStyle = rgba(b.side === 'bid' ? C.bull : C.bear, wall ? 0.5 : 0.18);
      ctx.fillRect(paneW - w, Math.min(y1, y2), w, h);
      if (wall) {
        ctx.fillStyle = b.side === 'bid' ? C.bull : C.bear;
        ctx.fillText(`${fmtBtc(b.q)} BTC`, paneW - w - 4, (y1 + y2) / 2);
      }
    }
    ctx.restore();
  }

  $('#book-step').value = String(store.get('bookStep', 50));
  $('#book-step').addEventListener('change', () => { store.set('bookStep', Number($('#book-step').value)); renderBook(); });
  pollDepth();
  setInterval(pollDepth, 60000);
  // Si Binance pausa las consultas, se avisa una vez y se reanuda sola al terminar.
  window.TPBinance.onPause((until) => {
    const hora = new Date(until).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    toast(`Binance pidió pausar las consultas por exceso de uso. Trading Pedro se detiene y reanuda solo a las ${hora}. Si tienes varias ventanas abiertas, cierra las que no uses.`, true);
    setStatus('warn', `En pausa hasta las ${hora}`);
    setTimeout(() => { setStatus('live', 'En vivo'); pollDepth(); load(true); }, Math.max(0, until - Date.now()) + 500);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollDepth(); });

  // ---------- calculadora de riesgo ----------
  const calcFeePct = () => {
    const c = state.calc;
    return c.fee === 'custom' ? (Number(c.feeCustom) || 0) : Number(c.fee) || 0;
  };
  const calcResult = () => {
    const c = state.calc;
    return window.TPCalc.compute({
      side: c.side, entry: c.entry, stop: c.stop, target: c.target, risk: c.risk,
      feePct: calcFeePct(), tp1: c.partial ? c.tp1 : null, tp1Pct: c.tp1Pct,
    });
  };
  const fmtUsd = (v) => (v < 0 ? '−' : '') + fmtPrice(Math.abs(v)) + ' USD';
  const fmtSize = (q) => q.toLocaleString('es-VE', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  const fmtNum = (v, d = 2) => v.toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const saveCalc = () => store.set('calc', state.calc);
  const numOrNull = (v) => (v === '' || v == null || !isFinite(Number(v)) ? null : Number(v));

  function writeCalcInputs() {
    const c = state.calc, put = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v == null ? '' : v; };
    put('#calc-entry', c.entry); put('#calc-stop', c.stop); put('#calc-target', c.target);
    put('#calc-risk', c.risk); put('#calc-tp1', c.tp1); put('#calc-tp1-pct', c.tp1Pct);
    put('#calc-fee-custom', c.feeCustom);
    $('#calc-fee').value = c.fee;
    $('#calc-fee-custom').hidden = c.fee !== 'custom';
    $('#calc-partial').checked = !!c.partial;
    $('#calc-partial-box').hidden = !c.partial;
    $('#calc-show').checked = !!c.show;
    $('#calc-long').classList.toggle('on', c.side === 'long');
    $('#calc-short').classList.toggle('on', c.side === 'short');
  }
  function readCalcInputs() {
    const c = state.calc;
    c.entry = numOrNull($('#calc-entry').value);
    c.stop = numOrNull($('#calc-stop').value);
    c.target = numOrNull($('#calc-target').value);
    c.risk = numOrNull($('#calc-risk').value);
    c.tp1 = numOrNull($('#calc-tp1').value);
    c.tp1Pct = numOrNull($('#calc-tp1-pct').value) ?? 50;
    c.fee = $('#calc-fee').value;
    c.feeCustom = numOrNull($('#calc-fee-custom').value);
    c.partial = $('#calc-partial').checked;
    c.show = $('#calc-show').checked;
    if (c.entry != null && c.t0 == null && state.candles.length) c.t0 = state.candles[state.candles.length - 1].time;
  }
  function renderCalc() {
    writeCalcInputs();
    const out = $('#calc-out'), c = state.calc;
    if (c.entry == null && c.stop == null && c.target == null) {
      out.innerHTML = '<p class="muted">Pon la entrada y el stop, o pulsa «Actual» y «Sugerir».</p>';
      return;
    }
    const r = calcResult();
    if (r.error && r.size == null) { out.innerHTML = `<p class="err">${r.error}</p>`; return; }
    const fees = calcFeePct() > 0;
    const rows = [
      ['Tamaño', `${fmtSize(r.size)} BTC`],
      ['Valor de la posición', fmtUsd(r.notional)],
      [`Si toca el stop (−${fmtNum(r.stopPct)} %)`, fmtUsd(-r.loss)],
    ];
    if (r.profit != null) {
      if (r.partial) {
        rows.push([`Objetivo 1 (${fmtNum(c.tp1Pct, 0)} %)`, fmtUsd(r.partial.profit1)]);
        rows.push([`Objetivo final (${fmtNum(100 - c.tp1Pct, 0)} %)`, fmtUsd(r.partial.profit2)]);
      }
      rows.push([`Si llega al objetivo (+${fmtNum(r.targetPct)} %)`, '+' + fmtUsd(r.profit)]);
    }
    if (fees) rows.push(['Comisiones incluidas', fmtUsd(r.feesAtTarget ?? r.feesAtStop)]);
    let html = rows.map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('');
    if (r.error) html += `<p class="err">${r.error}</p>`;
    else if (r.rr != null) {
      const cls = r.rr >= 2 ? 'good' : r.rr >= 1 ? 'ok' : 'bad';
      const msg = r.rr >= 2 ? 'Buena relación' : r.rr >= 1 ? 'Ajustada' : 'Ganas menos de lo que arriesgas';
      html += `<div class="rr ${cls}"><span>Riesgo / beneficio<small>${msg}</small></span>
        <span style="text-align:right"><b>1 : ${fmtNum(r.rr)}</b><small>aciertos necesarios ${fmtNum(r.breakEvenWinRate, 1)} %</small></span></div>`;
    }
    out.innerHTML = html;
  }
  function onCalcInput() { readCalcInputs(); saveCalc(); renderCalc(); }

  // Sugerencias a partir de Smart Money (siempre editables).
  function suggestStop() {
    const c = state.calc, s = state.smc;
    if (c.entry == null) c.entry = state.lastPrice;
    if (!s || c.entry == null) return 'Faltan datos para sugerir.';
    const buf = c.entry * 0.0005; // un poco más allá del swing
    if (c.side === 'long') {
      const sw = s.swings.filter((w) => w.dir === -1 && w.level < c.entry).sort((a, b) => b.level - a.level)[0];
      if (!sw) return 'No hay un mínimo reciente por debajo de la entrada.';
      c.stop = Math.round((sw.level - buf) * 100) / 100;
      return `Stop sugerido bajo el último mínimo (${fmtPrice(sw.level)}).`;
    }
    const sw = s.swings.filter((w) => w.dir === 1 && w.level > c.entry).sort((a, b) => a.level - b.level)[0];
    if (!sw) return 'No hay un máximo reciente por encima de la entrada.';
    c.stop = Math.round((sw.level + buf) * 100) / 100;
    return `Stop sugerido sobre el último máximo (${fmtPrice(sw.level)}).`;
  }
  function suggestTarget() {
    const c = state.calc, s = state.smc;
    if (c.entry == null) c.entry = state.lastPrice;
    if (!s || c.entry == null) return 'Faltan datos para sugerir.';
    const zones = activeZones();
    if (c.side === 'long') {
      const z = zones.filter((q) => q.dir === -1 && q.bottom > c.entry).sort((a, b) => a.bottom - b.bottom)[0];
      if (z) { c.target = z.bottom; return `Objetivo sugerido en el ${z.type === "FVG" ? "FVG" : "order block"} bajista de ${fmtPrice(z.bottom)}.`; }
      const sw = s.swings.filter((w) => w.dir === 1 && w.level > c.entry).sort((a, b) => a.level - b.level)[0];
      if (sw) { c.target = sw.level; return `Objetivo sugerido en el último máximo (${fmtPrice(sw.level)}).`; }
      return 'No hay zonas por encima de la entrada.';
    }
    const z = zones.filter((q) => q.dir === 1 && q.top < c.entry).sort((a, b) => b.top - a.top)[0];
    if (z) { c.target = z.top; return `Objetivo sugerido en el ${z.type === "FVG" ? "FVG" : "order block"} alcista de ${fmtPrice(z.top)}.`; }
    const sw = s.swings.filter((w) => w.dir === -1 && w.level < c.entry).sort((a, b) => b.level - a.level)[0];
    if (sw) { c.target = sw.level; return `Objetivo sugerido en el último mínimo (${fmtPrice(sw.level)}).`; }
    return 'No hay zonas por debajo de la entrada.';
  }
  function afterSuggest(msg) {
    const c = state.calc;
    if (c.t0 == null && state.candles.length) c.t0 = state.candles[state.candles.length - 1].time;
    $('#calc-hint').textContent = msg;
    saveCalc(); renderCalc();
  }

  // Dibujo: franja roja entre entrada y stop, verde entre entrada y objetivo.
  function calcLines() {
    const c = state.calc;
    if (!c.show || c.entry == null || c.stop == null) return [];
    const L = [{ key: 'entry', p: c.entry }, { key: 'stop', p: c.stop }];
    if (c.target != null) L.push({ key: 'target', p: c.target });
    if (c.partial && c.tp1 != null) L.push({ key: 'tp1', p: c.tp1 });
    return L;
  }
  function calcLeft(paneW) {
    const c = state.calc;
    const x = c.t0 != null ? XL(c.t0) : null;
    return x == null || x > paneW - 60 ? paneW * 0.6 : Math.max(0, x);
  }
  function drawCalc(paneW) {
    const c = state.calc, lines = calcLines();
    if (!lines.length) return;
    const r = calcResult();
    if (r.size == null) return;
    const Yp = (p) => candles.priceToCoordinate(p);
    const x1 = calcLeft(paneW), yE = Yp(c.entry), yS = Yp(c.stop);
    if (yE == null || yS == null) return;
    ctx.save();
    ctx.fillStyle = rgba(C.bear, 0.16);
    ctx.fillRect(x1, Math.min(yE, yS), paneW - x1, Math.abs(yS - yE));
    const yT = c.target != null ? Yp(c.target) : null;
    if (yT != null && !r.error) {
      ctx.fillStyle = rgba(C.bull, 0.16);
      ctx.fillRect(x1, Math.min(yE, yT), paneW - x1, Math.abs(yT - yE));
    }
    const line = (y, col, dash) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(paneW, y); ctx.stroke(); ctx.setLineDash([]);
    };
    line(yE, '#D5DCEA'); line(yS, C.bear);
    if (yT != null && !r.error) line(yT, C.bull);
    const y1 = c.partial && c.tp1 != null ? Yp(c.tp1) : null;
    if (y1 != null && !r.error) line(y1, C.bull, [5, 4]);
    const bg = 'rgba(22,30,45,0.92)';
    tag([`Entrada ${fmtPrice(c.entry)} · ${fmtSize(r.size)} BTC`], x1 + 6, yE, bg, '#D5DCEA', 'left', 'middle');
    tag([`Stop ${fmtPrice(c.stop)} · ${fmtUsd(-r.loss)}`], x1 + 6, yS, rgba(C.bear, 0.9), '#FFFFFF', 'left', 'middle');
    if (yT != null && !r.error && r.profit != null) {
      tag([`Objetivo ${fmtPrice(c.target)} · +${fmtUsd(r.profit)} · ${fmtNum(r.rr)}R`], x1 + 6, yT, rgba(C.bull, 0.9), '#0B0F16', 'left', 'middle');
    }
    if (y1 != null && !r.error && r.partial) {
      tag([`Objetivo 1 ${fmtPrice(c.tp1)} · ${fmtNum(c.tp1Pct, 0)} %`], x1 + 6, y1, bg, C.bull, 'left', 'middle');
    }
    ctx.restore();
  }
  // Línea de la calculadora bajo el ratón (para arrastrarla).
  function calcHit(x, y) {
    const lines = calcLines();
    if (!lines.length || x < calcLeft(paneSize().w)) return null;
    for (const l of lines) {
      const ly = candles.priceToCoordinate(l.p);
      if (ly != null && Math.abs(ly - y) <= 5) return l.key;
    }
    return null;
  }

  $('#calc-form').addEventListener('input', onCalcInput);
  $('#calc-partial-box').addEventListener('input', onCalcInput);
  $('#calc-fee').addEventListener('change', onCalcInput);
  $('#calc-partial').addEventListener('change', onCalcInput);
  $('#calc-show').addEventListener('change', onCalcInput);
  $('#calc-form').addEventListener('submit', (e) => e.preventDefault());
  $('#calc-long').addEventListener('click', () => { state.calc.side = 'long'; saveCalc(); renderCalc(); });
  $('#calc-short').addEventListener('click', () => { state.calc.side = 'short'; saveCalc(); renderCalc(); });
  $('#calc-now').addEventListener('click', () => {
    if (state.lastPrice == null) return;
    state.calc.entry = Math.round(state.lastPrice * 100) / 100;
    state.calc.t0 = state.candles.length ? state.candles[state.candles.length - 1].time : null;
    $('#calc-hint').textContent = '';
    saveCalc(); renderCalc();
  });
  $('#calc-sug-stop').addEventListener('click', () => afterSuggest(suggestStop()));
  $('#calc-sug-target').addEventListener('click', () => afterSuggest(suggestTarget()));
  $('#calc-clear').addEventListener('click', () => {
    Object.assign(state.calc, { entry: null, stop: null, target: null, tp1: null, t0: null });
    $('#calc-hint').textContent = '';
    saveCalc(); renderCalc();
  });
  renderCalc();

  // ---------- máximos y mínimos del día y la semana anteriores ----------
  // Días y semanas en UTC, como en Binance (la semana empieza el lunes a las 00:00 UTC).
  const DAY = 86400;
  const weekStart = (t) => { const d = Math.floor(t / DAY); return (d - ((new Date(d * DAY * 1000).getUTCDay() + 6) % 7)) * DAY; };
  const lv = { data: null, at: 0 };
  async function loadLevels() {
    if (document.hidden && lv.data) return;
    try {
      const raw = await window.TPBinance.getJson('/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=16');
      const days = raw.map((k) => ({ t: Math.floor(k[0] / 1000), h: +k[2], l: +k[3] }));
      if (days.length < 2) return;
      const today = days[days.length - 1], prev = days[days.length - 2];
      const wk = weekStart(today.t);
      const thisWeek = days.filter((d) => weekStart(d.t) === wk);
      const lastWeek = days.filter((d) => weekStart(d.t) === wk - 7 * DAY);
      lv.data = {
        pdh: prev.h, pdl: prev.l, dayStart: today.t,
        pwh: lastWeek.length ? Math.max(...lastWeek.map((d) => d.h)) : null,
        pwl: lastWeek.length ? Math.min(...lastWeek.map((d) => d.l)) : null,
        dayHigh: today.h, dayLow: today.l,
        weekHigh: Math.max(...thisWeek.map((d) => d.h)), weekLow: Math.min(...thisWeek.map((d) => d.l)),
      };
      lv.at = Date.now();
    } catch { /* en pausa o sin conexión: se reintenta luego */ }
  }
  // El precio en vivo actualiza el máximo y mínimo de hoy (para saber si se barrió un nivel).
  function levelsOnPrice(p) {
    if (rp.on) return;
    const d = lv.data;
    if (!d) return;
    if (Date.now() / 1000 >= d.dayStart + DAY) { loadLevels(); return; } // empezó otro día
    d.dayHigh = Math.max(d.dayHigh, p); d.dayLow = Math.min(d.dayLow, p);
    d.weekHigh = Math.max(d.weekHigh, p); d.weekLow = Math.min(d.weekLow, p);
  }
  function levelList() {
    const d = lv.data;
    if (!d) return [];
    const L = [
      { k: 'PDH', p: d.pdh, swept: d.dayHigh > d.pdh, col: C.accent, dash: [5, 4] },
      { k: 'PDL', p: d.pdl, swept: d.dayLow < d.pdl, col: C.accent, dash: [5, 4] },
    ];
    if (d.pwh != null) L.push({ k: 'PWH', p: d.pwh, swept: d.weekHigh > d.pwh, col: C.blue, dash: [10, 5] });
    if (d.pwl != null) L.push({ k: 'PWL', p: d.pwl, swept: d.weekLow < d.pwl, col: C.blue, dash: [10, 5] });
    return L;
  }
  // Dibuja los niveles en cualquier gráfico (g = lienzo, series = velas de ese gráfico).
  function drawLevels(g, series, paneW) {
    if (!state.show.levels || rp.on) return;
    g.save();
    g.font = '600 10px Inter, system-ui, sans-serif';
    g.textBaseline = 'bottom';
    for (const l of levelList()) {
      const y = series.priceToCoordinate(l.p);
      if (y == null) continue;
      g.strokeStyle = rgba(l.col, l.swept ? 0.45 : 0.9); g.lineWidth = 1; g.setLineDash(l.dash);
      g.beginPath(); g.moveTo(0, y); g.lineTo(paneW, y); g.stroke(); g.setLineDash([]);
      const txt = `${l.k} ${fmtPrice(l.p)}${l.swept ? ' · barrido' : ''}`;
      const w = g.measureText(txt).width;
      g.fillStyle = rgba(l.col, l.swept ? 0.6 : 1);
      g.fillText(txt, paneW - w - 8, y - 2);
    }
    g.restore();
  }
  function levelRows() {
    if (!state.show.levels || !lv.data) return '';
    const d = lv.data, row = (name, hi, lo, sh, sl) =>
      `<dt>${name}</dt><dd class="mono">${fmtPrice(hi)}${sh ? ' <span class="tag down">barrido</span>' : ''}<span class="zone">mín ${fmtPrice(lo)}${sl ? ' · barrido' : ''}</span></dd>`;
    let html = row('Día anterior', d.pdh, d.pdl, d.dayHigh > d.pdh, d.dayLow < d.pdl);
    if (d.pwh != null) html += row('Semana anterior', d.pwh, d.pwl, d.weekHigh > d.pwh, d.weekLow < d.pwl);
    return html;
  }
  loadLevels();
  setInterval(loadLevels, 10 * 60 * 1000);

  // ---------- sesiones (horario UTC, como el paquete smartmoneyconcepts) ----------
  const SESSIONS = [
    { name: 'Asia', from: 0, to: 9, col: '#5AA9FF' },
    { name: 'Londres', from: 7, to: 16, col: '#F5B841' },
    { name: 'Nueva York', from: 13, to: 22, col: '#2ECC8F' },
  ];
  function drawSessions(paneW, paneH) {
    if (!state.show.sessions || !['1m', '5m', '15m', '1h'].includes(state.dataInterval || state.interval)) return;
    const r = chart.timeScale().getVisibleLogicalRange();
    if (!r || !state.candles.length) return;
    const t1 = logicalToTime(Math.floor(r.from)), t2 = logicalToTime(Math.ceil(r.to));
    if (t1 == null || t2 == null) return;
    ctx.save();
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    for (let day = Math.floor(t1 / DAY) * DAY; day <= t2; day += DAY) {
      SESSIONS.forEach((s, i) => {
        const x1 = XL(day + s.from * 3600), x2 = XL(day + s.to * 3600);
        if (x1 == null || x2 == null || x2 < 0 || x1 > paneW) return;
        ctx.fillStyle = rgba(s.col, 0.045);
        ctx.fillRect(x1, 0, x2 - x1, paneH);
        ctx.fillStyle = rgba(s.col, 0.7);
        ctx.fillRect(x1, paneH - 4 - i * 4, x2 - x1, 3); // franja de color al pie, una por sesión
        if (x2 - x1 > 56) ctx.fillText(s.name, Math.max(x1, 0) + 4, 26 + i * 12);
      });
    }
    ctx.restore();
  }

  // ---------- segundo gráfico: temporalidad mayor para la estructura ----------
  const ctxState = { on: store.get('ctxOn', false), interval: store.get('ctxInterval', '4h'), candles: [], smc: null, dataInterval: null };
  const ctxWrap = $('#ctx'), ctxEl = $('#chart-ctx'), ctxCanvas = $('#ctx-overlay');
  const cg = ctxCanvas.getContext('2d');
  let ctxChart = null, ctxCandles = null, ctxE20 = null, ctxE50 = null;

  function ensureCtxChart() {
    if (ctxChart) return;
    ctxChart = LWC.createChart(ctxEl, chartOptions(true));
    ctxCandles = ctxChart.addCandlestickSeries({
      upColor: C.bull, downColor: C.bear, borderUpColor: C.bull, borderDownColor: C.bear,
      wickUpColor: C.bull, wickDownColor: C.bear,
    });
    ctxCandles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });
    ctxE20 = ctxChart.addLineSeries(line(C.ema20));
    ctxE50 = ctxChart.addLineSeries(line(C.ema50));
    ctxChart.timeScale().subscribeVisibleLogicalRangeChange(drawCtx);
    new ResizeObserver(drawCtx).observe(ctxEl);
  }
  async function fetchData(interval) {
    if (window.TP_DATA) return window.TP_DATA.getData(interval, state.swing);
    const r = await fetch(`/api/data?interval=${interval}&swing=${state.swing}&limit=3000`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }
  function ctxEmas() {
    const cs = ctxState.candles, close = cs.map((c) => c.close);
    const ser = (vals) => vals.map((v, i) => (v == null ? { time: cs[i].time } : { time: cs[i].time, value: v }));
    return { e20: ser(ema(close, 20)), e50: ser(ema(close, 50)) };
  }
  let ctxSeq = 0;
  async function loadCtx(keepView) {
    if (!ctxState.on) return;
    ensureCtxChart();
    const seq = ++ctxSeq;
    try {
      const j = await fetchData(ctxState.interval);
      if (seq !== ctxSeq) return;
      ctxState.candles = j.candles.map((c) => ({ ...c }));
      ctxState.smc = j.smc; ctxState.dataInterval = j.interval;
      ctxCandles.setData(ctxState.candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      const e = ctxEmas(); ctxE20.setData(e.e20); ctxE50.setData(e.e50);
      ctxCandles.setMarkers(state.show.swings ? ctxState.smc.swings.slice(-30).map((s) => ({
        time: s.time, position: s.dir === 1 ? 'aboveBar' : 'belowBar', shape: 'circle', size: 0.3,
        color: s.dir === 1 ? 'rgba(240,80,110,0.8)' : 'rgba(46,204,143,0.8)',
      })) : []);
      if (!keepView) {
        const n = ctxState.candles.length;
        ctxChart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 120), to: n + 6 });
      }
      updateCtxTrend();
      drawCtx();
    } catch { /* en pausa o sin conexión: se reintenta con la próxima vela */ }
  }
  function updateCtxTrend() {
    const el = $('#ctx-trend'), s = ctxState.smc;
    const ev = s ? s.structure.filter((e) => e.broken != null).sort((a, b) => a.broken - b.broken).pop() : null;
    const name = ctxState.interval === '1d' ? '1D' : ctxState.interval;
    if (!ev) { el.textContent = `${name} · sin estructura clara`; el.className = 'ctx-trend'; return; }
    el.textContent = `${name} · ${ev.dir === 1 ? 'Alcista ▲' : 'Bajista ▼'} (último ${ev.kind})`;
    el.className = 'ctx-trend ' + (ev.dir === 1 ? 'up' : 'down');
  }
  function onCtxKline(k) {
    if (!ctxState.on || !ctxState.candles.length || k.i !== ctxState.dataInterval) return;
    const c = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
    const arr = ctxState.candles, last = arr[arr.length - 1];
    if (c.time === last.time) arr[arr.length - 1] = c;
    else if (c.time > last.time) arr.push(c);
    else return;
    ctxCandles.update({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
    const e = ctxEmas(); ctxE20.update(e.e20[e.e20.length - 1]); ctxE50.update(e.e50[e.e50.length - 1]);
    if (k.x) setTimeout(() => loadCtx(true), 1500); // vela cerrada: recalcular su Smart Money
  }

  // Capa del gráfico de contexto: zonas vigentes, últimas rupturas, niveles y la franja
  // con el tramo de tiempo que muestra el gráfico principal.
  function drawCtx() {
    if (!ctxChart || !ctxState.on) return;
    const w = ctxEl.clientWidth, h = ctxEl.clientHeight, dpr = window.devicePixelRatio || 1;
    if (ctxCanvas.width !== Math.round(w * dpr) || ctxCanvas.height !== Math.round(h * dpr)) {
      ctxCanvas.width = Math.round(w * dpr); ctxCanvas.height = Math.round(h * dpr);
      ctxCanvas.style.width = w + 'px'; ctxCanvas.style.height = h + 'px';
    }
    cg.setTransform(dpr, 0, 0, dpr, 0, 0);
    cg.clearRect(0, 0, w, h);
    if (!ctxState.candles.length) return;
    const ts = ctxChart.timeScale();
    const paneW = w - ctxChart.priceScale('right').width(), paneH = h - ts.height();
    // Tiempo a coordenada; un instante entre dos velas se interpola (el gráfico principal
    // usa velas más pequeñas que caen dentro de las de este).
    const cs = ctxState.candles;
    const X = (t) => {
      if (t == null) return null;
      let lo = 0, hi = cs.length - 1;
      if (t >= cs[hi].time) return ts.logicalToCoordinate(hi + (t - cs[hi].time) / (cs[hi].time - cs[hi - 1].time));
      if (t <= cs[0].time) return ts.logicalToCoordinate(0);
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cs[m].time <= t) lo = m; else hi = m; }
      return ts.logicalToCoordinate(lo + (t - cs[lo].time) / (cs[hi].time - cs[lo].time));
    };
    const Y = (p) => ctxCandles.priceToCoordinate(p);
    cg.save();
    cg.beginPath(); cg.rect(0, 0, paneW, paneH); cg.clip();

    // franja con lo que se ve a la derecha
    const mr = chart.timeScale().getVisibleLogicalRange();
    if (mr && state.candles.length) {
      const a = X(logicalToTime(Math.max(0, mr.from))), b = X(logicalToTime(Math.min(state.candles.length - 1, mr.to)));
      if (a != null && b != null) {
        cg.fillStyle = 'rgba(213,220,234,0.06)';
        cg.fillRect(Math.min(a, b), 0, Math.max(2, Math.abs(b - a)), paneH);
        cg.strokeStyle = 'rgba(213,220,234,0.25)'; cg.lineWidth = 1;
        cg.strokeRect(Math.min(a, b) + 0.5, 0.5, Math.max(2, Math.abs(b - a)) - 1, paneH - 1);
      }
    }

    const s = ctxState.smc;
    if (s) {
      cg.font = '600 10px Inter, system-ui, sans-serif';
      const zone = (z, label, alpha) => {
        const x1 = X(z.time), y1 = Y(z.top), y2 = Y(z.bottom);
        if (x1 == null || y1 == null || y2 == null) return;
        const col = z.dir === 1 ? C.bull : C.bear;
        cg.fillStyle = rgba(col, alpha);
        cg.fillRect(x1, y1, paneW - x1, Math.max(1, y2 - y1));
        if (label && y2 - y1 > 11) { cg.fillStyle = col; cg.fillText(label, Math.max(x1, 0) + 4, y1 + 11); }
      };
      if (state.show.fvg) s.fvg.filter((z) => z.mitigated == null).forEach((z) => zone(z, 'FVG', 0.14));
      if (state.show.ob) s.ob.filter((z) => z.mitigated == null).forEach((z) => zone(z, `OB ${Math.round(z.strength || 0)}%`, 0.22));
      if (state.show.structure) {
        s.structure.filter((e) => e.broken != null).sort((a, b) => a.broken - b.broken).slice(-4).forEach((e) => {
          const x1 = X(e.time), x2 = X(e.broken), y = Y(e.level);
          if (x1 == null || x2 == null || y == null) return;
          const col = e.dir === 1 ? C.bull : C.bear;
          cg.strokeStyle = col; cg.lineWidth = 1; cg.setLineDash(e.kind === 'CHOCH' ? [6, 3] : []);
          cg.beginPath(); cg.moveTo(x1, y); cg.lineTo(x2, y); cg.stroke(); cg.setLineDash([]);
          cg.fillStyle = col; cg.fillText(e.kind, (x1 + x2) / 2 - 12, e.dir === 1 ? y - 4 : y + 12);
        });
      }
    }
    drawLevels(cg, ctxCandles, paneW);
    cg.restore();
  }

  function setCtx(on) {
    ctxState.on = on; store.set('ctxOn', on);
    ctxWrap.hidden = !on;
    $('#ctx-toggle').classList.toggle('on', on);
    $$('#ctx-tfs button').forEach((b) => b.classList.toggle('on', b.dataset.tf === ctxState.interval));
    if (on) loadCtx(false);
    connect(); // añade o quita su flujo de velas en vivo
  }
  $('#ctx-toggle').addEventListener('click', () => setCtx(!ctxState.on));
  $$('#ctx-tfs button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tf === ctxState.interval) return;
    ctxState.interval = b.dataset.tf; store.set('ctxInterval', ctxState.interval);
    $$('#ctx-tfs button').forEach((x) => x.classList.toggle('on', x === b));
    loadCtx(false); connect();
  }));
  let ctxSwingTimer;
  if (ctxState.on) { // se abre como se dejó; su flujo en vivo lo añade connect() al iniciar
    ctxWrap.hidden = false;
    $('#ctx-toggle').classList.add('on');
    $$('#ctx-tfs button').forEach((b) => b.classList.toggle('on', b.dataset.tf === ctxState.interval));
    loadCtx(false);
  }
  // se redibuja junto con el gráfico principal (la franja sigue su desplazamiento)
  (function ctxLoop() { try { drawCtx(); } catch (e) { console.error(e); } requestAnimationFrame(ctxLoop); })();

  // ---------- repetición de mercado ----------
  // Se vuelve a una vela del pasado y se revelan las siguientes una a una. Smart Money se
  // recalcula solo con las velas reveladas, como se veía en ese momento. Mientras dura,
  // se pausan los datos en vivo, las alertas reales, el libro de órdenes y los niveles.
  const rp = { on: false, picking: false, full: null, liveSmc: null, idx: 0, timer: null, trades: [], open: null, ctxWasOn: false };
  const rpBar = $('#replay-bar');
  const ivNow = () => IV_SEC[state.dataInterval || state.interval] || 60;
  // computeSmc deja fuera la última vela (la que está en curso); aquí todas las reveladas
  // están cerradas, así que se añade una vela ficticia al final.
  const smcFor = (cs) => {
    const last = cs[cs.length - 1];
    return window.SMC.computeSmc(cs.concat([{ ...last, time: last.time + ivNow() }]), state.swing);
  };
  const signedR = (v) => (v >= 0 ? '+' : '−') + fmtNum(Math.abs(v)) + 'R';

  function rpShow(idx) {
    rp.idx = idx;
    state.candles = rp.full.slice(0, idx + 1).map((c) => ({ ...c }));
    state.smc = smcFor(state.candles);
    setAllData(); applyVisibility(); renderPriceLines();
    const c = state.candles[idx];
    setLegend(c); onPrice(c.close);
    $('#rp-time').textContent = fmtTime(c.time);
  }
  function rpEnter() {
    if (!state.candles.length || !window.SMC) return;
    rp.on = true; rp.trades = []; rp.open = null;
    rp.full = state.candles.map((c) => ({ ...c })); rp.liveSmc = state.smc;
    rp.ctxWasOn = ctxState.on; ctxWrap.hidden = true;
    $('#book-card').hidden = true;
    $('#practice-card').hidden = false;
    rpBar.hidden = false;
    $('#replay-toggle').classList.add('on');
    rpPickMode();
  }
  function rpPickMode() {
    rpPause();
    rp.picking = true; rp.open = null;
    state.candles = rp.full.map((c) => ({ ...c })); state.smc = rp.liveSmc;
    setAllData(); applyVisibility();
    $('#rp-time').textContent = 'Elige la vela de inicio';
    const hint = $('#hint');
    hint.textContent = 'Haz clic en la vela donde quieres empezar la práctica (Esc para salir)';
    hint.classList.add('show');
    mainEl.classList.add('drawing');
    renderPractice();
  }
  function rpPick(x) {
    const l = chart.timeScale().coordinateToLogical(x);
    if (l == null) return;
    // al menos 100 velas de historia para que los indicadores y Smart Money tengan contexto
    const idx = Math.max(100, Math.min(rp.full.length - 2, Math.round(l)));
    rp.picking = false;
    $('#hint').classList.remove('show');
    mainEl.classList.remove('drawing');
    rpShow(idx);
    renderPractice();
  }
  function rpStep() {
    if (!rp.on || rp.picking) return;
    if (rp.idx >= rp.full.length - 1) { rpPause(); toast('Llegaste a la última vela cargada.'); return; }
    rp.idx++;
    const k = { ...rp.full[rp.idx] };
    state.candles.push(k);
    updateLast();
    state.smc = smcFor(state.candles);
    updateMarkers();
    setLegend(k); onPrice(k.close);
    $('#rp-time').textContent = fmtTime(k.time);
    if (rp.open) {
      const res = window.TPCalc.settle(rp.open, k, calcFeePct());
      if (res) {
        rp.trades.push({ ...rp.open, ...res, closedAt: k.time });
        toast(`Práctica: ${res.result === 'target' ? 'llegó al objetivo' : 'tocó el stop'} · ${signedR(res.r)} · ${fmtUsd(res.pnl)}`);
        rp.open = null;
        updateMarkers();
      }
    }
    renderPractice();
  }
  function rpPause() { clearInterval(rp.timer); rp.timer = null; $('#rp-play').textContent = '▶'; }
  function rpPlay() {
    if (rp.picking) return;
    if (rp.timer) { rpPause(); return; }
    const speed = Number($('#rp-speed').value) || 1;
    rp.timer = setInterval(rpStep, 1000 / speed);
    $('#rp-play').textContent = '⏸';
  }
  function rpOpenTrade(side) {
    if (!rp.on || rp.picking) return;
    if (rp.open) { toast('Ya tienes una operación de práctica abierta.'); return; }
    const k = state.candles[state.candles.length - 1], c = state.calc;
    c.side = side; c.entry = Math.round(k.close * 100) / 100; c.t0 = k.time;
    const r = calcResult();
    if (r.error || r.size == null || c.target == null || r.profit == null) {
      saveCalc(); renderCalc();
      toast('Para practicar pon en la calculadora un stop y un objetivo válidos para esta dirección (puedes usar «Sugerir»).', true);
      return;
    }
    rp.open = { side, entry: c.entry, stop: c.stop, target: c.target, size: r.size, risk: c.risk, openedAt: k.time };
    saveCalc(); renderCalc(); renderPractice(); updateMarkers();
  }
  function renderPractice() {
    const t = rp.trades, n = t.length;
    const wins = t.filter((x) => x.pnl > 0).length;
    const totR = t.reduce((a, x) => a + x.r, 0), totUsd = t.reduce((a, x) => a + x.pnl, 0);
    $('#practice-sum').innerHTML = `
      <div><span>Operaciones</span><b>${n}</b></div>
      <div><span>Aciertos</span><b>${n ? fmtNum((wins / n) * 100, 0) + ' %' : '—'}</b></div>
      <div><span>Resultado</span><b class="${totUsd >= 0 ? 'up' : 'down'}">${n ? signedR(totR) : '—'}</b></div>
      <div><span>En dólares</span><b class="${totUsd >= 0 ? 'up' : 'down'}">${n ? fmtUsd(totUsd) : '—'}</b></div>`;
    const side = (x) => (x.side === 'short' ? 'Corto' : 'Largo');
    const rows = t.slice(-8).reverse().map((x, i) => `<li><span>#${n - i} ${side(x)} · ${x.result === 'target' ? 'objetivo' : 'stop'}</span>
      <b class="${x.pnl >= 0 ? 'up' : 'down'}">${signedR(x.r)}</b></li>`);
    if (rp.open) rows.unshift(`<li><span>Abierta: ${side(rp.open)} desde ${fmtPrice(rp.open.entry)}</span><b class="muted">en curso</b></li>`);
    $('#practice-list').innerHTML = rows.join('');
  }
  // Flechas de entrada y salida de las operaciones de práctica (se añaden a los swings).
  function practiceMarkers() {
    if (!rp.on) return [];
    const m = [];
    const entry = (x) => m.push({
      time: x.openedAt, position: x.side === 'long' ? 'belowBar' : 'aboveBar', shape: x.side === 'long' ? 'arrowUp' : 'arrowDown',
      color: x.side === 'long' ? C.bull : C.bear, text: x.side === 'long' ? 'Compra' : 'Venta',
    });
    rp.trades.forEach((x) => {
      entry(x);
      m.push({ time: x.closedAt, position: 'aboveBar', shape: 'circle', color: x.pnl >= 0 ? C.bull : C.bear, text: signedR(x.r) });
    });
    if (rp.open) entry(rp.open);
    return m;
  }
  function rpExit() {
    if (!rp.on) return;
    rpPause();
    rp.on = false; rp.picking = false; rp.open = null;
    rpBar.hidden = true;
    $('#practice-card').hidden = true;
    $('#book-card').hidden = false;
    $('#replay-toggle').classList.remove('on');
    $('#hint').classList.remove('show');
    mainEl.classList.remove('drawing');
    if (rp.ctxWasOn) { ctxWrap.hidden = false; loadCtx(true); }
    state.lastPrice = null;
    load(false);
  }
  $('#replay-toggle').addEventListener('click', () => (rp.on ? rpExit() : rpEnter()));
  $('#rp-pick').addEventListener('click', rpPickMode);
  $('#rp-play').addEventListener('click', rpPlay);
  $('#rp-step').addEventListener('click', () => { rpPause(); rpStep(); });
  $('#rp-speed').addEventListener('change', () => { if (rp.timer) { rpPause(); rpPlay(); } });
  $('#rp-long').addEventListener('click', () => rpOpenTrade('long'));
  $('#rp-short').addEventListener('click', () => rpOpenTrade('short'));
  $('#rp-exit').addEventListener('click', rpExit);
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!rp.on || (t && t.closest && t.closest('input, select, textarea'))) return;
    if (rp.picking && e.key === 'Escape') { rpExit(); return; }
    if (rp.picking) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); rpPause(); rpStep(); }
    else if (e.key === ' ') { e.preventDefault(); rpPlay(); }
  });

  // ---------- avisos: PC (pitido y notificación) y Telegram ----------
  // El token del bot lo pega el usuario y se guarda solo en este navegador.
  const tg = Object.assign({ token: null, chatId: null, name: null, enabled: true }, store.get('tg', {}));
  const saveTg = () => store.set('tg', tg);
  async function tgApi(method, params = {}) {
    // GET sin cabeceras propias: Telegram lo admite desde el navegador sin consulta previa
    const q = new URLSearchParams(params).toString();
    const r = await fetch(`https://api.telegram.org/bot${encodeURIComponent(tg.token).replace(/%3A/gi, ':')}/${method}${q ? '?' + q : ''}`);
    let j = null;
    try { j = await r.json(); } catch { /* sin cuerpo */ }
    if (!j || !j.ok) throw new Error((j && j.description) || `Telegram respondió ${r.status}`);
    return j.result;
  }
  const tgQueue = [];
  let tgBusy = false;
  async function tgPump() {
    if (tgBusy) return;
    tgBusy = true;
    while (tgQueue.length) {
      const text = tgQueue.shift();
      try { await tgApi('sendMessage', { chat_id: tg.chatId, text }); }
      catch (e) { $('#tg-msg').textContent = 'No se pudo enviar a Telegram: ' + e.message; }
      await new Promise((r) => setTimeout(r, 1200)); // sin saturar a Telegram
    }
    tgBusy = false;
  }
  function tgSend(text) {
    if (!tg.token || !tg.chatId || !tg.enabled) return;
    if (tgQueue.length < 20) tgQueue.push(text);
    tgPump();
  }
  function notify(msg) {
    toast('🔔 ' + msg); beep();
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Trading Pedro', { body: msg, icon: 'logo.svg' }); } catch { /* sin notificaciones */ }
    tgSend(`🔔 Trading Pedro · BTC ${fmtPrice(state.lastPrice)}\n${msg}`);
  }
  function renderTg() {
    const on = !!(tg.token && tg.chatId);
    $('#tg-off').hidden = on; $('#tg-on').hidden = !on;
    $('#tg-name').textContent = tg.name ? '@' + tg.name : 'tu bot';
    $('#tg-enabled').checked = !!tg.enabled;
  }
  $('#tg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = $('#tg-token').value.trim();
    const msg = $('#tg-msg');
    if (!/^\d+:[\w-]{20,}$/.test(token)) { msg.textContent = 'Ese no parece un token de bot. Cópialo completo del mensaje de @BotFather (números, dos puntos y letras).'; return; }
    tg.token = token;
    msg.textContent = 'Conectando…';
    try {
      const me = await tgApi('getMe');
      tg.name = me.username;
      const updates = await tgApi('getUpdates');
      const chat = updates.map((u) => (u.message || u.edited_message || {}).chat).filter(Boolean).filter((c) => c.type === 'private').pop();
      if (!chat) {
        saveTg();
        msg.textContent = `Token correcto (@${me.username}). Ahora abre el chat con tu bot en Telegram, envíale «hola» y vuelve a pulsar Conectar.`;
        return;
      }
      tg.chatId = chat.id; tg.enabled = true; saveTg();
      $('#tg-token').value = '';
      await tgApi('sendMessage', { chat_id: tg.chatId, text: '✅ Trading Pedro está conectado. Aquí te llegarán tus alertas mientras la app esté abierta.' });
      msg.textContent = 'Listo: te envié un mensaje de bienvenida a Telegram.';
      renderTg();
    } catch (err) {
      tg.token = null; tg.chatId = null; saveTg(); // un token rechazado no se guarda
      msg.textContent = 'No se pudo conectar: ' + err.message + '. Revisa el token.';
    }
  });
  $('#tg-enabled').addEventListener('change', () => { tg.enabled = $('#tg-enabled').checked; saveTg(); });
  $('#tg-test').addEventListener('click', () => {
    if (!tg.chatId) return;
    tgQueue.push(`🧪 Mensaje de prueba de Trading Pedro · BTC ${fmtPrice(state.lastPrice)}`); tgPump();
    $('#tg-msg').textContent = 'Mensaje de prueba enviado.';
  });
  $('#tg-forget').addEventListener('click', () => {
    Object.assign(tg, { token: null, chatId: null, name: null }); saveTg();
    $('#tg-msg').textContent = 'Desconectado. El token se borró de este navegador.';
    renderTg();
  });
  renderTg();

  // ---------- alertas inteligentes ----------
  // Solo avisan de lo que ocurre con la app abierta: rupturas en la vela que acaba de
  // cerrar, entradas en zonas y barridos al cruzar el nivel, cruces de RSI al cerrar.
  const al = Object.assign({ structure: true, zone: true, sweep: true, rsi: false, calc: true }, store.get('smartAlerts', {}));
  const alSeen = new Set(), alCooldown = new Map();
  let alPrevPrice = null, sweptPrev = null;
  const ivName = (iv) => (iv === '1d' ? '1D' : iv);
  const cooled = (key, ms) => {
    const t = alCooldown.get(key);
    if (t && Date.now() - t < ms) return false;
    alCooldown.set(key, Date.now());
    return true;
  };
  function alertsOnData() {
    if (rp.on || !state.smc || state.candles.length < 3) return;
    const iv = state.dataInterval, sec = IV_SEC[iv] || 60;
    const lastClosed = state.candles[state.candles.length - 2].time;
    if (Date.now() / 1000 - (lastClosed + sec) > 2 * sec) return; // datos viejos (de la memoria)
    if (al.structure) {
      for (const e of state.smc.structure) {
        if (e.broken !== lastClosed) continue;
        const key = `s|${iv}|${e.kind}|${e.time}|${e.broken}`;
        if (alSeen.has(key)) continue;
        alSeen.add(key);
        notify(`${e.kind} ${e.dir === 1 ? 'alcista ▲' : 'bajista ▼'} en ${ivName(iv)}: el cierre rompió ${fmtPrice(e.level)}${e.kind === 'CHOCH' ? ' (posible cambio de tendencia)' : ' (la tendencia sigue)'}`);
      }
    }
    if (al.rsi) {
      const r = rsi(state.candles.slice(0, -1).map((c) => c.close));
      const a = r[r.length - 2], b = r[r.length - 1], key = `r|${iv}|${lastClosed}`;
      if (a != null && b != null && !alSeen.has(key)) {
        alSeen.add(key);
        if (a < 70 && b >= 70) notify(`RSI en ${ivName(iv)} subió sobre 70 (${b.toFixed(1)}): zona de sobrecompra`);
        else if (a > 30 && b <= 30) notify(`RSI en ${ivName(iv)} bajó de 30 (${b.toFixed(1)}): zona de sobreventa`);
      }
    }
  }
  const sweptState = () => Object.fromEntries(levelList().map((l) => [l.k, l.swept]));
  function alertsOnPrice(p) {
    if (rp.on) return;
    const prev = alPrevPrice;
    alPrevPrice = p;
    if (prev == null) { sweptPrev = sweptState(); return; }
    const iv = state.dataInterval;
    if (al.zone && state.smc) {
      for (const z of activeZones()) {
        const inNow = p >= z.bottom && p <= z.top, inPrev = prev >= z.bottom && prev <= z.top;
        if (inNow && !inPrev && cooled(`z|${iv}|${z.type}|${z.time}`, 30 * 60 * 1000)) {
          notify(`El precio entró en el ${z.type === 'FVG' ? 'FVG' : 'order block'} ${z.dir === 1 ? 'alcista' : 'bajista'} de ${ivName(iv)}: ${fmtPrice(z.bottom)} – ${fmtPrice(z.top)}`);
        }
      }
    }
    if (al.sweep && lv.data) {
      const cur = sweptState();
      if (sweptPrev) {
        for (const l of levelList()) {
          if (cur[l.k] && sweptPrev[l.k] === false) notify(`Barrido del ${l.k} (${fmtPrice(l.p)}): el precio pasó el ${l.k.startsWith('PD') ? 'día' : 'semana'} anterior`);
        }
      }
      sweptPrev = cur;
    }
    const c = state.calc;
    if (al.calc && c.show && c.entry != null && c.stop != null) {
      for (const [name, lvl] of [['entrada', c.entry], ['stop', c.stop], ['objetivo', c.target]]) {
        if (lvl == null) continue;
        const crossed = (prev < lvl && p >= lvl) || (prev > lvl && p <= lvl);
        if (crossed && cooled(`c|${name}|${lvl}`, 10 * 60 * 1000)) notify(`El precio tocó tu ${name} (${fmtPrice(lvl)})`);
      }
    }
  }
  $$('[data-al]').forEach((cb) => {
    cb.checked = !!al[cb.dataset.al];
    cb.addEventListener('change', () => {
      al[cb.dataset.al] = cb.checked; store.set('smartAlerts', al);
      if (cb.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    });
  });

  // ---------- controles ----------
  $$('#tfs button').forEach((b) => b.addEventListener('click', () => {
    if (rp.on) rpExit();
    if (b.dataset.tf === state.interval) return;
    state.interval = b.dataset.tf; store.set('interval', state.interval);
    $$('#tfs button').forEach((x) => x.classList.toggle('on', x === b));
    state.lastPrice = null; state.measure = null;
    load(false); connect();
  }));
  $$('#tfs button').forEach((x) => x.classList.toggle('on', x.dataset.tf === state.interval));

  $$('[data-show]').forEach((cb) => {
    cb.checked = !!state.show[cb.dataset.show];
    cb.addEventListener('change', () => {
      state.show[cb.dataset.show] = cb.checked;
      store.set('show', state.show);
      applyVisibility();
    });
  });

  const swingEl = $('#swing'), swingVal = $('#swing-val');
  swingEl.value = state.swing; swingVal.textContent = state.swing;
  swingEl.addEventListener('input', () => {
    state.swing = Number(swingEl.value); swingVal.textContent = state.swing;
    store.set('swing', state.swing);
    refreshSmcSoon(500);
    clearTimeout(ctxSwingTimer); ctxSwingTimer = setTimeout(() => loadCtx(true), 600);
    if (rp.on && !rp.picking) { state.smc = smcFor(state.candles); updateMarkers(); }
  });

  $$('#tools [data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('#clear-drawings').addEventListener('click', () => {
    if (!state.drawings.length) return;
    if (!confirm('¿Borrar todas las líneas dibujadas?')) return;
    state.drawings = []; select(null); setHover(null); saveDrawings(); renderPriceLines();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { setTool('cursor'); state.measure = null; select(null); return; }
    if (e.target.closest?.('input, textarea')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) { e.preventDefault(); deleteSelected(); }
  });

  // ---------- inicio ----------
  setTool('cursor');
  renderAlerts();
  applyVisibility();
  load(false).then(connect);
  if (window.TP_VERSION) $('#ver').textContent = 'v' + window.TP_VERSION;
  else {
    fetch('/api/version').then((r) => r.json())
      .then((v) => { $('#ver').textContent = 'v' + v.version; })
      .catch(() => { /* sin versión */ });
  }
})();
