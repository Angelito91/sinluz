# SinLuz · Santiago de Cuba

Estado de los circuitos eléctricos de la provincia, a partir del canal oficial
de Telegram [@electricastgo](https://t.me/electricastgo).

**PWA instalable**, mapa propio sin teselas, contador de tiempo sin luz al
segundo y funcionamiento sin conexión. Coste de infraestructura: 0 €.

> **Regla de producto:** la app nunca afirma que hay corriente. Lo máximo que
> puede decir es **«sin afectación reportada»**, que es exactamente lo que el
> canal permite saber.

---

## Estado del proyecto

| Pieza | Estado |
|---|---|
| Catálogo (48 circuitos, 9 municipios) | listo |
| Parser determinista (intención + nombres) | listo · cobertura 100 % del corpus real |
| Tests (`bun test`) | 30 pass |
| Worker + D1 + cron | listo · probado en local con datos en vivo |
| Frontend (mapa + lista + favoritos + offline) | listo |
| Deploy | pendiente de credenciales de Cloudflare |

---

## Cómo funciona

```
Telegram @electricastgo
        │  (bridge público /json, 1 petición cada 5 min)
        ▼
Cloudflare Worker ── cron */5 ──► D1 (raw_messages)
        │                              │
        │  parser determinista         │  replay completo
        ▼                              ▼
   state_snapshot (1 fila) ◄──── rebuild idempotente
        │
        │  GET /api/v1/status  (caché de borde 30 s)
        ▼
PWA React 19  ·  mapa GeoJSON  ·  offline con Workbox
```

### El parser y sus reglas duras

| `intent` | Se dispara con | Efecto |
|---|---|---|
| `snapshot` | «Se afecta el servicio eléctrico en los siguientes circuitos» | reemplaza el conjunto |
| `add` | «se incorporan a la afectación…» | suma |
| `restore` | «Se restablece el servicio…» | resta |
| `top_n` | «Circuitos con **mayor** tiempo de afectación» | **nunca borra** |
| `metrics` | «MW afectados / MW servidos» | actualiza cifras |
| `info` | teléfonos, avisos, reiteraciones | solo archiva |

Guardas, todas con test:

1. `top_n` e `info` **jamás** alteran la pertenencia al conjunto.
2. Un `snapshot` sin ninguna coincidencia se trata como `info` (protección ante
   un parseo roto).
3. `restore` de un circuito que no estaba afectado se ignora sin fallar.
4. Un circuito que sale del conjunto queda en `none_reported`, nunca en verde.
5. «Actualización de los circuitos que se encuentran afectados» **sin** «se
   afecta el servicio» se clasifica como `top_n`: el canal suele listar ahí solo
   los más críticos.

Detalle completo en [`docs/mvp.md`](docs/mvp.md). Guía para quien mantiene los
datos en [`docs/guia-datos.md`](docs/guia-datos.md).

---

## Requisitos

- [Bun](https://bun.sh) ≥ 1.2 — se usa para todo: scripts, tests y build.
- Una cuenta de Cloudflare solo para desplegar.

```bash
bun install
```

> Si `bun install` no funciona por la red, `npm install` produce el mismo árbol
> (`node_modules` es estándar). El resto de comandos siguen siendo de Bun.

---

## Desarrollo

```bash
# 1. API con D1 local (puerto 8787)
cd worker
bunx wrangler d1 execute sinluz --local --file=schema.sql
printf 'INGEST_TOKEN=dev\nADMIN_TOKEN=dev\n' > .dev.vars
bunx wrangler dev

# 2. Frontend (puerto 5173, proxy /api → 8787)
bun run dev
```

Primera ingesta de datos reales, sin esperar al cron:

```bash
curl -X POST http://127.0.0.1:8787/cdn-cgi/local/scheduled        # dispara el cron local
curl -H 'authorization: Bearer dev' -X POST http://127.0.0.1:8787/api/v1/refresh
curl http://127.0.0.1:8787/api/health
```

---

## Comandos

```bash
bun test                 # 30 tests: parser, máquina de estados, corpus real
bun run build            # typecheck + build de la PWA
bun run preview          # sirve el build en 4173 (con proxy /api → 8787)

bun run data:check       # circuits.csv → circuits.json (valida el catálogo)
bun run data:report      # cobertura del parser sobre el corpus real
bun run data:review      # muestra de mensajes para etiquetar a mano
bun run data:score       # compara las etiquetas humanas con el parser
bun run replay           # reconstruye el estado desde el corpus (--json)
bun run fixtures         # vuelve a descargar mensajes reales del canal
bun run geojson          # regenera el GeoJSON de los 9 municipios
bun run sync             # copia los datos generados a web/public
```

---

## API

```
GET  /api/v1/status           estado + generated_at + age_min + MW
GET  /api/v1/circuits         catálogo (caché 1 día)
GET  /api/health              frescura y última ingesta (503 si no está sano)
POST /api/v1/ingest           Bearer INGEST_TOKEN · mensaje crudo
POST /api/v1/admin/override   Bearer ADMIN_TOKEN · circuit_id + status
GET  /api/v1/admin/overrides  Bearer ADMIN_TOKEN · correcciones activas
DELETE /api/v1/admin/override/:circuit   Bearer ADMIN_TOKEN · quita la corrección
POST /api/v1/refresh          Bearer INGEST_TOKEN · fuerza una ingesta
```

Las correcciones manuales se guardan en su propia tabla y se aplican al final de
cada reconstrucción, así que una ingesta no las borra.

`GET /api/v1/status` se sirve con
`Cache-Control: public, max-age=30, stale-while-revalidate=60, stale-if-error=86400`,
así que el origen recibe ~2 peticiones por minuto.

Frescura en la UI: `≤ 90 min` normal · `90–360 min` aviso ámbar · `> 360 min`
«sin datos fiables».

---

## Deploy

```bash
bunx wrangler d1 create sinluz                      # copia el id a wrangler.toml
cd worker && bunx wrangler d1 execute sinluz --remote --file=schema.sql
bunx wrangler secret put INGEST_TOKEN
bunx wrangler secret put ADMIN_TOKEN
bunx wrangler secret put ALERT_BOT_TOKEN            # opcional
bunx wrangler secret put ALERT_CHAT_ID              # opcional
bunx wrangler deploy

cd .. && VITE_API_BASE=https://sinluz-api.<subdominio>.workers.dev bun run build
cd web && bunx wrangler pages deploy dist --project-name sinluz
```

Sin `VITE_API_BASE` el frontend llama a `/api/...` en su propio origen, que es
lo que conviene si se sirve detrás del mismo dominio.

---

## Estructura

```
sinluz/
├── shared/src/types.ts          esquemas Zod compartidos
├── worker/
│   ├── src/
│   │   ├── index.ts             Hono: rutas + cron
│   │   ├── ingest.ts            1 petición/ejecución, backoff 5→40 min
│   │   ├── classify.ts          intención y cifras MW
│   │   ├── normalize.ts         nombres → id de circuito
│   │   ├── state.ts             aplicación de intenciones
│   │   ├── store.ts             D1: snapshot + rebuild
│   │   └── catalog.ts           catálogo y índice de alias
│   ├── data/circuits.csv        ← lo edita la analista
│   ├── data/municipios.geojson  9 municipios, 21 KB
│   ├── scripts/                 datos, informes y replay
│   └── test/                    30 tests + corpus real de 293 mensajes
├── web/src/                     App, MapView, CircuitList, hooks
└── docs/                        MVP y guía de datos
```

---

## Límites del origen

El endpoint `/json` lo mantiene un particular ([i-c-a.su](https://i-c-a.su),
código MIT). Sus condiciones: máximo 15 peticiones/minuto, **cuarentena
inmediata ante cualquier error** y no usarlo como hosting de medios. SinLuz hace
**0,2 peticiones/minuto** desde un solo consumidor y guarda una copia propia en
D1, de forma que el bridge caído no deja la app sin datos.

---

## Aviso

App no oficial, sin relación con la Empresa Eléctrica ni con el canal. Los datos
provienen de mensajes públicos y pueden estar desactualizados. «Sin afectación
reportada» significa que el canal no menciona ese circuito, no que tenga
servicio.
