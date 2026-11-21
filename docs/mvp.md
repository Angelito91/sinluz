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
- Interpretación con Workers AI: el modelo lee estado actual + mensajes nuevos y devuelve los cambios, validados con Zod.
- Catálogo de **45 circuitos** (14 líneas y 31 circuitos) en 9 municipios, con alias y ubicación aproximada.
- Mapa con teselas de OpenStreetMap en gris, contornos de municipios y circuitos
  ubicados de forma aproximada + lista + buscador + favoritos.
- Tiempo sin luz al segundo, hora de La Habana.
- PWA instalable y funcional offline con aviso de antigüedad.
- Override manual por token para corregir errores.
- Monitor de frescura: `/api/health` responde `503` y avisa por Telegram si el canal lleva 6 h callado.

**No entra**

- Historial y gráficas.
- Notificaciones push.
- Otras provincias.
- Cuentas de usuario.
- Parser determinista o reglas como respaldo: el único intérprete es el LLM.

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
| Ingesta + estado | *nada* | `fetch` nativo + Workers AI + D1 | ~350 |
| Base de datos | **D1** (única) | Sobra para ~300 filas/día; evita KV como segundo binding | esquema SQL |
| Tests | **`bun test`** † | Cero dependencias extra, mismo runner en todo el repo | ~130 |
| UI | **React 19 + Vite 7** | Pedido y estándar | ~40 |
| Datos remotos | **SWR 2** | `refreshInterval` + caché + reintentos en 15 líneas | ~15 |
| Mapa | **Leaflet 1.9 + react-leaflet 5** | Teselas ráster (OpenStreetMap) + GeoJSON de municipios, circuitos y trazados | ~240 |
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
│   │   ├── index.ts             # Hono: rutas + handler scheduled
│   │   ├── ingest.ts            # lotes de 15, backoff, alertas
│   │   ├── llm.ts               # prompt, esquema JSON y llamada a Workers AI
│   │   ├── state.ts             # cambios validados → estado
│   │   ├── store.ts             # D1: snapshot, overrides, settings
│   │   └── catalog.ts           # catálogo + byId
│   ├── data/
│   │   ├── circuits.csv         # ← lo edita la analista
│   │   ├── circuits.json        # generado
│   │   ├── circuits.geojson     # generado: referencia, recorridos y zonas
│   │   ├── circuit-mapped.geojson # trazados detallados aportados (no oficiales)
│   │   ├── circuit-references.json # puntos colaborativos de elTOQUE
│   │   ├── municipios.geojson   # generado, 21 KB
│   │   └── municipios.centroids.json
│   ├── scripts/
│   │   ├── build-data.ts        # CSV → JSON + validación + ubicación aproximada
│   │   ├── build-geojson.ts     # geoBoundaries → GeoJSON simplificado
│   │   ├── fetch-fixtures.ts    # corpus real desde el bridge
│   │   └── lib/{csv,canonical,references}.ts
│   ├── test/
│   │   ├── fixtures/messages.json   # 293 mensajes reales de referencia
│   │   ├── llm.test.ts
│   │   ├── state.test.ts
│   │   ├── store.test.ts
│   │   ├── ingest.test.ts
│   │   └── areas.test.ts
│   ├── schema.sql
│   └── wrangler.toml
├── web/
│   ├── src/
│   │   ├── App.tsx              # pantalla única
│   │   ├── components/{MapView,CircuitList,StatusBanner}.tsx
│   │   ├── hooks/{useStatus,useNow,useLocal,useGeo,useCircuitGeo,useLocate}.ts
│   │   └── lib/{api,time,view}.ts
│   └── public/{circuits.json,circuits.geojson,municipios.geojson,icon.svg}
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
-- Documento único que sirve la API (1 fila). Es todo el estado que se guarda.
CREATE TABLE state_snapshot (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  payload      TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);

-- Correcciones manuales. Se aplican al leer el estado.
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

**Sin historial** †: no se guardan mensajes crudos (`raw_messages`) ni decisiones
por mensaje (`llm_decisions`). El snapshot contiene solo los circuitos afectados
y el último id procesado. Los circuitos ausentes se sirven como `ok`. Es una
decisión explícita: la app está en desarrollo y se acepta perder datos antes que
mantener dos fuentes de verdad.

