# SinLuz — Guía para quien analiza y normaliza los datos

Hola. Esta guía es para ti. No necesitas saber programar: necesitas leer
mensajes con atención, criterio y constancia. Tu trabajo decide si la app dice la
verdad o no.

Todo tu trabajo ocurre en **dos archivos CSV**. No hay panel, no hay base de
datos, no hay magia. Si algo se rompe, se arregla editando una fila.

---

## 1. Qué tienes que conseguir

La app es tan buena como el catálogo que la alimenta. Tu entrega tiene tres
partes:

1. **Mantener el catálogo de circuitos** (`circuits.csv`). Que cualquier forma en
   que el canal nombre un circuito se traduzca en un dato, sin ambigüedad.
2. **Validar las intenciones** (`messages_review.csv`). Revisar 100 mensajes y
   decir qué *hace* cada uno. Esto es lo que hoy falta.
3. **Cuidar la cobertura.** Que el informe siga diciendo 100 % de menciones
   identificadas. Si baja, hay un nombre nuevo en el canal.

Lo que **no** tienes que hacer: tocar el mapa, calcular coordenadas, escribir
código, decidir colores ni diseñar pantallas. Todo eso se deriva de tu CSV.

### De dónde vienes

El catálogo ya está construido con **293 mensajes reales** del canal y tiene
**48 circuitos** (14 líneas y 34 circuitos) en los 9 municipios de la provincia.
La cobertura actual es del **100 % por mensaje y 100 % por mención** (801 de 801).

Eso significa que tu trabajo no empieza de cero: empieza **etiquetando
intenciones** (apartado 7) y luego pasa a **mantenimiento** (apartado 6). La
primera sesión es la más larga; después son ajustes de 20 minutos cuando el canal
inventa una forma nueva de escribir un nombre.

---

## 2. Instalación (una sola vez, 20 minutos)

