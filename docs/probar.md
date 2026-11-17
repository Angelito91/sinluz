# Probar SinLuz en producción

Ya está desplegado. Dos URL, dos piezas:

| Pieza | URL |
|---|---|
| **PWA** (lo que abre la gente) | <https://sinluz-988.pages.dev> |
| **API** (Worker + D1) | <https://sinluz-api.portuondoangel.workers.dev> |

La PWA llama a la API por HTTPS; no necesitas configurar nada.

---

## 1. Prueba rápida (2 minutos)

Abre <https://sinluz-988.pages.dev> en el móvil.

- [ ] Carga el mapa de la provincia y la lista de circuitos.
- [ ] El contador de tiempo avanza cada segundo.
- [ ] El buscador filtra por nombre.
- [ ] «Mi circuito» guarda tu selección al recargar.
- [ ] El pie dice la fuente y que la app no es oficial.

## 2. Comprueba que los datos son frescos

```bash
curl -sS https://sinluz-api.portuondoangel.workers.dev/api/health | python3 -m json.tool
```

Tiene que verse `"healthy": true` y `"age_min"` por debajo de 90.
El cron ingesta cada 5 minutos; si acabas de desplegar, espera a la siguiente
ejecución o fuerza una:

```bash
source worker/.secrets.local
curl -X POST -H "authorization: Bearer $INGEST_TOKEN" \
  https://sinluz-api.portuondoangel.workers.dev/api/v1/refresh
```

## 3. Corregir un circuito a mano

Por si el canal se equivoca o hay que marcar algo urgente. Los tokens están en
`worker/.secrets.local` (no se versiona).

```bash
source worker/.secrets.local

# marcar como afectado
curl -X POST -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"circuit_id":"sc-11","status":"out"}' \
  https://sinluz-api.portuondoangel.workers.dev/api/v1/admin/override

# ver correcciones activas
curl -H "authorization: Bearer $ADMIN_TOKEN" \
  https://sinluz-api.portuondoangel.workers.dev/api/v1/admin/overrides

# quitarla
curl -X DELETE -H "authorization: Bearer $ADMIN_TOKEN" \
  https://sinluz-api.portuondoangel.workers.dev/api/v1/admin/override/sc-11
```

Las correcciones sobreviven a las ingestas: se aplican al final de cada
reconstrucción.

## 4. Instalar como app (PWA)

- **Android/Chrome:** menú ⋮ → «Instalar aplicación».
- **iOS/Safari:** compartir → «Añadir a pantalla de inicio».

Después de la primera carga funciona sin conexión: muestra la última información
guardada y avisa de su antigüedad.

## 5. Qué mirar si algo falla

| Síntoma | Qué significa |
|---|---|
| La página no abre y otras webs sí | Tu red bloquea `*.pages.dev`; prueba otra red o un dominio propio. |
| Abre, pero la lista está vacía | La API no responde o sigue sin datos: mira `/api/health`. |
| `age_min` sube sin parar | El bridge o el canal están caídos; la app lo dice en el banner. |
| Un circuito sale mal | Usa el override (apartado 3) y anótalo. |

## 6. Actualizar la app

```bash
bun run deploy        # Worker + build + Pages
```

Antes de desplegar conviene pasar `bun test` y `bun run build`.