**Sin replay.** El estado avanza por lotes de mensajes nuevos; si el modelo falla,
no se guarda nada ni se mueve el cursor, y el cron reintenta. No hay forma de
reconstruir el pasado, y no hace falta.

**Todas las marcas de tiempo están en segundos unix** en el worker, la API y el
frontend, igual que Telegram. Un solo tipo de unidad en todo el proyecto evita
la clase de bug más común de este tipo de app.

---

## 6. Intérprete LLM

### 6.1 Contrato

Cada ejecución del cron pide los mensajes nuevos, los parte en lotes de 15 y
llama a Workers AI con tres cosas:

1. El **estado actual**: solo circuitos afectados (`id`, nombre, municipio,
   `desde`, `minutos_afectado`) y las cifras provinciales vigentes.
2. El **catálogo**: una línea por circuito con `id | nombre | municipio | alias`.
3. Los **mensajes nuevos**: `id`, fecha en La Habana y texto limpio.

El modelo debe devolver solo esto:

```json
{
  "cambios": [
    {
      "circuit_id": "sc-08",
      "status": "out",
      "source_message_id": 501,
      "duration_min": 980
    }
  ],
  "metrics": { "deficit_mw": 100, "served_mw": 40 }
}
```

- `status` solo admite `out` u `ok`; no existe `none`: un circuito sin cambio se
  omite.
- `duration_min` es un entero o `null`, y solo se usa con `out`.
- `metrics` es un objeto o `null`; `null` significa «no cambies las cifras».
- `source_message_id` debe ser un mensaje del lote, no de una ejecución anterior.

El prompt completo vive en `worker/src/llm.ts` (`SYSTEM`). El esquema JSON se
manda también como `response_format`, con `temperature: 0`.

### 6.2 Reglas de decisión

| El mensaje dice… | Cambio |
|---|---|
| «está afectado», «sin servicio», «disparado», «averiado» | `out` |
| «se incorpora / se suma a la afectación» | `out` |
| «Circuito con mayor tiempo de afectación» | `out` + `duration_min` si lo publica |
| «se restablece», «se encuentra con servicio» | `ok` |
| «MW afectados», «MW servidos» | solo `metrics` |
| teléfonos, publicidad, quejas, SEN, otra provincia | nada |

Guardas duras:

1. **Nada se deduce por omisión.** Las listas del canal son parciales: que un
   circuito no aparezca no lo restablece. Solo un `ok` explícito lo hace.
2. Si dos circuitos encajan y el mensaje no permite decidir, el modelo no debe
   devolver ninguno de los dos.
3. Un circuito que ya estaba afectado y solo se reitera puede omitirse; si el
   mensaje publica una duración nueva, vuelve como `out` con esa duración.
4. Solo se aceptan cifras provinciales plausibles (0–600 MW). El parte del SEN
   usa miles de MW y se descarta.

### 6.3 Desambiguación

El modelo usa el catálogo, el municipio y el contexto del mensaje. Las pistas que
el prompt le da:

- «Circuito N» sin municipio = Santiago de Cuba (`sc-NN`).
- «Circuito N de Palma» / «de Contramaestre» = `pal-NN` / `cta-NN`.
- Un encabezado de municipio («Santiago:», «Palma:») aplica a los números que
  aparecen debajo.
- En las líneas, el número (4390, 5390, 5975…) es la identidad principal; el
  municipio que lo acompaña puede estar mal escrito.
- «ll Frente» = Línea II Frente; «lll Frente» = Línea III Frente.
- No se inventan ids: el servidor descarta cualquier id que no esté en el
  catálogo.

Los alias del catálogo siguen siendo útiles, pero ya no se buscan literalmente:
son contexto para el modelo. `canonicalAlias` se conserva solo para validar y
deduplicar `circuits.csv` al construirlo.

### 6.4 Validación en el servidor

El prompt ayuda, pero la garantía es del servidor. Después de Zod se comprueba:

- `circuit_id` existe en el catálogo (`catalogIds`).
- `source_message_id` pertenece al lote procesado.
- `duration_min` fuera de 0–10 080 minutos (7 días) se trata como `null`; el
  cambio de estado se conserva.
- Un solo cambio por circuito; si aparece en varios mensajes, gana el más
  reciente.
- `deficit_mw` y `served_mw` están entre 0 y 600.

El servidor calcula `since` con esta prioridad: duración publicada → inicio
anterior → fecha del mensaje fuente. El modelo nunca hace aritmética de fechas.

