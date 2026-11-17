# SinLuz — Documento MVP

> Estado eléctrico de Santiago de Cuba a partir del canal oficial de Telegram.
> PWA, serverless, coste 0 €, ~1 200 líneas de código propio.

Este documento describe **lo que se construyó**, con las decisiones tal como
quedaron, no como se planearon. Lo que cambió respecto al plan inicial está
marcado con **†**.

---

## 1. Alcance de la v1

**Entra**

- Ingesta automática cada 5 min desde `https://tg.i-c-a.su/json/electricastgo?limit=30`.
- Parseo determinista de intención (`snapshot` / `add` / `restore` / `top_n` / `metrics` / `info`).
- Catálogo de **48 circuitos** (14 líneas y 34 circuitos) en 9 municipios, con alias y ubicación aproximada.
- Mapa vectorial propio (GeoJSON de municipios, sin teselas) + lista + buscador + favoritos.
- Tiempo sin luz al segundo, hora de La Habana.
- PWA instalable y funcional offline con aviso de antigüedad.
- Override manual por token para corregir errores.
- Monitor de frescura: `/api/health` responde `503` y avisa por Telegram si el canal lleva 6 h callado.

**No entra**

- Historial y gráficas.
- Notificaciones push.
- Otras provincias.
- Cuentas de usuario.
- LLM en el camino crítico (previsto como fallback, hoy desactivado).

**Regla de producto irrenunciable:** la app nunca afirma que hay corriente. Solo
dice **«sin afectación reportada»**, que es exactamente lo que el canal permite
saber.

---

## 2. Stack

Criterio: una librería por problema, todas populares y con mantenimiento activo.
Ningún framework de UI, router, gestor de estado ni ORM.

| Capa | Librería | Por qué | Código propio |
|---|---|---|---|
| Runtime y scripts | **Bun** † | Pedido; sustituye a npm + tsx + Vitest | — |
| Worker HTTP | **Hono 4** | Router + middleware, estándar de facto en Workers | ~60 |
| Validación | **Zod 4** | Schema único para la API y el ingreso manual | ~40 |
| Ingesta + estado | *nada* | `fetch` nativo + regex + D1 | ~300 |
| Base de datos | **D1** (única) | Sobra para ~300 filas/día; evita KV como segundo binding | esquema SQL |
| Tests | **`bun test`** † | Cero dependencias extra, mismo runner en todo el repo | ~130 |
| UI | **React 19 + Vite 7** | Pedido y estándar | ~40 |
| Datos remotos | **SWR 2** | `refreshInterval` + caché + reintentos en 15 líneas | ~15 |
| Mapa | **Leaflet 1.9 + react-leaflet 5** | GeoJSON y círculos sin teselas | ~110 |
| PWA | **vite-plugin-pwa** | Workbox sin configuración manual | ~30 |
| Estilos | **Tailwind 4** | Evita CSS propio y hojas muertas | 0 |
| Iconos | **lucide-react** | Tree-shakeable, 4 iconos usados | ~5 |
| Deploy | **Wrangler 4** | Oficial de Cloudflare | 0 |

**Decisiones de reducción deliberadas**

- **Sin ESLint** †. `tsc --noEmit` bloquea lo que importa; el resto es ruido.
- **Sin KV.** El estado es una fila de D1 (`state_snapshot`). Con caché de borde de 30 s el origen recibe ~2 req/min. Un binding menos que explicar.
- **Sin `HTMLRewriter`.** El endpoint `/json` ya entrega texto plano.
- **Sin TanStack Query / Zustand / React Router.** Una pantalla, un recurso.
- **Sin `date-fns`.** `Intl.DateTimeFormat` nativo cubre todo (zona `America/Havana`).
- **Sin fuentes web ni imágenes.** Tipografía del sistema: 0 KB y arranque instantáneo en 3G.
- **Sin Vitest** †. `bun test` ya trae `describe`, `expect`, `test` y corre TypeScript sin transpilar.

---

## 3. Estructura del repo

