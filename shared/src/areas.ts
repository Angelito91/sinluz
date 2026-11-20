/**
 * Áreas del mapa = municipios. Lógica pura, sin dependencias: la usa la PWA y se
 * prueba desde el worker.
 *
 * Los circuitos no tienen coordenadas reales, así que el mapa NO puede decir en
 * qué circuito estás; solo en qué municipio.
 */
import type { DisplayStatus } from "./status";

export type AreaSummary = {
  name: string;
  total: number;
  out: number;
  stale: number;
  /** Estado que resume el área: hay afectados, solo sin confirmar, o todo con servicio. */
  tone: DisplayStatus;
  /** Parte de los circuitos del área que están afectados (0–1). */
  share: number;
};

export function summarizeAreas(items: { municipio: string; status: DisplayStatus }[]): Map<string, AreaSummary> {
  const areas = new Map<string, AreaSummary>();
  for (const { municipio, status } of items) {
    const a = areas.get(municipio) ?? { name: municipio, total: 0, out: 0, stale: 0, tone: "ok", share: 0 };
    a.total++;
    if (status === "out") a.out++;
    if (status === "stale") a.stale++;
    areas.set(municipio, a);
  }
  for (const a of areas.values()) {
    a.tone = a.out > 0 ? "out" : a.stale > 0 ? "stale" : "ok";
    a.share = a.total ? a.out / a.total : 0;
  }
  return areas;
}

type Ring = number[][];
type Polygon = Ring[];
export type AreaFeature = {
  properties: { name: string };
  geometry: { type: "Polygon"; coordinates: Polygon } | { type: "MultiPolygon"; coordinates: Polygon[] };
};

/** Trazado de rayos sobre un anillo [lon, lat]. */
function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Dentro del contorno exterior y fuera de los huecos. */
const inPolygon = (lon: number, lat: number, poly: Polygon) =>
  poly.length > 0 && inRing(lon, lat, poly[0]) && !poly.slice(1).some((hole) => inRing(lon, lat, hole));

/**
 * Municipio que contiene el punto, o `null` si está fuera de la provincia.
 * Los límites están simplificados (~100 m): cerca de una frontera puede errar.
 */
export function areaAt(features: AreaFeature[], lat: number, lon: number): string | null {
  for (const f of features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    if (polys.some((p) => inPolygon(lon, lat, p))) return f.properties.name;
  }
  return null;
}
