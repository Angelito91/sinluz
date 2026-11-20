/**
 * circuits.csv → circuits.json + circuits.geojson
 *
 * Valida el catálogo y calcula la ubicación aproximada de cada circuito con
 * este orden de prioridad:
 *
 *  1. Coordenada manual en el CSV (la analista manda).
 *  2. Trazado o zonas de `circuit-mapped.geojson` (14 circuitos, detalle alto).
 *  3. Puntos colaborativos de `circuit-references.json` (elTOQUE).
 *  4. Centroide del municipio, repartido en espiral si varios circuitos caen
 *     exactamente en el mismo punto.
 *
 * Uso: bun run worker/scripts/build-data.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { readRecords } from "./lib/csv";
import { canonicalAlias } from "./lib/canonical";
import {
  distanceKm,
  mappedAnchor,
  parseMappedGeoJSON,
  pickRepresentative,
  type GeoConfidence,
  type MappedRoute,
  type MappedZone,
  type ReferenceFile,
  type ReferencePoint,
} from "./lib/references";
import { areaAt, type AreaFeature } from "../../shared/src/areas";

const DATA = new URL("../data/", import.meta.url);
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

/** Centro urbano de la ciudad; el centroide del municipio cae en zona rural. */
const TOWN_ANCHOR: Record<string, [number, number]> = {
  "Santiago de Cuba": [20.0217, -75.8297],
};

type Circuit = {
  id: string;
  kind: "circuito" | "linea";
  name: string;
  municipio: string;
  aliases: string[];
  anchor: [number, number];
  radius_m: number;
  geo_confidence: GeoConfidence;
  geo_source: string;
  notes?: string;
};

const errors: string[] = [];
const warnings: string[] = [];

const csv = await readFile(new URL("circuits.csv", DATA), "utf8");
const records = readRecords(csv);
if (records.length === 0) {
  console.error("circuits.csv está vacío o no tiene cabecera");
  process.exit(1);
}

const centroids = JSON.parse(
  await readFile(new URL("municipios.centroids.json", DATA), "utf8"),
) as Record<string, [number, number]>;

const geoRaw = JSON.parse(await readFile(new URL("municipios.geojson", DATA), "utf8")) as {
  features?: unknown[];
};
const areaFeatures = (geoRaw.features ?? []) as unknown as AreaFeature[];

let references: ReferenceFile = { source: "", circuits: {} };
try {
  references = JSON.parse(
    await readFile(new URL("circuit-references.json", DATA), "utf8"),
  ) as ReferenceFile;
} catch {
  warnings.push("sin circuit-references.json: los circuitos sin trazado quedan en el centroide");
}

let mapped = parseMappedGeoJSON(null);
try {
  mapped = parseMappedGeoJSON(
    JSON.parse(await readFile(new URL("circuit-mapped.geojson", DATA), "utf8")),
  );
} catch {
  warnings.push("sin circuit-mapped.geojson: no se usan trazados detallados");
}
warnings.push(...mapped.warnings);

const routesById = new Map<string, MappedRoute[]>();
for (const route of mapped.routes) {
  routesById.set(route.id, [...(routesById.get(route.id) ?? []), route]);
}
const zonesById = new Map<string, MappedZone[]>();
for (const zone of mapped.zones) {
  zonesById.set(zone.id, [...(zonesById.get(zone.id) ?? []), zone]);
}

/** Los puntos de un circuito deben caer en su municipio; los de una línea pueden cruzar. */
function usableReferences(
  id: string,
  kind: Circuit["kind"],
  municipio: string,
  fallback: [number, number],
): ReferencePoint[] {
  const points = references.circuits[id] ?? [];
  if (points.length === 0) return [];

  const inside = points.filter((p) => areaAt(areaFeatures, p.lat, p.lon) === municipio);
  if (inside.length > 0) return inside;

  const center = { lat: fallback[0], lon: fallback[1] };
  const radius = kind === "linea" ? 40 : 20;
  return points.filter((p) => distanceKm(p, center) <= radius);
}