1. Instala **Bun** desde [bun.sh](https://bun.sh). Es un solo comando, está en la
   portada del sitio; copia el que corresponda a tu sistema y pégalo en la
   terminal. En Windows, usa la terminal que abre el propio instalador.
2. Instala **VS Code** desde [code.visualstudio.com](https://code.visualstudio.com).
3. En VS Code instala dos extensiones:
   - **Rainbow CSV** — colorea las columnas, hace que un CSV se pueda leer.
   - **Spanish Language Pack** — la interfaz en español.
4. Pide el repositorio y ejecuta:

```bash
git clone <url-del-repo> sinluz
cd sinluz
bun install
```

5. Comprueba que todo está en su sitio:

```bash
bun run data:check
```

Si termina con algo como:

```
OK · 48 circuitos (14 líneas, 34 circuitos) · 39 reubicados en espiral
```

ya está todo listo. Si da error, copia el mensaje completo y mándalo: casi
siempre es que Bun no está instalado o que el CSV se guardó con otra codificación.

> Abre el proyecto con `code .` desde la terminal. Así los comandos de la chuleta
> funcionan directamente y puedes editar los CSV con VS Code.

---

## 3. Los archivos con los que trabajas

Todos están en `worker/data/`.

| Archivo | Qué es | ¿Lo editas? |
|---|---|---|
| `circuits.csv` | El catálogo. Tu documento de trabajo principal. | **Sí, siempre** |
| `messages_review.csv` | Muestra de mensajes para etiquetar intenciones. | **Sí** (dos columnas) |
| `circuits.json` | Generado a partir del CSV. | **Nunca** |
| `unmatched.csv` | Menciones que no se pudieron identificar. | Solo lo lees |
| `report.md` | Informe de cobertura. | Solo lo lees |
| `municipios.geojson` | Límites de los municipios. | **Nunca** |

---

## 4. `circuits.csv`: las columnas

```csv
id,kind,name,municipio,aliases,radius_m,lat,lon,notes
sc-12,circuito,Circuito 12,Santiago de Cuba,Circuito 12|12|Cto 12,1400,,,
line-4395,linea,Línea 4395-Contramaestre,Contramaestre,Línea 4395 Contramaestre|4395|Línea 4395 SD 5175 Contramaestre,4500,,,SD 5175 es el seccionalizado asociado
```

| Columna | Regla | Ejemplo |
|---|---|---|
| `id` | Corto, único, inmutable. Prefijo del municipio/nombre + número. **Nunca lo cambies después.** | `sc-12`, `cta-02`, `line-5390` |
| `kind` | `circuito` (numerado, de ciudad) o `linea` (intermunicipal, con nombre) | `linea` |
| `name` | Nombre completo y legible. Es lo que verá el usuario. | `Línea 4395-Contramaestre` |
| `municipio` | Uno exacto de los 9 de la lista del apartado 5. | `Contramaestre` |
| `aliases` | **Todas** las formas en que el canal lo nombra, separadas por `\|`. Sin repetir el `name`. | `4395\|Línea 4395 Contramaestre` |
| `radius_m` | 800–8000. Radio aproximado del círculo en el mapa. | `4500` |
| `lat`, `lon` | **Opcional.** Déjalo vacío y el sistema lo sitúa en el centro del municipio. Solo rellénalo si conoces la zona exacta. | `20.02,-75.82` |
| `notes` | Dudas, excepciones, decisiones. Se lee en el informe y lo agradece quien venga después. | `Puede ser 4435, ver nota` |

**Cómo funcionan los alias de verdad**

El sistema busca cada alias dentro del texto del mensaje, tal cual, tras quitar
mayúsculas, tildes, emojis y la duración que el canal pone al final
(`➡️ 16 horas`). Gana el alias más largo. Por eso `Circuito 12` y `12` son dos
alias del mismo circuito: el mensaje puede decir cualquiera de los dos.

Consecuencia práctica: **un alias demasiado corto es peligroso**. `1` como alias
de un circuito hace que cualquier «1» del mensaje lo marque como afectado. Hoy
eso funciona porque en el canal los números sueltos son circuitos de la ciudad,
pero si algún día aparece un «1» que sea de otra cosa, hay que revisar.

**Reglas duras**

1. Un alias pertenece a **un solo** circuito. Si `data:check` avisa de duplicado,
   hay un conflicto real que solo tú puedes resolver.
2. Un alias debe ser **exactamente** como aparece en el mensaje. No inventes
   variantes que no hayas visto; un alias inventado es un falso positivo futuro.
3. No cambies un `id` nunca. Si un circuito estaba mal identificado, crea uno
   nuevo y marca el viejo en `notes`.
4. No pongas dos circuitos con el mismo `name`.
5. Si dudas entre dos circuitos, **déjalo sin alias** y anótalo en `notes`. Un
   hueco es un hueco; un error es desinformación.

---

## 5. Los 9 municipios (lista cerrada)

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

## 6. Tu ciclo de mantenimiento

Repite esto cuando el canal publique algo que la app no entiende:
`bun run data:report` te lo dirá antes que nadie.

```
bun run data:report     → mira report.md y unmatched.csv
                        → decide: ¿alias nuevo? ¿circuito nuevo?
                        → edita circuits.csv
bun run data:check      → valida que no rompiste nada
bun run data:report     → confirma que la cobertura volvió al 100 %
```

**Qué te dice cada salida**

- `report.md` → `Cobertura por mención: 100.0% (801/801)`. Ese número es tu
  objetivo. Si baja, la lista de tokens sin identificar te dice hoc.
- `unmatched.csv` → tokens tal cual aparecen, con `veces` (frecuencia) y
  `mensaje_ejemplo` (el id del mensaje, que puedes buscar en el corpus).
- Errores de `data:check` → alias duplicado, municipio inválido, radio fuera de
  rango, `id` repetido. Te dice **fila y columna**.

**Prioriza por frecuencia.** Un token que aparece 40 veces vale mucho más que
diez que aparecen una vez.

**Cuidado con los casos que ya resuelve el sistema**

| Caso real en el canal | Qué hace el sistema | Tu decisión |
|---|---|---|
| `Línea 4395Contramaestre(5175)` | separa números de letras y quita paréntesis → `line-4395` | ninguno; `(5175)` es el seccionalizado |
| `4395` y `4435` | son **líneas distintas** | no las unas nunca |
| `ll Frente` / `II Frente` | `ll` en minúscula se lee como `II` | ninguno |
| `Baire-lll Frente` | `lll` → `III` Frente | ninguno |
| `LI 5395-San Luis` | `LI` se expande a `Línea` | añade `LI …` como alias si aparece otra variante |
| `1 y 2 de Contramaestre` | se expande a dos circuitos | ninguno |
| `Circuito 1 y 2 Contramaestre` | ídem | ninguno |
| `7 seccionalizado (SD 3030)` | el `SD 3030` no forma parte del nombre | ninguno |
| `Songo` | es el ramal de Songo, circuito propio | si algún día aparece como municipio, avísame |
| `Circuito 1`, `12`, `24` | numerados de la ciudad: `sc-01`, `sc-12`, `sc-24` | ninguno |
| `Línea 5385-Palma` / `Línea 5385 San Luis` | el canal las nombra indistintamente → un solo circuito | ya está anotado en `notes` |

**Lo que el sistema nunca hará por ti:** adivinar. Si un nombre no coincide con
ningún alias, queda sin identificar y aparece en `unmatched.csv`. Eso es
deliberado: un falso positivo marcaría un circuito como afectado sin serlo.

---

## 7. Validar intenciones (`messages_review.csv`)

El sistema adivina qué *hace* cada mensaje. Si se equivoca, la app miente: puede
marcar como «sin afectación» un circuito que lleva horas sin luz. Tu trabajo aquí
es medir ese acierto y corregirlo.

**Cómo**

```bash
bun run data:review     # genera/actualiza 100 mensajes muestreados
                        # rellena SOLO dos columnas: correct_intent y correct_circuits
bun run data:score      # te dice el % de acierto del sistema
```

`data:review` **conserva** las etiquetas que ya hayas escrito. Puedes parar a
mitad, guardar y seguir mañana.

**Las seis etiquetas** (escríbelas exactamente así en `correct_intent`):

| Etiqueta | Cuándo | Ejemplo real |
|---|---|---|
| `snapshot` | Da la **lista completa** de afectados ahora mismo | «Se afecta el servicio eléctrico en los siguientes circuitos: 8, 9 seccionalizado» |
| `add` | **Añade** circuitos a lo que ya estaba afectado | «se incorporan a la afectación la línea 4435-Contramaestre y línea 5390-San Luis» |
| `restore` | **Quita** circuitos, vuelve el servicio | «Se restablece el servicio eléctrico a la siguiente Línea: LI 5395-San Luis» |
| `top_n` | Lista **parcial**, solo los peores | «Circuitos con mayor tiempo de afectación: …» |
| `metrics` | Solo cifras globales | «MW Afectados- 91 · MW Servidos- 40» |
| `info` | Avisos, teléfonos, recomendaciones, reiteraciones | «haga su reporte al Centro Telefónico 18888» |

**La distinción que más importa: `snapshot` vs `top_n`.**

- `snapshot` = «esta es la lista completa de los que están sin luz ahora».
- `top_n` = «estos son los que llevan más tiempo», una muestra, no el total.

Si etiquetas un `top_n` como `snapshot`, la app marcará como «sin afectación» a
circuitos que llevan horas a oscuras. **Ante la duda entre ambos: `top_n`.**

El caso trampa que ya está resuelto: «Actualización de los **circuitos que se
encuentran afectados** por déficit» **sin** la frase «se afecta el servicio» es
`top_n`. El canal usa esa fórmula para listas parciales. No la etiquetes como
`snapshot` aunque suene a lista completa.

En `correct_circuits` escribe los `id` del catálogo separados por `|`, o déjalo
vacío si el mensaje no menciona circuitos. La columna `circuitos_detectados` te
muestra lo que el sistema creyó ver; si coincide, déjala en blanco en lugar de
copiarla.

---

## 8. Reglas de oro

1. **Nunca inventes un dato.** Si no está en el mensaje, no existe.
2. **La duda se documenta, no se resuelve a la ligera.** Usa `notes`.
3. **Un alias, un circuito.** Sin excepciones.
4. **No interpretes de más.** La app solo puede decir «sin afectación
   reportada», nunca «hay luz».
5. **Si un mensaje te confunde a ti, confundirá al sistema.** Anótalo: esos son
   los que hay que revisar a mano.
6. **No edites los `.json`.** Se regeneran y perderías el trabajo.
7. **Guarda el CSV en UTF-8.** Excel en Windows a veces lo rompe: usa
   «Guardar como → CSV UTF-8». Si las tildes aparecen como `Ã¡`, se rompió.

---

## 9. Definición de terminado

Tu entrega está lista cuando:

- [ ] `bun run data:check` termina en **OK** sin errores.
- [ ] `report.md` muestra cobertura **≥ 95 %** por mención (hoy está en 100 %).
- [ ] `unmatched.csv` solo contiene ruido evidente.
- [ ] Los 100 mensajes de `messages_review.csv` tienen `correct_intent`.
- [ ] `bun run data:score` da **≥ 90 %** de intención correcta.
- [ ] Cada `notes` con una duda tiene una decisión escrita.
- [ ] Has hecho commit y push de tus CSV.

Tiempo estimado: **4–6 horas** repartidas en dos o tres sesiones. El etiquetado
de intenciones es la parte más pesada; el mantenimiento posterior son minutos.

---

## 10. Chuleta de comandos

```bash
bun install             # solo la primera vez, o cuando cambie package.json
bun run data:report     # informe de cobertura + tokens sin resolver
bun run data:check      # valida el CSV y regenera circuits.json
bun run data:review     # genera/actualiza la muestra a etiquetar
bun run data:score      # compara tus etiquetas con el sistema
bun run replay          # reconstruye el estado actual desde los mensajes
bun run test            # comprueba que no rompiste el parser
```

Si algo falla, copia el texto **completo** del error. No hace falta que lo
entiendas: el mensaje suele decir exactamente qué fila y qué columna están mal.

---

## 11. Dudas frecuentes

**¿Puedo añadir un circuito que no aparece en los mensajes?**
Sí, si sabes que existe. Con `aliases` vacío no se usará hasta que aparezca. No
estorba.

**¿Y si el canal escribe un nombre nuevo mañana?**
Aparecerá en `unmatched.csv`. Se añade como alias y listo. Por eso el ciclo se
repite.

**¿Qué hago si dos circuitos comparten alias?**
Es un conflicto real: el canal está siendo ambiguo. Decide cuál es el más
probable, asígnalo ahí y anota el otro en `notes`.

**¿Necesito coordenadas exactas?**
No. El centro del municipio es suficiente y la app declara la ubicación como
aproximada. No pierdas tiempo ahí.

**¿Puedo trabajar en Google Sheets?**
Sí: edita allí, descarga como CSV UTF-8 y sobrescribe el archivo. Comprueba que
las tildes y las comillas no se rompan, y que las columnas sigan en el mismo
orden.

**¿Qué pasa si me equivoco?**
Nada irreversible. Los CSV están en Git y cada cambio queda registrado. Se
corrige y se vuelve a ejecutar.

**¿Cómo sé que mi cambio mejoró algo?**
`bun run data:report` antes y después. La cobertura y la lista de tokens sin
identificar son la nota del examen.
