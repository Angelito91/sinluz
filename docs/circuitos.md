# Circuitos y datos del mapa

Catálogo único de **45 circuitos** (31 circuitos y 14 líneas) en 9 municipios. La ubicación es **aproximada**: no son límites de servicio ni trazados oficiales.

## Origen de los datos

- **`circuits.csv`**: catálogo editable; es la fuente de ids, nombres, alias y municipio.
- **`circuit-mapped.geojson`**: trazados y zonas de 13 circuitos de Santiago, entregados en un archivo colaborativo.
- **`circuit-references.json`**: puntos colaborativos del mapa de circuitos de elTOQUE, con 320 reportes.
- **Centroides municipales**: respaldo para los circuitos sin referencia. Límites de geoBoundaries (CC BY 4.0). Base de mapa: OpenStreetMap.

Nada de esto es información oficial de la Empresa Eléctrica. Se usa solo para orientar el mapa.

## Cobertura

| Origen de la ubicación | Circuitos |
|---|---:|
| Trazado/zona detallada | 13 |
| Referencia verificada | 10 |
| Referencia aproximada | 15 |
| Solo centroide municipal | 7 |
| **Total** | **45** |

GeoJSON generado: 76 features = 45 puntos de referencia, 8 recorridos y 23 zonas.

Con trazado detallado: `sc-01`, `sc-02`, `sc-03`, `sc-08`, `sc-09-si4074`, `sc-09-si4615`, `sc-10`, `sc-11`, `sc-12`, `sc-13`, `sc-17`, `sc-21`, `sc-25`.

## Regenerar

`bun run data:check` valida el CSV y escribe `circuits.json` y `circuits.geojson`. `bun run sync` los copia a `web/public/`. Todo lo anterior se genera desde los archivos de `worker/data/`.

## Límites

- La app no determina qué circuito alimenta una dirección: solo resuelve el municipio.
- Los 7 circuitos en centroide no representan un área real.
- Las descripciones y puntos vienen de aportes colaborativos; pueden estar desactualizados.

## Catálogo

| Id | Nombre | Municipio | Confianza | Origen |
|---|---|---|---|---|
| `ct-4385` | Linea 4385 | Contramaestre | Referencia aproximada | elTOQUE |
| `ct-4390` | Linea 4390 | Contramaestre | Centroide municipal | centroide municipal |
| `ct-4395-5175` | Linea 4395-5175 | Contramaestre | Referencia aproximada | elTOQUE |
| `ct-4435` | Linea 4435 | Contramaestre | Referencia verificada | elTOQUE |
| `ct-contramaestre-01-02` | Circuito Contramaestre 1 y 2 | Contramaestre | Centroide municipal | centroide municipal |
| `ct-hospital-contramaestre` | Circuito Hospital Contramaestre | Contramaestre | Centroide municipal | centroide municipal |
| `gu-5335-5618` | Linea 5335-5618 | Guamá | Referencia aproximada | elTOQUE |
| `iif-5390-4260` | Linea 5390-4260 | Segundo Frente | Centroide municipal | centroide municipal |
| `pa-5385` | Linea 5385 | Palma Soriano | Centroide municipal | centroide municipal |
| `pa-palma-01` | Circuito Palma 1 | Palma Soriano | Referencia verificada | elTOQUE |
| `pa-palma-02` | Circuito Palma 2 | Palma Soriano | Referencia aproximada | elTOQUE |
| `pa-palma-04` | Circuito Palma 4 | Palma Soriano | Referencia aproximada | elTOQUE |
| `sc-01` | Circuito 1 | Santiago de Cuba | Trazado detallado | trazado detallado |
| `sc-02` | Circuito 2 | Santiago de Cuba | Trazado detallado | trazado detallado |
| `sc-03` | Circuito 3 | Santiago de Cuba | Trazado detallado | trazado detallado |
| `sc-07-sd3030` | Circuito 7-SD3030 | Santiago de Cuba | Referencia verificada | elTOQUE |
| `sc-07-si4630` | Circuito 7-SI4630 | Santiago de Cuba | Centroide municipal | centroide municipal |
| `sc-08` | Circuito 8 | Santiago de Cuba | Trazado detallado | trazado detallado |
| `sc-09-si4074` | Circuito 9-SI4074 | Santiago de Cuba | Trazado detallado | trazado detallado |
| `sc-09-si4615` | Circuito 9-SI4615 | Santiago de Cuba | Trazado detallado | trazado detallado |
| `sc-10` | Circuito 10 | Santiago de Cuba | Trazado detallado | trazado detallado |
| `sc-11` | Circuito 11 | Santiago de Cuba | Trazado detallado | trazado detallado |
| `sc-12` | Circuito 12 | Santiago de Cuba | Trazado detallado | trazado detallado |
| `sc-13` | Circuito 13 | Santiago de Cuba | Trazado detallado | trazado detallado |
| `sc-14-si3010` | Circuito 14-SI3010 | Santiago de Cuba | Referencia aproximada | elTOQUE |
| `sc-15` | Circuito 15 | Santiago de Cuba | Referencia aproximada | elTOQUE |
| `sc-16` | Circuito 16 | Santiago de Cuba | Referencia aproximada | elTOQUE |
| `sc-17` | Circuito 17 | Santiago de Cuba | Trazado detallado | trazado detallado |
| `sc-18` | Circuito 18 | Santiago de Cuba | Referencia verificada | elTOQUE |
| `sc-19` | Circuito 19 | Santiago de Cuba | Referencia verificada | elTOQUE |
| `sc-20` | Circuito 20 | Santiago de Cuba | Referencia verificada | elTOQUE |
| `sc-21` | Circuito 21 | Santiago de Cuba | Trazado detallado | trazado detallado |
| `sc-22` | Circuito 22 | Santiago de Cuba | Centroide municipal | centroide municipal |
| `sc-23` | Circuito 23 | Santiago de Cuba | Referencia aproximada | elTOQUE |
| `sc-24` | Circuito 24 | Santiago de Cuba | Referencia verificada | elTOQUE |
| `sc-25` | Circuito 25 | Santiago de Cuba | Trazado detallado | trazado detallado |
| `sc-26` | Circuito 26 | Santiago de Cuba | Referencia verificada | elTOQUE |
| `sc-5330` | Linea 5330 | Santiago de Cuba | Referencia aproximada | elTOQUE |
| `sc-5975` | Linea 5975 | Santiago de Cuba | Referencia verificada | elTOQUE |
| `sc-5980` | Linea 5980 | Santiago de Cuba | Referencia aproximada | elTOQUE |
| `sc-5980-0015` | Linea 5980-0015 San Juan-2016 | Santiago de Cuba | Referencia verificada | elTOQUE |
| `sl-5395` | Linea 5395 | San Luis | Referencia aproximada | elTOQUE |
| `slm-5380` | Linea 5380 | San Luis | Referencia aproximada | elTOQUE |
| `sm-5390-md8005` | Linea 5390-MD8005 | Songo - La Maya | Referencia aproximada | elTOQUE |
| `sm-songo` | Circuito Songo | Songo - La Maya | Referencia aproximada | elTOQUE |