```
sinluz/
├── package.json                 # workspaces: shared, worker, web
├── shared/
│   └── src/types.ts             # esquemas Zod compartidos
├── worker/
│   ├── src/
│   │   ├── index.ts             # Hono: 5 rutas + handler scheduled
│   │   ├── ingest.ts            # 1 petición/ejecución, backoff, alertas
│   │   ├── classify.ts          # intención + cifras MW
│   │   ├── normalize.ts         # texto → ids de circuito
│   │   ├── state.ts             # intención → estado
│   │   ├── store.ts             # D1: snapshot, rebuild, override
│   │   └── catalog.ts           # catálogo + índice de alias
│   ├── data/
│   │   ├── circuits.csv         # ← lo edita la analista
│   │   ├── circuits.json        # generado
│   │   ├── municipios.geojson   # generado, 21 KB
│   │   ├── municipios.centroids.json
│   │   ├── report.md            # generado
│   │   ├── unmatched.csv        # generado
│   │   └── messages_review.csv  # generado, lo rellena la analista
│   ├── scripts/
│   │   ├── build-data.ts        # CSV → JSON + validación + espiral
│   │   ├── build-geojson.ts     # geoBoundaries → GeoJSON simplificado
│   │   ├── fetch-fixtures.ts    # corpus real desde el bridge
│   │   ├── report.ts            # cobertura y tokens sin resolver
│   │   ├── review.ts            # muestra para etiquetado humano
│   │   ├── score.ts             # etiquetas humanas vs parser
│   │   ├── replay.ts            # reconstrucción determinista
│   │   └── lib/{csv,fixtures}.ts
│   ├── test/
│   │   ├── fixtures/messages.json   # 293 mensajes reales (ids 60185..60505)
│   │   ├── parser.test.ts
│   │   ├── state.test.ts
│   │   └── golden.test.ts
│   ├── schema.sql
│   └── wrangler.toml
├── web/
│   ├── src/
│   │   ├── App.tsx              # pantalla única
│   │   ├── components/{MapView,CircuitList,StatusBanner}.tsx
│   │   ├── hooks/{useStatus,useNow,useLocal}.ts
│   │   └── lib/{api,time,view}.ts
│   └── public/{circuits.json,municipios.geojson,icon.svg}
├── scripts/sync-data.ts
└── docs/
```

---

## 4. Dependencias directas

```jsonc
// raíz
"devDependencies": { "@types/bun": "^1" }
"workspaces": ["shared", "worker", "web"]

// worker
"dependencies":    { "@sinluz/shared": "file:../shared", "hono": "^4", "zod": "^4" }
"devDependencies": { "@cloudflare/workers-types": "^4", "typescript": "^5", "wrangler": "^4" }

// web
"dependencies":    { "react": "^19", "react-dom": "^19", "swr": "^2", "leaflet": "^1.9",
                     "react-leaflet": "^5", "lucide-react": "^0.500" }
"devDependencies": { "vite": "^7", "@vitejs/plugin-react": "^5", "typescript": "^5",
                     "vite-plugin-pwa": "^1", "tailwindcss": "^4", "@tailwindcss/vite": "^4",
                     "@types/react": "^19", "@types/react-dom": "^19", "@types/leaflet": "^1.9" }
```

`@sinluz/shared` se enlaza con `file:../shared` para que funcione igual con bun y
con npm (npm no soporta `workspace:*` †).

---

## 5. Modelo de datos (D1)

```sql
-- Mensajes crudos: la fuente de verdad. Permite replay completo.
CREATE TABLE raw_messages (
  id          INTEGER PRIMARY KEY,   -- id de Telegram
  posted_at   INTEGER NOT NULL,      -- unix, segundos
  text        TEXT    NOT NULL,
  text_hash   TEXT    NOT NULL,      -- detecta ediciones
  intent      TEXT,
  parsed_at   INTEGER
);

-- Documento único que sirve la API (1 fila).
CREATE TABLE state_snapshot (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  payload      TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);

-- Correcciones manuales. Sobreviven al rebuild: se aplican al final.
CREATE TABLE circuit_overrides (
  circuit_id TEXT PRIMARY KEY,
  status     TEXT NOT NULL,
  since      INTEGER,
  updated_at INTEGER NOT NULL
);

-- Backoff, alertas y otros interruptores persistentes.
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE ingest_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL, source TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT
);
```