const ids = new Set<string>();
const names = new Set<string>();
const aliasOwner = new Map<string, string>();
const circuits: Circuit[] = [];

for (const [i, r] of records.entries()) {
  const row = i + 2; // 1-based + cabecera
  const id = r.id?.trim();
  const name = r.name?.trim();
  const municipio = r.municipio?.trim();
  const kind = r.kind?.trim();

  if (!id || !/^[a-z0-9-]{2,}$/.test(id)) {
    errors.push(`fila ${row}: id inválido "${id ?? ""}" (minúsculas, números y guiones)`);
    continue;
  }
  if (ids.has(id)) errors.push(`fila ${row}: id repetido "${id}"`);
  ids.add(id);

  if (!name) errors.push(`fila ${row}: falta name`);
  else if (names.has(name)) errors.push(`fila ${row}: name repetido "${name}"`);
  else names.add(name);

  if (!MUNICIPIOS.includes(municipio as (typeof MUNICIPIOS)[number])) {
    errors.push(`fila ${row}: municipio inválido "${municipio}" (usa uno de la lista)`);
  }
  if (kind !== "circuito" && kind !== "linea") {
    errors.push(`fila ${row}: kind debe ser "circuito" o "linea"`);
  }

  const radius = Number(r.radius_m);
  if (!Number.isFinite(radius) || radius < 800 || radius > 8000) {
    errors.push(`fila ${row}: radius_m fuera de rango 800–8000 ("${r.radius_m}")`);
  }

  const aliases = (r.aliases ?? "")
    .split("|")
    .map((a) => a.trim())
    .filter(Boolean);

  for (const alias of aliases) {
    const key = canonicalAlias(alias);
    if (!key) continue;
    const owner = aliasOwner.get(key);
    if (owner && owner !== id) {
      errors.push(`fila ${row}: alias "${alias}" ya pertenece a ${owner}`);
    }
    aliasOwner.set(key, id);
  }

  const lat = r.lat ? Number(r.lat) : NaN;
  const lon = r.lon ? Number(r.lon) : NaN;
  const manual = Number.isFinite(lat) && Number.isFinite(lon);

  const fallback = TOWN_ANCHOR[municipio] ?? centroids[municipio];
  if (!fallback) {
    errors.push(`fila ${row}: sin coordenadas para "${municipio}"`);
    continue;
  }

  let anchor: [number, number] = fallback;
  let confidence: GeoConfidence = "centroid";
  let source = "centroide municipal";

  if (manual) {
    anchor = [lat, lon];
    confidence = "approximate";
    source = "coordenada manual";
  } else {
    const routes = routesById.get(id) ?? [];
    const zones = zonesById.get(id) ?? [];
    const mappedPoint = routes.length || zones.length ? mappedAnchor(routes, zones) : null;

    if (mappedPoint) {
      anchor = mappedPoint;
      confidence = "mapped";
      source = "trazado detallado";
    } else {
      const points = usableReferences(id, kind as Circuit["kind"], municipio, fallback);
      const representative = pickRepresentative(points, kind === "linea" ? "medoid" : "centroid");
      if (representative) {
        anchor = representative.anchor;
        confidence = representative.confidence;
        source = "elTOQUE";
      }
    }
  }

  circuits.push({
    id,
    kind: kind as Circuit["kind"],
    name,
    municipio,
    aliases,
    anchor,
    radius_m: Math.round(radius),
    geo_confidence: confidence,
    geo_source: source,
    ...(r.notes ? { notes: r.notes } : {}),
  });
}

