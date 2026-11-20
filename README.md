# SinLuz · Santiago de Cuba

Estado de los circuitos eléctricos de la provincia, a partir del canal oficial
de Telegram [@electricastgo](https://t.me/electricastgo).

**PWA instalable**, mapa con teselas suaves y ubicación **aproximada** de los
circuitos, contador de tiempo sin luz al segundo y funcionamiento sin conexión.
Coste de infraestructura: 0 €.

> **Regla de producto:** el estado de cada circuito es el del **último aviso del
> canal** y se mantiene hasta que un aviso lo cambie: «con servicio» hasta que
> digan lo contrario, «sin servicio» hasta que digan que volvió. Un circuito
> afectado que el canal no menciona en 12 h pasa a **«sin confirmar»** (nunca a
> «con servicio»), y la app muestra siempre la hora del último aviso.

---

## Estado del proyecto

| Pieza | Estado |
|---|---|
| Catálogo (45 circuitos, 9 municipios) | listo |
| Intérprete LLM (Workers AI + Zod) | listo · sin reglas ni alias matching |
| Tests (`bun test`) | 40 pass |
| Worker + D1 + cron | listo · probado en local con datos en vivo |
| Frontend (mapa por municipios + «dónde estoy» + lista + favoritos + offline) | listo |
| Deploy (Worker + Pages) | **en producción** |
| Dominio propio | pendiente (hoy usa `workers.dev` + `pages.dev`) |

**En vivo**

- PWA: <https://sinluz-988.pages.dev>
- API: <https://sinluz-api.portuondoangel.workers.dev>

> Los dominios `*.workers.dev` y `*.pages.dev` están bloqueados o
> intermitentes en algunas redes de Cuba. Si la app no carga ahí, el problema es
> la red, no el despliegue: se resuelve apuntando un dominio propio a Cloudflare
> y sirviendo las dos piezas desde él.

---

## Cómo funciona

```
Telegram @electricastgo
        │  (bridge público /json, consulta cada 5 min)
        ▼
Cloudflare Worker ── cron */5 ──► lote de mensajes nuevos
        │                              │
        │  Workers AI: estado actual   │
        │  + catálogo + mensajes       │
        ▼                              ▼
   JSON validado con Zod ──► state_snapshot (1 fila)
        │
        │  GET /api/v1/status  (caché de borde 30 s)
        ▼
PWA React 19  ·  mapa GeoJSON  ·  offline con Workbox
```

### El intérprete y sus reglas duras

No hay parser determinista ni emparejador de alias. El único intérprete es un
modelo de Workers AI: recibe el estado actual (solo circuitos afectados), el
catálogo y un lote de mensajes nuevos, y devuelve **solo** un JSON con
`cambios[]` y `metrics`. El servidor lo valida con Zod y vuelve a filtrar ids,
mensajes y cifras.

1. **Nada se deduce por omisión.** Que un circuito no aparezca en una lista no lo
   restablece: solo un `ok` explícito lo saca de la afectación.
2. **Sin historial.** Solo se guarda el estado presente y el último id procesado;
   no hay `raw_messages` ni decisiones por mensaje.
3. **El servidor calcula el tiempo.** El modelo devuelve `source_message_id` y,
   si el canal lo publica, `duration_min`. El `since` se deriva en el worker.
4. **Cifras plausibles.** Las métricas provinciales se aceptan entre 0 y 600 MW;
   el parte nacional del SEN se ignora.
5. **Si el modelo falla, no se toca nada.** No se guarda snapshot ni avanza el
   cursor, y el cron reintenta en la siguiente ejecución.

Detalle completo en [`docs/mvp.md`](docs/mvp.md). Catálogo, cobertura y origen
de las ubicaciones en [`docs/circuitos.md`](docs/circuitos.md). Guía para quien
mantiene los datos en [`docs/guia-datos.md`](docs/guia-datos.md). Cómo probar lo
desplegado en [`docs/probar.md`](docs/probar.md).

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
bunx wrangler d1 execute sinluz --local --file=schema.sql   # primer arranque
# Si vienes del diseño anterior con raw_messages/llm_decisions:
#   bunx wrangler d1 execute sinluz --local --file=reset.sql
#   bunx wrangler d1 execute sinluz --local --file=schema.sql
printf 'INGEST_TOKEN=dev\nADMIN_TOKEN=dev\n' > .dev.vars
bunx wrangler dev

# 2. Frontend (puerto 5173, proxy /api → 8787)
cd .. && bun run dev
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
bun test                 # 47 tests: contrato del LLM, máquina de estados y D1
bun run typecheck        # worker, scripts y web (tsc --noEmit)
bun run build            # sync + typecheck + build de la PWA
bun run preview          # sirve el build en 4173 (con proxy /api → 8787)

bun run data:check       # circuits.csv → circuits.json (valida el catálogo)
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

Las correcciones manuales se guardan en su propia tabla y se aplican al leer el
estado, así que una ingesta no las borra.

`GET /api/v1/status` se sirve con
`Cache-Control: public, max-age=30, stale-while-revalidate=60, stale-if-error=86400`,
así que el origen recibe ~2 peticiones por minuto.

Frescura en la UI: ingesta normal por debajo de 30 min · aviso si el pipeline se
retrasa o el canal calla más de 6 h · un afectado sin menciones en 12 h pasa a
«sin confirmar».

---

## Deploy

Ya está desplegado. Para reproducirlo o actualizarlo:

```bash
bun run deploy            # Worker + build con la URL de la API + Pages
```

Los pasos sueltos, la primera vez:

```bash
cd worker
bunx wrangler d1 create sinluz                       # copia el id a wrangler.toml
bunx wrangler d1 execute sinluz --remote --file=schema.sql
bunx wrangler secret put INGEST_TOKEN
bunx wrangler secret put ADMIN_TOKEN
bunx wrangler secret put ALERT_BOT_TOKEN             # opcional
bunx wrangler secret put ALERT_CHAT_ID               # opcional
cd .. && bun run deploy:api

bunx wrangler pages project create sinluz --production-branch main
bun run deploy:web
```

La web se construye con `web/.env.production`, que contiene la URL del Worker.
Si cambias de dominio, edita ese archivo y vuelve a desplegar.

**Tokens en producción:** están en `worker/.secrets.local` (ignorado por git).
No se publican en el repo.

**Comprobar el estado del servicio:**

```bash
curl https://sinluz-api.portuondoangel.workers.dev/api/health
curl https://sinluz-api.portuondoangel.workers.dev/api/v1/status
```

El cron corre cada 5 min. La primera ingesta puede tardar hasta 5 minutos en
aparecer; para forzarla, `POST /api/v1/refresh` con el token.

---

## Estructura

```
sinluz/
├── shared/src/types.ts          esquemas Zod compartidos
├── worker/
│   ├── src/
│   │   ├── index.ts             Hono: rutas + cron
│   │   ├── ingest.ts            lotes de 15, backoff 5→40 min
│   │   ├── llm.ts               prompt, esquema y llamada a Workers AI
│   │   ├── state.ts             cambios validados → estado
│   │   ├── store.ts             D1: snapshot, overrides y settings
│   │   └── catalog.ts           catálogo y `byId`
│   ├── data/circuits.csv        ← lo edita la analista
│   ├── data/municipios.geojson  9 municipios, 21 KB
│   ├── scripts/                 catálogo, GeoJSON y fixtures
│   └── test/                    47 tests + corpus real de referencia
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
provienen de mensajes públicos y pueden estar desactualizados. «Con servicio»
significa que el canal no ha informado ninguna afectación; la hora del último
aviso se muestra siempre.