**Sin tabla de eventos** †: `state_snapshot` se reconstruye desde `raw_messages`
en cada ingesta (~300 filas, milisegundos). Añadir `state_events` habría sido
guardar dos veces la misma información.

**Todas las marcas de tiempo están en segundos unix** en el worker, la API y el
frontend, igual que Telegram. Un solo tipo de unidad en todo el proyecto evita
la clase de bug más común de este tipo de app.

**Replay:** `bun run replay` recorre `raw_messages` con el parser actual y
reconstruye el estado. Es la herramienta para deshacer un parseo malo sin tocar
producción.

---

## 6. Parser

### 6.1 Intenciones

| `intent` | Disparador | Efecto sobre el estado |
|---|---|---|
| `snapshot` | «Se afecta el servicio eléctrico en los siguientes circuitos» / «se afectan los siguientes» | Reemplaza el conjunto. Conserva `since` de los que permanecen. |
| `add` | «se incorporan a la afectación…» | Unión. |
| `restore` | «Se restablece el servicio…» / «se restablecen los siguientes» | Resta y cierra duración. |
| `top_n` | «Circuitos con **mayor** tiempo de afectación» | **No borra nada.** Actualiza duraciones reportadas. |
| `metrics` | «MW Afectados / MW Servidos» | Actualiza cifras provinciales. |
| `info` | 18888, recomendaciones, reiteraciones | Solo archiva. |

El canal no solo publica listas largas. También manda avisos de una línea que
**sí cambian el estado** y se tratan igual:

| Mensaje real | Se clasifica como |
|---|---|
| «🚨 Se encuentra afectado por Déficit de Generación el circuito 3 de Santiago.» | `add` |
| «🚨 Se encuentran afectados por Déficit la línea 4390- Contramaestre y 5390- La Maya.» | `add` |
| «🚨 Se encuentra disparada la línea 5975- Baconao.» | `add` (avería: también es «sin servicio») |
| «🔉 Se encuentran con servicio: Circuito 21 / Circuito 2 / …» | `restore` |
| «🔉 Con servicio el circuito 2 de Palma.» | `restore` |

Y `«Con servicio 40 MW»` **no** es un restablecimiento: es una cifra, y se
mantiene como `metrics`. Esa es la razón de que la regla de `restore` exija que
el mensaje hable de circuitos y no vaya seguida de un número.

Guardas duras, todas con test:

1. `top_n` e `info` **jamás** alteran la pertenencia al conjunto.
2. Un `snapshot` sin ninguna coincidencia válida se trata como `info`.
3. `restore` de un circuito no afectado no falla: se ignora.
4. Un circuito que sale del conjunto queda en `none_reported`, nunca en verde.
5. «Actualización de los circuitos que se encuentran afectados» **sin** «se
   afecta el servicio» se clasifica como `top_n` †. El canal usa esa fórmula para
   listas parciales; tratarla como `snapshot` marcaría como «sin afectación» a
   circuitos que llevan horas a oscuras.
6. El aviso genérico «el restablecimiento estará en dependencia…» es `info`, no
   `restore` (contiene la palabra pero no cambia nada).

### 6.2 Normalización de nombres

El canal escribe el mismo circuito de formas muy distintas:

| En el mensaje | Se normaliza a |
|---|---|
| `Línea 4395Contramaestre(5175)` | `linea 4395 contramaestre 5175` → `line-4395` |
| `LI 5395-San Luis` | `linea 5395 san luis` → `line-5395` |
| `Baire-lll Frente` | `baire iii frente` → `tf-iii` |
| `ll Frente` | `ii frente` → `sf-ii` |
| `1 y 2 de Contramaestre` | se expande a `cta-01` + `cta-02` |
| `7 seccionalizado (SD 3030)` | `sc-07` (el código no forma parte del nombre) |

Pasos: decodificar entidades HTML, separar `<br>` en líneas, quitar emojis y la
duración que el propio canal añade (`➡️ 16 horas`), pasar a minúsculas sin
tildes, separar números de letras (`4395Contramaestre` → `4395 contramaestre`).

**El matcher no hace fuzzy matching.** Coincidencia exacta de alias, de más largo
a más corto y sin solapes. Sin coincidencia → la mención aparece en
`unmatched.csv` y **nunca** se adivina. Un falso positivo es peor que un hueco:
marcaría un circuito como afectado sin serlo, o al revés.

