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
    ob: true, fvg: true, structure: true, swings: true, liquidity: false, activeOnly: true,
  };

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
    if (!state.show.swings || !state.smc) { candles.setMarkers([]); return; }
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
    candles.setMarkers(marks);
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
      </dl>`;
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
    if (state.pending) {
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
    measure: 'Clic en el punto inicial de la medida…',
    alert: 'Haz clic en el precio de la alerta',
  };
  function setTool(tool) {
    state.tool = tool; state.pending = null; state.ghost = null;
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
    if (state.tool === 'cursor' && shift) { state.measure = null; setTool('measure'); }
    if (state.tool === 'cursor') return;
    const price = candles.coordinateToPrice(y);
    if (price == null) return;
    if (state.tool === 'hline') {
      state.drawings.push({ type: 'h', price }); saveDrawings(); renderPriceLines(); setTool('cursor');
    } else if (state.tool === 'trend') {
      const pt = pointAt(x, y);
      if (!pt) return;
      if (!state.pending) {
        state.pending = pt;
        $('#hint').textContent = 'Ahora clic en el segundo punto';
      } else {
        const d = { type: 't', t1: state.pending.t, p1: state.pending.p, t2: pt.t, p2: pt.p, color: C.accent, width: 2 };
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
    if (state.tool === 'trend' && state.pending) state.ghost = pointAt(param.point.x, param.point.y);
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
    const list = state.drawings.filter((d) => d.type === 't').reverse();
    const order = state.selected ? [state.selected, ...list.filter((d) => d !== state.selected)] : list;
    const geoms = order.map((d) => [d, trendGeom(d)]).filter(([, g]) => g);
    for (const [d, g] of geoms) {
      if (Math.hypot(x - g.x1, y - g.y1) <= 8) return { d, part: 1 };
      if (Math.hypot(x - g.x2, y - g.y2) <= 8) return { d, part: 2 };
    }
    for (const [d, g] of geoms) if (distToSeg(x, y, g.x1, g.y1, g.ex, g.ey) <= 6) return { d, part: 0 };
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
    if (state.tool !== 'cursor' || e.shiftKey) return;
    if (state.measure && state.measure.fixed) state.measure = null; // el siguiente clic quita la medida
    const hit = hitTest(x, y);
    if (!hit) { if (state.selected) select(null); return; }
    e.preventDefault(); e.stopPropagation();
    select(hit.d);
    drag = { ...hit, orig: { ...hit.d }, startL: chart.timeScale().coordinateToLogical(x), startP: candles.coordinateToPrice(y), moved: false };
    chart.applyOptions({ handleScroll: false, handleScale: false });
    mainEl.setPointerCapture(e.pointerId);
    mainEl.classList.add('dragging');
  }, true);

  mainEl.addEventListener('pointermove', (e) => {
    if (e.target.closest('#draw-bar')) return;
    const { x, y } = localXY(e);
    if (!drag) { setHover(state.tool === 'cursor' ? hitTest(x, y) : null); return; }
    const l = chart.timeScale().coordinateToLogical(x), p = candles.coordinateToPrice(y);
    if (l == null || p == null || drag.startL == null || drag.startP == null) return;
    const d = drag.d, o = drag.orig;
    if (drag.part === 1) { d.t1 = logicalToTime(Math.round(l)); d.p1 = p; }
    else if (drag.part === 2) { d.t2 = logicalToTime(Math.round(l)); d.p2 = p; }
    else {
      const dl = Math.round(l - drag.startL), dp = p - drag.startP;
      d.t1 = logicalToTime(timeToLogical(o.t1) + dl); d.p1 = o.p1 + dp;
      d.t2 = logicalToTime(timeToLogical(o.t2) + dl); d.p2 = o.p2 + dp;
    }
    drag.moved = true;
  });

  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) saveDrawings();
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
  mainEl.addEventListener('pointerleave', () => { if (!drag) setHover(null); });

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button'), d = state.selected;
    if (!b || !d) return;
    if (b.dataset.color) d.color = b.dataset.color;
    else if ('width' in b.dataset) d.width = ((d.width || 2) % 4) + 1;
    else if ('ext' in b.dataset) d.ext = !d.ext;
    else if ('del' in b.dataset) { deleteSelected(); return; }
    saveDrawings(); syncBar();
  });

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
    const hit = state.alerts.filter((a) => (a.above ? price >= a.price : price <= a.price));
    if (!hit.length) return;
    hit.forEach((a) => {
      const msg = `BTC ${a.above ? 'subió a' : 'bajó a'} ${fmtPrice(a.price)} (ahora ${fmtPrice(price)})`;
      toast('🔔 ' + msg); beep();
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Trading Pedro', { body: msg, icon: 'logo.svg' }); } catch { /* sin notificaciones */ }
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
  }

  let loadSeq = 0;
  async function load(keepView) {
    const seq = ++loadSeq;
    const key = memoKey();
    let shown = false;
    if (memo[key] && !keepView) { render(memo[key], false); shown = true; }
    else if (!keepView) $('#chart-main').classList.add('loading');
    try {
      const r = await fetch(`/api/data?interval=${state.interval}&swing=${state.swing}&limit=3000`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      memo[`${j.interval}|${state.swing}`] = j;
      if (seq !== loadSeq) return; // llegó una petición más nueva
      render(j, keepView || shown);
    } catch (e) {
      if (seq === loadSeq) {
        toast('No se pudieron cargar los datos: ' + e.message, true);
        setStatus('err', 'Error de datos');
      }
    } finally {
      if (seq === loadSeq) $('#chart-main').classList.remove('loading');
    }
  }

  let smcTimer;
  function refreshSmcSoon(ms = 1500) { clearTimeout(smcTimer); smcTimer = setTimeout(() => load(true), ms); }

  function onKline(k) {
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
    const streams = `btcusdt@kline_${state.interval}/btcusdt@ticker`;
    let opened = false;
    ws = new WebSocket(`${WS_HOSTS[wsHost]}/stream?streams=${streams}`);
    ws.onopen = () => { opened = true; wsFails = 0; clearInterval(pollTimer); pollTimer = null; setStatus('live', 'En vivo'); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.stream.endsWith('@ticker')) onTicker(m.data);
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

  // ---------- controles ----------
  $$('#tfs button').forEach((b) => b.addEventListener('click', () => {
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
})();
