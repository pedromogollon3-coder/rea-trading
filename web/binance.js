/* Acceso a la API pública de Binance para Trading Pedro, con un solo control de límites.
 *
 * Binance cuenta el "peso" de las consultas por conexión (IP) y por minuto. Si se pasa,
 * responde 429; si se sigue preguntando, bloquea la IP un tiempo y responde 418, y cada
 * consulta durante el bloqueo lo alarga. Por eso, ante 429 o 418 se deja de consultar
 * hasta la hora que indica Binance (o una pausa prudente si no la indica).
 */
(function () {
  'use strict';
  const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
  let pausedUntil = 0;
  const listeners = [];

  class BinancePaused extends Error {
    constructor(until) {
      super('Binance limitó las consultas; se reanudan a las ' + new Date(until).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }));
      this.until = until;
    }
  }

  function pause(until) {
    if (until <= pausedUntil) return;
    pausedUntil = until;
    listeners.forEach((fn) => { try { fn(until); } catch { /* sin efecto */ } });
  }

  // Hora de fin del bloqueo: del mensaje de Binance ("IP banned until 1700000000000"),
  // de la cabecera Retry-After, o una pausa por defecto.
  async function banUntil(r) {
    let until = 0;
    try {
      const body = await r.clone().json();
      const m = /until (\d{13})/.exec(body && body.msg || '');
      if (m) until = Number(m[1]);
    } catch { /* sin cuerpo JSON */ }
    const ra = Number(r.headers.get('Retry-After'));
    if (!until && ra > 0) until = Date.now() + ra * 1000;
    if (!until) until = Date.now() + (r.status === 418 ? 5 * 60 : 60) * 1000;
    return until + 2000;
  }

  /** GET a un endpoint público, p. ej. '/api/v3/klines?symbol=BTCUSDT&interval=1m'. */
  async function getJson(path) {
    if (Date.now() < pausedUntil) throw new BinancePaused(pausedUntil);
    let lastErr;
    for (const host of HOSTS) {
      try {
        const r = await fetch(host + path);
        if (r.status === 429 || r.status === 418) {
          pause(await banUntil(r));
          throw new BinancePaused(pausedUntil);
        }
        if (!r.ok) throw new Error(`Binance respondió ${r.status}`);
        return await r.json();
      } catch (e) {
        if (e instanceof BinancePaused) throw e; // no insistir con otro servidor
        lastErr = e;
      }
    }
    throw new Error(lastErr ? lastErr.message : 'sin conexión con Binance');
  }

  window.TPBinance = {
    getJson,
    BinancePaused,
    pausedUntil: () => pausedUntil,
    onPause: (fn) => listeners.push(fn),
  };
})();