Resultado actual sobre el corpus real (293 mensajes): **cobertura 100 % por
mensaje (156/156) y 100 % por mención (801/801)**, 0 tokens sin identificar.

### 6.3 Validación cruzada

La empresa publica duraciones (`➡️ 16 horas`). Se guardan en
`reported_duration_min`. Si difieren del `since` calculado en más de 15 min se
marca `duration_mismatch` y la UI muestra el dato de la empresa, no el calculado.

### 6.4 LLM (pendiente, F7)

Solo para mensajes con texto pero sin intención detectada. Prompt con salida JSON
validada por Zod y **whitelist** del catálogo: cualquier id inventado se descarta.
`LLM_ENABLED=false` por defecto. Proveedor previsto: Groq o Gemini free tier.

---

## 7. API

```
GET  /api/v1/status            estado + generated_at + age_min + MW
GET  /api/v1/circuits          catálogo (caché 1 día)
GET  /api/health               frescura y última ingesta · 200 / 503
POST /api/v1/ingest            Bearer INGEST_TOKEN · texto crudo
POST /api/v1/admin/override    Bearer ADMIN_TOKEN · circuit_id + status
GET  /api/v1/admin/overrides   Bearer ADMIN_TOKEN · correcciones activas
DELETE /api/v1/admin/override/:circuit   Bearer ADMIN_TOKEN · quita la corrección
POST /api/v1/refresh           Bearer INGEST_TOKEN · fuerza una ingesta
```

Las correcciones manuales viven en su propia tabla y se aplican **al final** de
cada `rebuild`. Así una ingesta no las borra: sobreviven a todo hasta que se
eliminan explícitamente.

```http
Cache-Control: public, max-age=30, stale-while-revalidate=60, stale-if-error=86400
```

Con esa caché el origen recibe ~2 req/min aunque haya miles de usuarios.

Frescura en la UI: `≤ 90 min` normal · `90–360 min` banner ámbar · `> 360 min`
«sin datos fiables» y todo lo no confirmado pasa a `unknown`.

**Sobre el estado `unknown`:** no se aplica «todo a unknown a las 24 h» como
decía el plan †. El estado se conserva y la antigüedad se declara en la UI, que
es información honesta y más útil que vaciar la pantalla. Un `unknown` solo
aparece cuando el circuito nunca ha sido mencionado.

---

## 8. Pantalla única

```
┌──────────────────────────────┐
│  SinLuz · Santiago de Cuba   │  ← frescura del canal
├──────────────────────────────┤
│                              │
│         MAPA (46 %)          │  ← GeoJSON + círculos
│                              │
├──────────────────────────────┤
│  5 circuitos afectados       │  ← hoja inferior
│  déficit 100 MW  40 MW       │
│  [ Buscar ]  [ Mi circuito ] │
│  ● Circuito 11   hace 1h03m  │
│  ● Línea 5380    hace 1h03m  │
│  ○ Circuito 1    sin afecta… │
└──────────────────────────────┘
```

- Tiempo recalculado cada segundo en cliente desde `since` (sin peticiones).
- «Mi circuito» en `localStorage`: resaltado y filtro.
- Tocar un circuito centra el mapa en su zona (`flyTo`).
- Circuitos del mismo municipio repartidos en espiral para que no se solapen.
- Estados visuales cubiertos: carga (skeleton), vacío, datos viejos, offline,
  error de red, sin coincidencias en la búsqueda.
- Accesibilidad: color **y** texto, contraste AA, `prefers-reduced-motion`
  respetado, `aria-current` / `aria-pressed` en los controles.

---

## 9. PWA

- Shell precacheado: HTML, JS, CSS, GeoJSON y catálogo (9 entradas, 477 KiB).
- API: `NetworkFirst` con timeout de 3 s y caída a la última respuesta buena.
- Offline: banner «mostrando la última información guardada» y tiempos corriendo.
- Sin teselas: no hay caché de mapa que gestionar. Es la mayor simplificación del
  proyecto y además evita depender de un proveedor externo de mapas.
- Icono único SVG `any` + `maskable` (no hay PNGs; el manifest los declara por
  tipo, no por tamaño).