### 6.5 Lotes, fallos y cursor

- Lotes de **15 mensajes**, máximo **4 lotes** por ejecución; hasta 4 páginas
  (120 mensajes) para arrancar o tras una caída larga.
- Si el modelo falla, devuelve algo inválido o se agota el tiempo: **no se guarda
  el snapshot y no avanza `last_message_id`**. El cron de 5 min reintenta.
- Cuando no hay mensajes nuevos, solo se actualiza `generated_at` para que
  `/api/health` sepa que la lectura funcionó.

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

Las correcciones manuales viven en su propia tabla y se aplican **al leer** el
estado, no dentro del snapshot. Así una ingesta no las borra y quitarlas devuelve
exactamente lo que interpretó el modelo.

```http
Cache-Control: public, max-age=30, stale-while-revalidate=60, stale-if-error=86400
```

Con esa caché el origen recibe ~2 req/min aunque haya miles de usuarios.

Frescura en la UI: la ingesta por debajo de 30 min es normal; si el pipeline se
retrasa más de 30 min aparece un aviso, y a partir de 6 h el aviso es grave. Si
el canal lleva más de 6 h sin publicar también se avisa. Un circuito afectado
sin ninguna mención en 12 h pasa a «sin confirmar»; nunca se supone que volvió
la luz por silencio.

---

## 8. Pantalla única

```
┌──────────────────────────────┐
│  SinLuz · Santiago de Cuba   │  ← frescura del canal
├──────────────────────────────┤
│                              │
│         MAPA (46 %)          │  ← teselas + GeoJSON + puntos
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
- Ubicación de circuitos por capas: coordenada manual, trazado detallado, puntos
  colaborativos de elTOQUE o centroide municipal; los que no tienen ninguna
  referencia se reparten en espiral para que no se solapen.
- Estados visuales cubiertos: carga (skeleton), vacío, datos viejos, offline,
  error de red, sin coincidencias en la búsqueda.
- Accesibilidad: color **y** texto, contraste AA, `prefers-reduced-motion`
  respetado, `aria-current` / `aria-pressed` en los controles.

---

## 9. PWA

- Shell precacheado: HTML, JS, CSS, GeoJSON y catálogo (10 entradas, ~554 KiB).
- API: `NetworkFirst` con timeout de 3 s y caída a la última respuesta buena.
- Teselas: `CacheFirst` (30 días, 350 teselas) para que el mapa funcione sin
  conexión después de la primera visita. Proveedor: OpenStreetMap.
- Offline: banner «mostrando la última información guardada» y tiempos corriendo.
- Icono único SVG `any` + `maskable` (no hay PNGs; el manifest los declara por
  tipo, no por tamaño).

---

## 10. Fases

| Fase | Entregable | Estado |
|---|---|---|
| **F0** | Corpus real (293 mensajes, fusión de páginas) | ✅ |
| **F1** | `circuits.json` + `circuits.geojson` + `municipios.geojson` | ✅ 45 circuitos, 9 municipios, 76 features |
| **F2** | Intérprete LLM + `state` + tests | ✅ 47 pass, sin parser determinista |
| **F3** | Worker con D1, cron, API, override | ✅ probado en local con datos en vivo |
| **F4** | Mapa + hoja + lista + buscador | ✅ |
| **F5** | PWA + offline + frescura | ✅ build con service worker |
| **F6** | Deploy + monitor + README | ✅ en producción |
| **F7** | Evaluación del modelo con corpus etiquetado | ⏳ opcional |

Ruta crítica real: **F0 → F1 → F2**. El resto es mecánico.

---

## 11. Deploy

```bash
bun run data:check
bunx wrangler d1 create sinluz          # copia el id a worker/wrangler.toml
cd worker && bunx wrangler d1 execute sinluz --remote --file=schema.sql
# Si la base ya existía con el diseño anterior:
#   bunx wrangler d1 execute sinluz --remote --file=reset.sql
#   bunx wrangler d1 execute sinluz --remote --file=schema.sql
bunx wrangler secret put INGEST_TOKEN
bunx wrangler secret put ADMIN_TOKEN
bunx wrangler secret put ALERT_BOT_TOKEN   # opcional
bunx wrangler secret put ALERT_CHAT_ID     # opcional
bunx wrangler deploy

