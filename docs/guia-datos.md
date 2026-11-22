# SinLuz — Guía del catálogo

La app interpreta los avisos del canal con un modelo de Workers AI. Tú no
etiquetas mensajes ni escribes reglas: mantienes el **catálogo de circuitos**,
que es el vocabulario con el que el modelo puede hablar. Si un circuito no está
en el catálogo, no existe para la app.

Todo tu trabajo ocurre en **un archivo CSV**: `worker/data/circuits.csv`.

---

## 1. Qué tienes que conseguir

1. **Que cada circuito real esté en el catálogo** con un `id` estable.
2. **Que los alias cubran las formas en que el canal lo nombra**, sin ambigüedad.
3. **Que `bun run data:check` pase sin errores.**

El catálogo actual tiene **45 circuitos** (14 líneas y 31 circuitos) en los 9
municipios de la provincia, construido a partir de 293 mensajes reales.

Lo que **no** tienes que hacer: etiquetar intenciones, calcular coordenadas,
decidir colores ni tocar el prompt del modelo.

---

## 2. Instalación (una sola vez)

1. Instala **Bun** desde [bun.sh](https://bun.sh).
2. Instala **VS Code** desde [code.visualstudio.com](https://code.visualstudio.com).
3. En VS Code instala **Rainbow CSV** (colorea las columnas) y el **Spanish
   Language Pack**.
4. Clona el repositorio y prepara el proyecto:

```bash
git clone <url-del-repo> sinluz
cd sinluz
bun install
```

5. Comprueba que todo está en su sitio:

```bash
bun run data:check
```

Debe terminar con algo como:

```
OK · 45 circuitos (14 líneas) · 13 con trazado, 10 con referencia verificada, 15 aproximados, 7 en centroide · 3 en espiral
```

Si da error, copia el mensaje completo: casi siempre es una fila con un
municipio mal escrito, un `id` repetido o un alias duplicado.

---

## 3. `circuits.csv`: las columnas

```csv
id,kind,name,municipio,aliases,radius_m,lat,lon,notes
sc-12,circuito,Circuito 12,Santiago de Cuba,circuito 12|12|Cto 12,1400,,,
ct-4395-5175,linea,Linea 4395-5175,Contramaestre,Línea 4395 Contramaestre|4395|Línea 4395 SD 5175 Contramaestre,4500,,,SD 5175 es el seccionalizado asociado
```

| Columna | Regla | Ejemplo |
|---|---|---|
| `id` | Corto, único, inmutable. Prefijo del municipio/nombre + número. **Nunca lo cambies después.** | `sc-12`, `ct-contramaestre-01-02`, `gu-5335-5618` |
| `kind` | `circuito` (numerado, de ciudad) o `linea` (intermunicipal, con nombre) | `linea` |
| `name` | Nombre completo y legible. Es lo que verá el usuario. | `Línea 4395-Contramaestre` |
| `municipio` | Uno exacto de los 9 de la lista del apartado 4. | `Contramaestre` |
| `aliases` | Formas en que el canal lo nombra, separadas por `\|`. Sin repetir el `name`. | `4395\|Línea 4395 Contramaestre` |
| `radius_m` | 800–8000. Radio aproximado del círculo en el mapa. | `4500` |
| `lat`, `lon` | **Opcional.** Si los pones, mandan sobre todo lo demás. Vacío = se usa el trazado detallado, luego los puntos de elTOQUE y, si no hay nada, el centro del municipio. | `20.02,-75.82` |
| `notes` | Dudas, excepciones, decisiones. | `Puede ser 4435, ver nota` |

### Cómo usa el modelo los alias

El modelo recibe el catálogo como `id | nombre | municipio | alias` y los
mensajes nuevos. Los alias ya **no se buscan literalmente**: son contexto para
que el modelo reconozca cómo nombra el canal a cada circuito. Por eso:

- Un alias debe ser una forma **real** del mensaje, no una invención.
- Un alias demasiado corto (`1`, `12`) es peligroso: ayuda al modelo, pero
  también puede confundirlo si el mensaje habla de otra cosa.
- Si dos circuitos comparten alias, el modelo puede dudar y omitir el cambio.
  Es un conflicto real que solo tú puedes resolver.

### Reglas duras

1. Un alias pertenece a **un solo** circuito. Si `data:check` avisa de duplicado,
   hay un conflicto real.
2. No cambies un `id` nunca. Si un circuito estaba mal identificado, crea uno
   nuevo y marca el viejo en `notes`.
3. No pongas dos circuitos con el mismo `name`.
4. Si dudas entre dos circuitos, **déjalo sin alias** y anótalo en `notes`. Un
   hueco es un hueco; un error es desinformación.

---

## 4. Los 9 municipios (lista cerrada)

Cópialos exactamente así en la columna `municipio`:

```
Santiago de Cuba
Palma Soriano
Contramaestre
San Luis
Songo - La Maya
Guamá
Segundo Frente
Mella
Tercer Frente
```

Si un mensaje menciona otro sitio, es una localidad dentro de uno de estos:
anótalo en `notes`, no lo pongas como municipio. El mapa solo tiene estos nueve.

---

## 5. Ciclo de mantenimiento

Repite esto cuando el canal nombre un circuito que la app no reconoce:

```bash
bun run data:check     # valida el CSV y regenera circuits.json
bun run sync           # copia el catálogo a web/public
bun run test           # comprueba que no rompiste nada
```

Después, si quieres comprobar el resultado con mensajes reales:

```bash
bun run fixtures       # descarga mensajes recientes del canal
bun run eval:replay    # evalúa el corpus etiquetado sin credenciales
```

Los mensajes se guardan en `worker/test/fixtures/messages.json` como corpus de
referencia para revisar a mano cómo nombra el canal a los circuitos. La calidad
del estado se comprueba en la API y se corrige con el override.

**Qué te dice `data:check`:** alias duplicado, municipio inválido, radio fuera de
rango o `id` repetido, con **fila y columna**.

---

## 6. Casos que el modelo ya debería resolver

| Caso real en el canal | Qué espera el sistema | Tu decisión |
|---|---|---|
| `Línea 4395Contramaestre(5175)` | `ct-4395-5175`; `(5175)` es el seccionalizado | ninguno |
| `4395` y `4435` | son **líneas distintas** (`ct-4395-5175` y `ct-4435`) | no las unas nunca |
| `ll Frente` / `II Frente` | `iif-5390-4260` | ninguno |
| `Baire-lll Frente` | no está en el catálogo | si se repite, añade la línea III Frente con un id nuevo |
| `LI 5395-San Luis` | `sl-5395` | añade `LI …` si aparece otra variante |
| `1 y 2 de Contramaestre` | **un solo** id, `ct-contramaestre-01-02` | ninguno |
| `Circuito 1` / `12` / `24` | circuitos de Santiago (`sc-01`, `sc-12`, `sc-24`) | ninguno |
| `Circuito 9` / `9 seccionalizado` | `sc-09-si4074` / `sc-09-si4615` | ya está anotado en `notes` |
| `Circuito 7` / `7 seccionalizado` | `sc-07-sd3030`; `7 SD 4630` es `sc-07-si4630` | ninguno |
| `17 seccionalizado` / `11 seccionalizado` | `sc-17` / `sc-11` | ninguno |
| `Línea 5335 (5617)` | `gu-5335-5618`; el canal escribe 5617 | ya está anotado en `notes` |
| `San Juan` / `Songo` | `sc-5980-0015` / `sm-songo` | ninguno |
| `Línea 5385-Palma` / `Línea 5385 San Luis` | un solo circuito, `pa-5385` | ya está anotado en `notes` |

El modelo **no adivina**: si dos circuitos encajan y el mensaje no permite
decidir, omite el cambio. Si ves un error en producción, corrige con
`POST /api/v1/admin/override` (ver `docs/probar.md`) y, si se repite, ajusta el
catálogo.

---

## 7. Reglas de oro

1. **Nunca inventes un dato.** Si no está en el mensaje, no existe.
2. **La duda se documenta, no se resuelve a la ligera.** Usa `notes`.
3. **Un alias, un circuito.** Sin excepciones.
4. **No edites los `.json`.** Se regeneran y perderías el trabajo.
5. **Guarda el CSV en UTF-8.** Excel en Windows a veces lo rompe: usa
   «Guardar como → CSV UTF-8». Si las tildes aparecen como `Ã¡`, se rompió.

---

## 8. Definición de terminado

Tu entrega está lista cuando:

- [ ] `bun run data:check` termina en **OK** sin errores.
- [ ] `bun run test` pasa.
- [ ] Los circuitos nuevos tienen `name`, `municipio` y al menos un alias real.
- [ ] Cada `notes` con una duda tiene una decisión escrita.
- [ ] Has hecho commit y push de tu CSV.

---

## 9. Chuleta de comandos

```bash
bun install             # solo la primera vez
bun run data:check      # valida el CSV y regenera circuits.json
bun run sync            # copia los datos a web/public
bun run test            # tests del worker
bun run fixtures        # descarga mensajes recientes del canal
bun run eval:replay     # evaluación del corpus etiquetado
```

Si algo falla, copia el texto **completo** del error. El mensaje suele decir
exactamente qué fila y qué columna están mal.

---

## 10. Dudas frecuentes

**¿Puedo añadir un circuito que no aparece en los mensajes?**
Sí, si sabes que existe. Con `aliases` vacío el modelo no lo usará hasta que
aparezca una forma reconocible. No estorba.

**¿Y si el canal escribe un nombre nuevo mañana?**
Añádelo como alias del circuito correcto. Si no sabes a cuál pertenece, anótalo
en `notes` y espera a verlo en más mensajes.

**¿Qué hago si dos circuitos comparten alias?**
Es un conflicto real: el canal está siendo ambiguo. Decide cuál es el más
probable, asígnalo ahí y anota el otro en `notes`.

**¿Necesito coordenadas exactas?**
No. El centro del municipio es suficiente y la app declara la ubicación como
aproximada.

**¿Puedo trabajar en Google Sheets?**
Sí: edita allí, descarga como CSV UTF-8 y sobrescribe el archivo. Comprueba que
las tildes y las comillas no se rompan y que las columnas sigan en el mismo
orden.

**¿Qué pasa si me equivoco?**
Nada irreversible. Los CSV están en Git y cada cambio queda registrado. Se
corrige y se vuelve a ejecutar.