if (errors.length) {
  console.error(`\n${errors.length} error(es) en circuits.csv:\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// Solo se reparten en espiral los que no tienen ninguna referencia real.
const groups = new Map<string, Circuit[]>();
for (const c of circuits) {
  if (c.geo_confidence !== "centroid") continue;
  const key = c.anchor.map((n) => n.toFixed(4)).join(",");
  groups.set(key, [...(groups.get(key) ?? []), c]);
}
let spread = 0;
for (const group of groups.values()) {
  if (group.length < 2) continue;
  group
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach((c, i) => {
      if (i === 0) return;
      const angle = i * 2.399963; // ángulo dorado
      const r = 0.0065 * Math.sqrt(i);
      c.anchor = [
        Math.round((c.anchor[0] + r * Math.sin(angle)) * 10_000) / 10_000,
        Math.round((c.anchor[1] + r * Math.cos(angle)) * 10_000) / 10_000,
      ];
      spread++;
    });
}

const out = circuits.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(new URL("circuits.json", DATA), JSON.stringify(out, null, 2));

type GeoFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};

const features: GeoFeature[] = out.map((c) => ({
  type: "Feature",
  properties: {
    layer: "reference",
    id: c.id,
    name: c.name,
    kind: c.kind,
    municipio: c.municipio,
    confidence: c.geo_confidence,
    source: c.geo_source,
    radius_m: c.radius_m,
  },
  geometry: { type: "Point", coordinates: [c.anchor[1], c.anchor[0]] },
}));

const byId = new Map(out.map((c) => [c.id, c]));
for (const route of mapped.routes) {
  const c = byId.get(route.id);
  if (!c) {
    warnings.push(`trazado para un circuito que no está en el catálogo: ${route.id}`);
    continue;
  }
  features.push({
    type: "Feature",
    properties: {
      layer: "route",
      id: c.id,
      name: c.name,
      kind: c.kind,
      municipio: c.municipio,
      ...(route.part ? { part: route.part } : {}),
      ...(route.variant ? { variant: route.variant } : {}),
      source: "trazado detallado",
    },
    geometry:
      route.lines.length === 1
        ? { type: "LineString", coordinates: route.lines[0] }
        : { type: "MultiLineString", coordinates: route.lines },
  });
}

for (const zone of mapped.zones) {
  const c = byId.get(zone.id);
  if (!c) {
    warnings.push(`zona para un circuito que no está en el catálogo: ${zone.id}`);
    continue;
  }
  features.push({
    type: "Feature",
    properties: {
      layer: "zone",
      id: c.id,
      name: c.name,
      kind: c.kind,
      municipio: c.municipio,
      ...(zone.part ? { part: zone.part } : {}),
      ...(zone.variant ? { variant: zone.variant } : {}),
      radius_m: zone.radius_m,
      source: "trazado detallado",
    },
    geometry: { type: "Polygon", coordinates: [zone.ring] },
  });
}

const geojson = {
  type: "FeatureCollection",
  metadata: {
    generated: new Date().toISOString(),
    note: "Punto de referencia, recorrido y zonas aproximadas. No es el área de servicio oficial.",
    sources: [
      "Trazado detallado: circuit-mapped.geojson (aportado el 2026-11-19)",
      "Referencias: elTOQUE · Mapa de circuitos (https://circuitos.masvoces.net/)",
      "Límites: geoBoundaries (CC BY 4.0)",
    ],
  },
  features,
};
await writeFile(new URL("circuits.geojson", DATA), JSON.stringify(geojson));

if (warnings.length) for (const w of warnings) console.warn(`  ! ${w}`);
const count = (confidence: GeoConfidence) => out.filter((c) => c.geo_confidence === confidence).length;
console.log(
  `OK · ${out.length} circuitos (${out.filter((c) => c.kind === "linea").length} líneas) · ` +
    `${count("mapped")} con trazado, ${count("reported")} con referencia verificada, ` +
    `${count("approximate")} aproximados, ${count("centroid")} en centroide · ${spread} en espiral`,
);
console.log(`  geojson: ${features.length} features → ${new URL("circuits.geojson", DATA).pathname}`);
