import { readFile } from "node:fs/promises";

/**
 * Verificación de solo lectura del catálogo y de los artefactos publicados.
 * No genera ni modifica nada: sirve como puerta de calidad en CI.
 */

const ROOT = new URL("../", import.meta.url).pathname;
const read = (path: string) => readFile(`${ROOT}${path}`, "utf8");

type Circuit = {
  id: string;
  kind: string;
  name: string;
  municipio: string;
  anchor: [number, number];
  radius_m: number;
  geo_confidence: string;
};

type Feature = {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};

const LAT = [19.5, 20.75] as const;
const LON = [-77.3, -74.85] as const;
const CONFIDENCE = new Set(["mapped", "reported", "approximate", "centroid"]);
const LAYERS = new Set(["reference", "route", "zone"]);

const errors: string[] = [];
const fail = (message: string) => errors.push(message);
const inProvince = (lat: number, lon: number) =>
  Number.isFinite(lat) && Number.isFinite(lon) && lat >= LAT[0] && lat <= LAT[1] && lon >= LON[0] && lon <= LON[1];

const csv = await read("worker/data/circuits.csv");
const csvIds = csv
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => line.split(",")[0]?.trim())
  .filter(Boolean);

const catalog = JSON.parse(await read("worker/data/circuits.json")) as Circuit[];
const ids = new Set(catalog.map((c) => c.id));

if (csvIds.length !== new Set(csvIds).size) fail("circuits.csv contiene ids duplicados");
if (catalog.length !== csvIds.length) fail(`circuits.csv tiene ${csvIds.length} ids y circuits.json ${catalog.length}`);
for (const id of csvIds) if (!ids.has(id)) fail(`circuits.json no contiene ${id}`);
for (const id of ids) if (!csvIds.includes(id)) fail(`circuits.csv no contiene ${id}`);

for (const c of catalog) {
  if (!c.id?.trim()) fail("circuito sin id");
  if (!c.anchor || !inProvince(c.anchor[0], c.anchor[1])) fail(`${c.id}: ancla fuera de la provincia`);
  if (!(c.radius_m > 0)) fail(`${c.id}: radius_m inválido`);
  if (!CONFIDENCE.has(c.geo_confidence)) fail(`${c.id}: geo_confidence desconocida (${c.geo_confidence})`);
}

const geojson = JSON.parse(await read("worker/data/circuits.geojson")) as {
  features: Feature[];
  metadata: Record<string, unknown>;
};
const references = geojson.features.filter((f) => f.properties.layer === "reference");
const routes = geojson.features.filter((f) => f.properties.layer === "route");
const zones = geojson.features.filter((f) => f.properties.layer === "zone");

if (geojson.features.length === 0) fail("circuits.geojson está vacío");
if (references.length !== catalog.length) fail(`referencias ${references.length} != catálogo ${catalog.length}`);
for (const f of geojson.features) {
  const layer = f.properties.layer;
  const id = f.properties.id;
  if (!LAYERS.has(String(layer))) fail(`capa desconocida: ${String(layer)}`);
  if (typeof id !== "string" || !ids.has(id)) fail(`geometría huérfana: ${String(id)}`);
  if (f.geometry.type === "Point") {
    const [lon, lat] = f.geometry.coordinates as [number, number];
    if (!inProvince(lat, lon)) fail(`${String(id)}: punto fuera de la provincia`);
  }
}
if ("generated" in geojson.metadata) fail("metadata.generated debe ser fijo para que el build sea determinista");

const refs = JSON.parse(await read("worker/data/circuit-references.json")) as {
  circuits: Record<string, { lat: number; lon: number }[]>;
};
for (const [id, points] of Object.entries(refs.circuits)) {
  if (!ids.has(id)) fail(`circuit-references.json: id huérfano ${id}`);
  if (!Array.isArray(points) || points.length === 0) fail(`circuit-references.json: ${id} sin puntos`);
  for (const p of points) {
    if (!inProvince(p.lat, p.lon)) fail(`circuit-references.json: ${id} con punto fuera de la provincia`);
  }
}

const municipios = JSON.parse(await read("worker/data/municipios.geojson")) as { features: Feature[] };
if (municipios.features.length !== 9) fail(`municipios.geojson tiene ${municipios.features.length} municipios (esperados 9)`);

const copies = [
  "circuits.json",
  "circuits.geojson",
  "municipios.geojson",
] as const;
for (const name of copies) {
  const source = await read(`worker/data/${name}`);
  const published = await read(`web/public/${name}`);
  if (source !== published) fail(`web/public/${name} no está sincronizado con worker/data/${name}`);
}

const docs = await read("docs/circuitos.md");
if (!docs.includes(String(catalog.length))) fail(`docs/circuitos.md no documenta ${catalog.length} circuitos`);

if (errors.length > 0) {
  console.error(`✗ ${errors.length} problema(s):`);
  for (const error of errors) console.error(`  · ${error}`);
  process.exit(1);
}

console.log(
  `OK · ${catalog.length} circuitos · ${references.length} referencias · ${routes.length} rutas · ${zones.length} zonas · ${municipios.features.length} municipios`,
);
console.log("OK · web/public sincronizado · documentación coherente");
