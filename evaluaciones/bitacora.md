# Bitácora de mejoras de Trading Pedro

Cada ciclo de mejora deja aquí una entrada, se acepte o no. Miradas a la reserva hasta ahora: 0.

## 2026-11-14 · Base inicial · versión 3.2

Estrategia TradingLatino, BTCUSDT, sin comisión. Datos de 1H del 2023-11-15 al 2026-11-14.
Desarrollo (2024-06-02 a 2026-04-04): 85 operaciones · 53 % de aciertos · R medio −0,16 (margen −0,35 a +0,02) · R total −14,0 · peor caída 15,3 R.
Reserva (2026-04-04 a 2026-11-14): sin mirar.
Esta base quedó sustituida el mismo día por la que incluye la salida por giro del monitor (ver abajo).

Pistas para próximos ciclos (sin probar todavía):
- El R:B medio del plan es 1,01 y muchas ganadoras dejan 0,1–0,3 R: los objetivos quedan muy cerca frente al stop.
- Las operaciones con gatillo de 1H cumplido salen peor (16 operaciones, 31 % de aciertos, R medio −0,53) que sin él. Son pocas: investigar antes de concluir.
- El evaluador no simula la salida "cuando el monitor de 4H gire"; añadirla sería un ciclo aparte que termina con base nueva.

## 2026-11-14 · Objetivo mínimo (R:B del plan) · DESCARTADA sin implementar
Hipótesis: si no se entra cuando el objetivo queda a menos de 1 R, sube el R medio, porque arriesgar 1 para ganar 0,2 exige acertar más del 80 %.
Cambio: ninguno. Se descartó al mirar las operaciones de la base por tramos de R:B del plan.
Desarrollo (base, por R:B del plan): menos de 0,5 → 34 oper., 76 % aciertos, R medio −0,04 · 0,5 a 1 → 24 oper., −0,02 · 1 a 1,5 → 11 oper., +0,01 · 1,5 o más → 16 oper., 1 acierto, −12,4 R en total.
Reserva: no se miró.
Lección: los objetivos cercanos no son el problema; salen casi a la par. Lo que perdía eran los objetivos lejanos, donde la estrategia real saldría antes por el giro del monitor, que el evaluador no simulaba. Un filtro de R:B mínimo dejaría además menos de 40 operaciones.

## 2026-11-14 · Salida por giro del monitor en el evaluador · ACEPTADA (base nueva fijada)
Hipótesis: si el evaluador cierra la operación cuando el monitor de 4H gira (verde oscuro en largos, rojo claro en cortos), la medición será fiel al plan que muestra la app ("o cuando el monitor de 4H gire…") y dejarán de contarse como stops completos operaciones que la estrategia habría cerrado antes.
Cambio: evaluar.js (no se tocó la estrategia). Al cierre de cada vela de 4H, si el monitor acaba de girar al color de salida, se cierra al precio de cierre. `--sin-salida-monitor` reproduce la medición anterior.
Desarrollo: operaciones 85 → 102 · aciertos 53 % → 50 % · R medio −0,16 → +0,01 (margen −0,13 a +0,16) · R total −14,0 → +1,1 · peor caída 15,3 → 6,0. Salidas: 39 en objetivo, 19 en stop, 44 por giro del monitor.
Reserva: no se miró. Es un cambio de la vara de medir, justificado por fidelidad a la regla escrita y no por el resultado, así que no gasta reserva.
Lección: medida como está escrita, la estrategia sale a la par (R medio ≈ 0): no pierde, pero tampoco muestra ventaja. Pistas: los largos (−0,06) van peor que los cortos (+0,06); "con gatillo de 1H" sigue peor que sin él (18 oper., −0,18), aún con pocas operaciones.

## 2026-11-14 · Estrategia Pedro 1 y tres monedas · BASE NUEVA
Cambio: se creó la estrategia propia Pedro (web/estrategia_pedro.js) como copia exacta de TradingLatino, que queda fija como referencia. El evaluador mide ahora todas las estrategias en BTC, ETH y SOL (1H del 2023-11-15 al 2026-11-14). No cambió ninguna regla.
Desarrollo (2024-06-02 a 2026-04-04), Pedro 1 = TradingLatino: 307 operaciones · 53 % de aciertos · R medio +0,07 (margen −0,03 a +0,16) · R total +20,3 · peor caída 14,3 R.
Por moneda: BTC 102 oper., +0,01 · ETH 105 oper., +0,08 · SOL 100 oper., +0,11.
Reserva: sin mirar (miradas hasta ahora: 0).
Pistas (sin probar): "con gatillo de 1H" sigue por debajo (57 oper., −0,08) frente a "sin gatillo" (250 oper., +0,10). "Contra el Diario" (96 oper., +0,19) sale mejor que "a favor" (211 oper., +0,01), al revés de lo que dice la estrategia: mirar por qué antes de tocar nada.
