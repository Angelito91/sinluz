/**
 * circuits.csv → circuits.json
 *
 * Valida el catálogo, calcula la ubicación aproximada de cada circuito y
 * reparte en espiral los que comparten municipio para que no se solapen.
 *
 * Uso: bun run worker/scripts/build-data.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { readRecords } from "./lib/csv";
import { canonicalAlias } from "../src/normalize";

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
  geo_confidence: "approximate" | "centroid";
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

  circuits.push({
    id,
    kind: kind as Circuit["kind"],
    name,
    municipio,
    aliases,
    anchor: manual ? [lat, lon] : fallback,
    radius_m: Math.round(radius),
    geo_confidence: manual ? "approximate" : "centroid",
    ...(r.notes ? { notes: r.notes } : {}),
  });
}

if (errors.length) {
  console.error(`\n${errors.length} error(es) en circuits.csv:\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// Reparte en espiral los circuitos que comparten ancla (los 26 de la ciudad).
const groups = new Map<string, Circuit[]>();
for (const c of circuits) {
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

if (warnings.length) for (const w of warnings) console.warn(`  ! ${w}`);
console.log(
  `OK · ${out.length} circuitos (${out.filter((c) => c.kind === "linea").length} líneas, ` +
    `${out.filter((c) => c.kind === "circuito").length} circuitos) · ${spread} reubicados en espiral`,
);
