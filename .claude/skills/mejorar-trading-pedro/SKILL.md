---
name: mejorar-trading-pedro
description: Ciclo de mejora medida de Trading Pedro. Corre el evaluador, propone UNA mejora de la estrategia con su hipótesis, la implementa en una rama, vuelve a medir contra la base y la acepta o la descarta según los números, anotando todo en la bitácora. Úsalo cuando el usuario pida "mejorar Trading Pedro", "otro ciclo de mejora", "mejora la estrategia", "prueba esta idea" (un filtro, un stop, un objetivo, un indicador) o pregunte si un cambio de reglas de verdad mejora los resultados. No lo uses para cambios de interfaz o funciones nuevas que no alteran las señales (ahí basta correr `node pruebas.js`).
---

# Ciclo de mejora de Trading Pedro

El objetivo es que cada cambio en las reglas de la estrategia quede **medido**, no opinado. Un ciclo prueba una sola idea. La mayoría de las ideas no mejoran nada: descartarlas es un resultado normal y útil.

## Herramientas

| Qué | Comando |
|---|---|
| Pruebas de regresión | `node pruebas.js` |
| Evaluar el tramo de desarrollo | `node evaluar.js` (añade `--operaciones` para ver cada operación) |
| Fijar la base de comparación | `node evaluar.js --fijar-base` |
| Mirar la reserva | `node evaluar.js --reserva` (solo en el paso 6) |
| Regenerar el archivo único | `python construir_html.py` |

- Reglas de la estrategia: `web/tradinglatino.js`. Indicadores: `web/indicadores.js`. Simulación: `evaluar.js`.
- Base: `evaluaciones/base.json`. Bitácora: `evaluaciones/bitacora.md`.
- Los resultados se miden en R (1 R = lo arriesgado en una operación). La medida principal es el **R medio** con su margen del 95 %.

## El ciclo

### 1. Punto de partida
- Lee `evaluaciones/bitacora.md` entera: qué se probó ya, qué falló y qué pistas quedan. No repitas una idea descartada salvo que haya una razón nueva.
- Comprueba que el árbol de git está limpio y corre `node pruebas.js` y `node evaluar.js --no-guardar`. El resultado debe coincidir con la base. Si no coincide, averigua por qué antes de seguir (datos actualizados, cambios sin medir); no fijes una base nueva sin decírselo al usuario.

### 2. Una hipótesis
- Si el usuario trajo una idea, esa es la hipótesis. Si no, busca la pista más prometedora en los grupos de la evaluación y en `--operaciones` (por ejemplo: un grupo que pierde claramente, objetivos demasiado cerca, stops demasiado amplios).
- Escríbela en una frase, **antes de tocar código**, con esta forma: "Si cambio X, espero que mejore Y, porque Z". Tiene que tener un porqué de mercado o de la propia estrategia, no solo "los números salen mejor".
- Un solo cambio por ciclo. Si hacen falta dos cambios a la vez, son dos ciclos.

### 3. Implementar
- Crea una rama: `git switch -c mejora/<nombre-corto>`.
- Haz el cambio mínimo. Si añades un valor ajustable (un umbral, un múltiplo), ponlo como constante con nombre al inicio del archivo, junto a `NEAR_ATR` y las demás.
- No toques `evaluar.js` en un ciclo que cambia la estrategia: cambiar la regla y la vara de medir a la vez hace que la comparación no valga. Mejorar el evaluador es un ciclo aparte, que termina fijando una base nueva.

### 4. Medir
- `node pruebas.js`. Si falla "los cálculos dan lo mismo que la referencia" en algo que cambiaste a propósito, es lo esperado: actualiza con `node pruebas.js --actualizar` solo al aceptar la mejora. Si falla en algo que no tocaste, rompiste algo: arréglalo.
- `node evaluar.js`. Compara contra la base.

### 5. Decidir con el tramo de desarrollo
La mejora pasa a confirmación solo si se cumple todo:
- El R medio sube, y sube también (o al menos no baja) el R total.
- No se queda sin operaciones: conserva al menos la mitad de las de la base y no menos de 40. Un filtro que deja 12 operaciones estupendas no demuestra nada.
- La mejora no depende de una o dos operaciones: quita la mejor operación y mira si el resultado sigue siendo mejor que la base.
- La peor caída no empeora de forma clara.
- El cambio va en el sentido de la hipótesis. Si mejora por una razón distinta de la prevista, trátalo como casualidad.

Prohibido en este paso: probar varios valores de un umbral y quedarse con el mejor. Si quieres explorar un umbral, prueba como mucho tres valores razonables elegidos de antemano, y solo vale si los tres mejoran en la misma dirección; se elige el del medio, no el campeón.

Si no pasa: `git switch main`, borra la rama, anota en la bitácora y termina el ciclo (o empieza otro con otra hipótesis).

### 6. Confirmar con la reserva (una sola vez por mejora)
- Corre `node evaluar.js --reserva` **una vez**. La reserva es el último 25 % del periodo, que nunca se usó para decidir.
- Confirmada: en la reserva el R medio no es peor que el de la base en la reserva (para saberlo, mide la base en la reserva desde `main` una vez y anótalo en la bitácora; ese dato se reutiliza).
- No confirmada: se descarta. **No se retoca la idea para que pase la reserva**; eso convierte la reserva en datos de ajuste y deja de servir.
- Cada mirada a la reserva la desgasta. Anota todas en la bitácora. Cuando lleve unas cinco miradas, propón al usuario actualizar los datos (`--descargar`) para tener una reserva nueva.

### 7. Presentar al usuario
Muéstrale, en lenguaje llano: la hipótesis, la tabla antes/después del tramo de desarrollo, el resultado en la reserva, cuántas operaciones cambian y tu recomendación. Recuerda que es una medición sobre el pasado y que no garantiza resultados futuros. **Él decide** si se incorpora.

Si acepta:
1. `node pruebas.js --actualizar` (si cambió un cálculo a propósito) y `node pruebas.js`.
2. `node evaluar.js --fijar-base`.
3. `python construir_html.py`.
4. Comprueba que la app abre sin errores (servidor `trading-pedro` de `.claude/launch.json`).
5. Commit y fusión con `main` solo cuando él lo pida. La versión de `trading_pedro.py` la sube él o se sube cuando lo indique.

### 8. Bitácora
Añade siempre una entrada a `evaluaciones/bitacora.md`, se acepte o no:

```
## AAAA-MM-DD · <nombre corto> · ACEPTADA | DESCARTADA | NO CONFIRMADA
Hipótesis: …
Cambio: archivo y qué se tocó.
Desarrollo: operaciones A → B · R medio A → B · R total A → B · peor caída A → B
Reserva: no se miró | R medio base X, con el cambio Y (mirada n.º N)
Lección: qué se aprendió, y qué pista deja para otro ciclo.
```

## Límites

- Esta herramienta mide reglas mecánicas sobre datos pasados. No da consejos de inversión ni dice cuándo operar, y nunca ejecuta operaciones.
- Con unas 85 operaciones, diferencias pequeñas de R medio son ruido. Ante la duda, descartar: una mejora falsa cuesta más que una mejora verdadera que se deja pasar.
- Varios ciclos seguidos sobre los mismos datos también sobreajustan, aunque cada uno sea honesto. Por eso la bitácora cuenta todos los intentos, incluidos los fallidos.
