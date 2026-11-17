/**
 * Construye el GeoJSON de los 9 municipios de Santiago de Cuba.
 *
 * Fuente: geoBoundaries ADM2 Cuba (CC BY 4.0), 168 municipios.
 * Filtra por nombre + bbox de la provincia, simplifica con Ramer–Douglas–Peucker
 * y redondea coordenadas a 4 decimales (~11 m) para mantener el archivo pequeño.
 *
 * Uso: bun run worker/scripts/build-geojson.ts
 */
const SOURCE =
  "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/CUB/ADM2/geoBoundaries-CUB-ADM2_simplified.geojson";

/** Municipios de la provincia, tal como deben escribirse en circuits.csv */
const MUNICIPIOS = [
  "Santiago de Cuba",
  "Palma Soriano",
  "Contramaestre",
  "San Luis",
  "Songo - La Maya",
  "Guamá",
  "Segundo Frente",
  "Mella",
  "Tercer Frente",
] as const;

/** bbox aproximado de la provincia: descarta homónimos de otras provincias */
const BBOX = { minLat: 19.6, maxLat: 20.6, minLon: -77.0, maxLon: -75.1 };

type Ring = number[][];
type Geo = { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };

type Feature = {
  type: "Feature";
  properties: { shapeName: string; shapeID?: string };
  geometry: Geo;
};

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** distancia perpendicular de p al segmento a-b (en grados, suficiente a esta escala) */
function segDist(p: number[], a: number[], b: number[]): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function rdp(points: number[][], tol: number): number[][] {
  if (points.length < 3) return points;
  let maxD = 0;
  let idx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = segDist(points[i], first, last);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= tol) return [first, last];
  const left = rdp(points.slice(0, idx + 1), tol);
  const right = rdp(points.slice(idx), tol);
  return [...left.slice(0, -1), ...right];
}

function simplifyRing(ring: Ring, tol: number): Ring {
  // anillo cerrado: simplificar el tramo abierto y volver a cerrar
  const open = ring.slice(0, -1);
  if (open.length < 4) return ring;
  const simplified = rdp(open, tol);
  const out = simplified.map(([lon, lat]) => [round(lon), round(lat)]);
  return [...out, out[0]];
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

function centroid(geometry: Geo): [number, number] {
  const rings: Ring[] =
    geometry.type === "Polygon"
      ? [geometry.coordinates[0] as Ring]
      : (geometry.coordinates as number[][][][]).map((p) => p[0]);
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      sx += lon;
      sy += lat;
      n++;
    }
  }
  return [round(sy / n), round(sx / n)];
}

const inBox = (lat: number, lon: number) =>
  lat >= BBOX.minLat && lat <= BBOX.maxLat && lon >= BBOX.minLon && lon <= BBOX.maxLon;

console.log("descargando geoBoundaries ADM2 Cuba…");
const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const all = (await res.json()) as { features: Feature[] };
console.log(`  ${all.features.length} municipios de Cuba`);

const wanted = new Map(MUNICIPIOS.map((m) => [norm(m), m]));
const features: unknown[] = [];
const centroids: Record<string, [number, number]> = {};

for (const f of all.features) {
  const key = norm(f.properties.shapeName);
  if (!wanted.has(key)) continue;
  const c = centroid(f.geometry);
  if (!inBox(c[0], c[1])) continue; // homónimos de otras provincias

  const geometry: Geo =
    f.geometry.type === "Polygon"
      ? {
          type: "Polygon",
          coordinates: (f.geometry.coordinates as number[][][]).map((r) => simplifyRing(r, 0.0015)),
        }
      : {
          type: "MultiPolygon",
          coordinates: (f.geometry.coordinates as number[][][][]).map((poly) =>
            poly.map((r) => simplifyRing(r, 0.0015)),
          ),
        };

  const name = wanted.get(key)!;
  features.push({
    type: "Feature",
    properties: { name },
    geometry,
  });
  centroids[name] = c;
}

const missing = MUNICIPIOS.filter((m) => !centroids[m]);
if (missing.length) throw new Error(`municipios no encontrados: ${missing.join(", ")}`);

const geo = {
  type: "FeatureCollection",
  attribution: "Límites: geoBoundaries (CC BY 4.0) · OpenStreetMap",
  features,
};

const outGeo = new URL("../data/municipios.geojson", import.meta.url).pathname;
const outCentroids = new URL("../data/municipios.centroids.json", import.meta.url).pathname;

await Bun.write(outGeo, JSON.stringify(geo));
await Bun.write(outCentroids, JSON.stringify(centroids, null, 2));

const bytes = (await Bun.file(outGeo).arrayBuffer()).byteLength;
console.log(`OK · ${features.length} municipios · ${(bytes / 1024).toFixed(1)} KB → ${outGeo}`);
for (const [name, c] of Object.entries(centroids)) console.log(`   ${name}: ${c[0]}, ${c[1]}`);