---

## 10. Fases

| Fase | Entregable | Estado |
|---|---|---|
| **F0** | Corpus real (293 mensajes, fusión de páginas) | ✅ |
| **F1** | `circuits.json` + `municipios.geojson` | ✅ 48 circuitos, 9 municipios, 21 KB |
| **F2** | `classify` + `normalize` + `state` + tests | ✅ 30 pass, cobertura 100 % |
| **F3** | Worker con D1, cron, API, override | ✅ probado en local con datos en vivo |
| **F4** | Mapa + hoja + lista + buscador | ✅ |
| **F5** | PWA + offline + frescura | ✅ build con service worker |
| **F6** | Deploy + monitor + README | ⏳ falta el `database_id` y las credenciales |
| **F7** | LLM fallback + eval | ⏳ opcional |

Ruta crítica real: **F0 → F1 → F2**. El resto es mecánico.

---

## 11. Deploy

```bash
bun run data:check
bunx wrangler d1 create sinluz          # copia el id a worker/wrangler.toml
cd worker && bunx wrangler d1 execute sinluz --remote --file=schema.sql
bunx wrangler secret put INGEST_TOKEN
bunx wrangler secret put ADMIN_TOKEN
bunx wrangler secret put ALERT_BOT_TOKEN   # opcional
bunx wrangler secret put ALERT_CHAT_ID     # opcional
bunx wrangler deploy

cd .. && VITE_API_BASE=https://sinluz-api.<subdominio>.workers.dev bun run build
cd web && bunx wrangler pages deploy dist --project-name sinluz
```

Secretos: `INGEST_TOKEN`, `ADMIN_TOKEN`, `ALERT_BOT_TOKEN` + `ALERT_CHAT_ID`
(monitor), `LLM_API_KEY` (opcional).

Cron (`wrangler.toml`): `*/5 * * * *`. Una sola petición por ejecución, timeout
de 20 s, backoff 5 → 10 → 20 → 40 min persistido en `settings`.

---

## 12. Límites y coste

| Recurso | Uso estimado | Límite gratis |
|---|---|---|
| Worker requests | ~300/día | 100 000/día |
| Cron | 288/día | incluido |
| D1 writes | ~300/día | 100 000/día |
| D1 rows read | caché de borde, ~2/min | 5 M/día |
| Pages | estático | ilimitado |

**Coste: 0 €.** Único riesgo: abusar del bridge de terceros (15 rpm). Se cumple
con 0,2 rpm desde un solo consumidor.

---

## 13. Riesgos

| Riesgo | Mitigación |
|---|---|
| Bus factor 1 del bridge; sesión MTProto baneable | 1 req/5 min, backoff 5→40 min, copia propia en D1, ingreso manual, `infra/telegram-bridge` listo para autoalojar |
| El bridge bloquea a quien falla | ante **cualquier** error, cuarentena automática y ningún reintento agresivo |
| `top_n` confundido con `snapshot` | guarda dura + 3 tests dedicados |
| Nombres inconsistentes | catálogo con alias + `unmatched.csv` visible |
| Silencio del canal | banner de frescura + `503` en `/api/health` + alerta a las 6 h |
| Falsa sensación de oficialidad | atribución y disclaimer permanentes en el pie |
| Alucinación del LLM | whitelist, Zod, umbral, desactivado por defecto |

---

## 14. Skills usadas al implementar

Instaladas con `bunx autoskills` (16 en total). Las que guiaron decisiones
concretas:

| Momento | Skill |
|---|---|
| Worker, D1, cron, bindings | `cloudflare`, `wrangler`, `workers-best-practices` |
| Rutas y middleware | `hono` |
| Esquemas y validación | `zod` |
| Tipo del corpus y de los scripts | `typescript-advanced-types` |
| Componentes y hooks | `react-best-practices`, `composition-patterns` |
| Build y PWA | `vite` |
| Tokens y escalas | `tailwind-css-patterns` |
| Revisión de accesibilidad y microcopy | `accessibility` |
| Título, descripción, `lang`, jerarquía | `seo` |
| Peso del bundle y arranque en 3G | `web-perf`, `frontend-design` |

Regla respetada: cargar la skill **antes** de escribir el componente.