cd .. && VITE_API_BASE=https://sinluz-api.<subdominio>.workers.dev bun run build
cd web && bunx wrangler pages deploy dist --project-name sinluz
```

Secretos: `INGEST_TOKEN`, `ADMIN_TOKEN`, `ALERT_BOT_TOKEN` + `ALERT_CHAT_ID`
(monitor). Workers AI no necesita clave: es el binding `[ai]`.

Cron (`wrangler.toml`): `*/5 * * * *`. Una petición al bridge por ejecución,
timeout de 20 s, backoff 5 → 10 → 20 → 40 min persistido en `settings`. La
llamada al modelo va en lotes de 15 mensajes y un fallo no mueve el cursor.

---

## 12. Límites y coste

| Recurso | Uso estimado | Límite gratis |
|---|---|---|
| Worker requests | ~300/día | 100 000/día |
| Cron | 288/día | incluido |
| Workers AI | ~50–100 neuronas/día | 10 000/día |
| D1 writes | ~300/día | 100 000/día |
| D1 rows read | cron + caché de borde, pocas por minuto | 5 M/día |
| Pages | estático | ilimitado |

**Coste: 0 €.** Único riesgo: abusar del bridge de terceros (15 rpm). Se cumple
con 0,2 rpm desde un solo consumidor.

---

## 13. Riesgos

| Riesgo | Mitigación |
|---|---|
| Bus factor 1 del bridge; sesión MTProto baneable | 1 req/5 min, backoff 5→40 min, copia propia en D1, ingreso manual, `infra/telegram-bridge` listo para autoalojar |
| El bridge bloquea a quien falla | ante **cualquier** error, cuarentena automática y ningún reintento agresivo |
| `top_n` confundido con `snapshot` | el prompt trata toda lista como parcial; el servidor nunca restablece por omisión |
| Nombres inconsistentes | catálogo con alias como contexto + desambiguación por municipio y número de línea |
| Silencio del canal | banner de frescura + `503` en `/api/health` + alerta a las 6 h |
| Falsa sensación de oficialidad | atribución y disclaimer permanentes en el pie |
| Alucinación del LLM | ids del catálogo, mensajes del lote, Zod, rangos y descarte completo sin avanzar el cursor |

---

## 14. Mapa por áreas y circuitos

El mapa es deliberadamente mínimo: las teselas de OpenStreetMap van en gris y los
municipios solo dibujan su contorno. Una máscara oculta todo lo que queda fuera
de los municipios de la provincia, así que no se ven provincias vecinas ni el
resto del país. El color se reserva para el estado de los circuitos. El botón de
ubicación pide la posición al navegador, resuelve el municipio con un
punto-en-polígono (`shared/src/areas.ts`) y lo selecciona; la posición **nunca
sale del dispositivo**.

Encima se dibujan los circuitos. La ubicación sale, en este orden:

1. `lat`/`lon` escritos a mano en `circuits.csv`.
2. `circuit-mapped.geojson`: recorridos y zonas detalladas para 13 circuitos.
3. `circuit-references.json`: puntos colaborativos de
   [elTOQUE](https://circuitos.masvoces.net/), agrupados por cercanía y
   ponderados por verificaciones y votos.
4. Centroide del municipio (o centro urbano de Santiago), con espiral solo para
   los circuitos sin ninguna referencia.

Reglas de divulgación progresiva:

- Hasta zoom 9 solo se ven los circuitos afectados o sin confirmar.
- A partir de zoom 10 aparecen todos los puntos; los de ubicación por centroide
  se dibujan huecos para no sugerir precisión.
- A partir de zoom 11 se dibuja el recorrido del circuito seleccionado y a partir
  de 12 sus zonas. Nunca se muestran todas las geometrías a la vez.
- Al tocar un punto se abre una tarjeta con nombre, estado, antigüedad, municipio
  y confianza de la ubicación. Al tocar el mapa se cierra sin perder el encuadre.
- La leyenda y la atribución caben en una sola fila; el detalle legal está en
  «Fuentes y límites», plegado por defecto.

Límite: **nada de esto es el área de servicio oficial ni un trazado exacto**.
La app dice en qué municipio estás, no qué circuito te alimenta. Eso lo elige el
usuario en la lista (y lo guarda como favorito). Las capas detalladas son un
aporte de colaboradores y los puntos de elTOQUE son reportes de usuarios.
