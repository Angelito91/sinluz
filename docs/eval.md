# Evaluación del corpus etiquetado

El arnés mide qué tan bien interpreta el modelo los mensajes reales del canal.
No sustituye a los tests: los tests fijan el contrato, la evaluación mide
calidad sobre 60 mensajes etiquetados a mano.

## Archivos

| Archivo | Qué contiene |
|---|---|
| `worker/test/fixtures/messages.json` | 293 mensajes reales del canal |
| `worker/test/fixtures/labels.json` | 60 mensajes etiquetados: cambios y métricas esperados |
| `worker/test/fixtures/llm-replay.json` | respuestas sintéticas derivadas de las etiquetas |
| `worker/scripts/eval.ts` | arnés de evaluación |

Las etiquetas cubren los 21 mensajes con «seccionalizado», las variantes 7/9,
el ruido de quejas (60209), las cifras provinciales y las listas largas de
afectados y restablecidos.

## Replay (sin credenciales)

```bash
bun run eval:replay
```

Lee `llm-replay.json` y aplica el mismo pipeline que producción: Zod, guardia de
menciones y `applyChanges`. Sirve para comprobar el arnés y las reglas del
servidor sin gastar IA.

El archivo incluido es **sintético**: se generó desde las etiquetas para probar
el pipeline, no es una medición del modelo. Para evaluar el modelo de verdad,
graba respuestas reales con el modo en vivo.

## En vivo

El modo en vivo llama a Workers AI por REST. Lee las credenciales del entorno:

```bash
export CLOUDFLARE_ACCOUNT_ID="..."
export CLOUDFLARE_API_TOKEN="..."
bun run eval:live
```

Reglas de seguridad:

- No escribas las credenciales en el repo, en `.env` versionado ni en la línea
  de comandos.
- El token va en la cabecera `Authorization`, nunca en la URL.
- El script no imprime ni guarda las credenciales.
- Para grabar las respuestas y reproducirlas después:

```bash
bun run eval:live -- --save worker/test/fixtures/llm-replay.json
bun run eval:replay
```

Opciones:

```bash
bun run eval:live -- --limit 10          # primeros 10 mensajes
bun run eval:live -- --model @cf/...     # otro modelo
bun run eval:replay -- --replay-file r.json
```

## Qué mide

- **Cambios**: compara el conjunto `circuito:estado` esperado con el que
  sobrevive a la guardia de menciones. Reporta aciertos, sobrantes y faltantes.
- **Precisión / recall / F1** sobre esos cambios.
- **Exactitud por mensaje**: un mensaje cuenta como exacto solo si no sobran ni
  faltan cambios y las métricas coinciden.
- **Métricas**: compara `deficit_mw` y `servido_mw`. Una cifra inesperada cuenta
  como fallo.

Ejemplo de salida:

```
Modo: replay (.../llm-replay.json)
Mensajes: 60 · exactos: 60 · cambios: 184 aciertos, 0 sobran, 0 faltan ·
precisión 100.0% · recall 100.0% · F1 100.0%
Métricas: 18/18
```

El script termina con código 1 si algún mensaje falla, así que puede usarse como
puerta de calidad en local o CI (siempre en replay).

## Formato de las etiquetas

```json
{
  "labels": {
    "60187": {
      "cambios": [
        { "circuito": "sc-17", "estado": "out" },
        { "circuito": "sc-25", "estado": "out" }
      ]
    },
    "60189": {
      "cambios": [],
      "metricas": { "deficit_mw": 140, "servido_mw": 30 }
    }
  }
}
```

- `cambios` es la verdad esperada para ese mensaje, no el estado acumulado.
- Un circuito que el mensaje vuelve a listar como afectado se etiqueta `out`
  aunque ya estuviera fuera.
- `metricas` solo aparece si el mensaje trae cifras provinciales en MW.
- Los ids deben existir en `worker/data/circuits.json`; el arnés falla al
  arrancar si no.

## Cómo añadir un mensaje

1. Copia el id y el texto desde `messages.json`.
2. Añade la etiqueta en `labels.json`.
3. Añade la respuesta correspondiente en `llm-replay.json` si quieres que el
   replay la cubra.
4. Ejecuta `bun run eval:replay` y `bun run test`.

Si el modelo falla en un caso que el catálogo no puede representar (por ejemplo,
una línea que no existe), primero añade el circuito o el alias; después etiqueta.

## Guardia de menciones

La evaluación usa `enforce` para medir lo que realmente se aplicaría. En
producción el valor por defecto es `log`: los cambios sin mención se registran
pero no se bloquean. Cuando el recall del corpus sea estable, cambia
`MENTION_GUARD` a `enforce` en `worker/wrangler.toml`.
