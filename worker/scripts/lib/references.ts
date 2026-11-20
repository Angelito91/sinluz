/**
 * Ubicación aproximada de los circuitos.
 *
 * Dos fuentes, en orden de confianza:
 *  1. `circuit-mapped.geojson`: trazados y zonas detalladas aportados para 14
 *     circuitos. Es la mejor información disponible, pero tampoco es oficial.
 *  2. `circuit-references.json`: puntos colaborativos de elTOQUE
 *     (circuitos.masvoces.net). Se agrupan y se descartan los valores atípicos.
 *
 * Nada de esto es el área de servicio oficial. Solo sirve para poner el
 * circuito en el mapa y acercarse a su zona.
 */

export type GeoConfidence = "mapped" | "reported" | "approximate" | "centroid";

export type LngLat = [number, number];
export type LatLon = [number, number];

export type Point = { lat: number; lon: number };

export type ReferencePoint = Point & {
  reference?: string | null;
  municipality?: string | null;
  layer?: string | null;
  state?: string | null;
  votes?: number;
  point_id?: string | number;
};

export type ReferenceFile = {
  source: string;
  note?: string;
  circuits: Record<string, ReferencePoint[]>;
};

export type Representative = {
  anchor: LatLon;
  cluster: ReferencePoint[];
  confidence: "reported" | "approximate";
  count: number;
  verified: number;
  weight: number;
};

export type MappedRoute = {
  id: string;
  variant?: string;
  part?: number;
  lines: LngLat[][];
};

export type MappedZone = {
  id: string;
  variant?: string;
  part?: number;
  ring: LngLat[];
  center: LngLat;
  radius_m: number;
};

export type MappedData = {
  routes: MappedRoute[];
  zones: MappedZone[];
  warnings: string[];
};

const EARTH_RADIUS_KM = 6371;
const rad = Math.PI / 180;

export const round = (n: number, digits = 5) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Distancia geodésica en km. */
export function distanceKm(a: Point, b: Point): number {
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Peso de un reporte: los verificados mandan; los votos y lo oficial desempatan. */
export function pointWeight(p: ReferencePoint): number {
  let w = 1 + Math.max(0, p.votes ?? 0);
  if (p.state === "verificado") w *= 3;
  if (p.layer === "oficial") w *= 1.5;
  return w;
}

/**
 * Agrupa puntos por cercanía (BFS). Con `epsKm = 1.5` un circuito urbano queda
 * en una sola mancha y un reporte perdido en otro municipio se separa.
 */
export function clusterPoints<T extends Point>(points: T[], epsKm = 1.5): T[][] {
  const left = new Set(points.keys());
  const clusters: T[][] = [];

  for (const start of points.keys()) {
    if (!left.has(start)) continue;
    left.delete(start);

    const queue = [start];
    const cluster: T[] = [];
    while (queue.length) {
      const i = queue.pop()!;
      cluster.push(points[i]!);
      for (const j of [...left]) {
        if (distanceKm(points[i]!, points[j]!) <= epsKm) {
          left.delete(j);
          queue.push(j);
        }
      }
    }
    clusters.push(cluster);
  }

  return clusters;
}

/**
 * Elige el grupo con más peso. En modo `centroid` devuelve el centro ponderado
 * (circuitos, que cubren un área); en modo `medoid` devuelve un punto real del
 * grupo (líneas, donde un punto medio inventado puede caer fuera del trazado).
 */
export function pickRepresentative(
  points: ReferencePoint[],
  mode: "centroid" | "medoid" = "centroid",
): Representative | null {
  if (points.length === 0) return null;

  const groups = clusterPoints(points).map((cluster) => {
    const weight = cluster.reduce((sum, p) => sum + pointWeight(p), 0);
    const verified = cluster.filter((p) => p.state === "verificado").length;
    return { cluster, weight, verified };
  });

  groups.sort(
    (a, b) =>
      b.weight - a.weight ||
      b.verified - a.verified ||
      b.cluster.length - a.cluster.length ||
      b.cluster[0]!.lat - a.cluster[0]!.lat,
  );

  const best = groups[0]!;
  let anchor: LatLon;

  if (mode === "medoid") {
    let chosen = best.cluster[0]!;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const p of best.cluster) {
      const cost = best.cluster.reduce((sum, q) => sum + pointWeight(q) * distanceKm(p, q), 0);
      if (cost < bestCost) {
        bestCost = cost;
        chosen = p;
      }
    }
    anchor = [chosen.lat, chosen.lon];
  } else {
    anchor = [
      best.cluster.reduce((sum, p) => sum + p.lat * pointWeight(p), 0) / best.weight,
      best.cluster.reduce((sum, p) => sum + p.lon * pointWeight(p), 0) / best.weight,
    ];
  }

  return {
    anchor: [round(anchor[0]), round(anchor[1])],
    cluster: best.cluster,
    confidence: best.verified > 0 ? "reported" : "approximate",
    count: best.cluster.length,
    verified: best.verified,
    weight: round(best.weight, 2),
  };
}

/** Normaliza los ids del mapa detallado a los ids del catálogo. */
export function normalizeMappedId(raw: string): { id: string; variant?: string } | null {
  const value = raw.trim().toLowerCase();

  const seccionalizado = /^sc-(\d{1,2})-si(\d+)$/.exec(value);
  if (seccionalizado) {
    return { id: `sc-${seccionalizado[1]!.padStart(2, "0")}`, variant: `SI ${seccionalizado[2]}` };
  }

  const city = /^sc-(\d{1,2})$/.exec(value);
  if (city) return { id: `sc-${city[1]!.padStart(2, "0")}` };

  if (/^(pal|cta|line|slm|sf|tf)-[a-z0-9-]+$/.test(value)) return { id: value };

  return null;
}

type Geometry =
  | { type: "Point"; coordinates: LngLat }
  | { type: "LineString"; coordinates: LngLat[] }
  | { type: "MultiLineString"; coordinates: LngLat[][] }
  | { type: "Polygon"; coordinates: LngLat[][] }
  | { type: string; coordinates?: unknown };

type GeoFeature = {
  type: "Feature";
  properties?: Record<string, unknown>;
  geometry?: Geometry;
};

type FeatureCollection = { type: "FeatureCollection"; features?: GeoFeature[] };

const isCoord = (v: unknown): v is LngLat =>
  Array.isArray(v) &&
  v.length >= 2 &&
  typeof v[0] === "number" &&
  typeof v[1] === "number" &&
  Number.isFinite(v[0]) &&
  Number.isFinite(v[1]) &&
  Math.abs(v[0]) <= 180 &&
  Math.abs(v[1]) <= 90;

const toLine = (v: unknown): LngLat[] | null => {
  if (!Array.isArray(v) || !v.every(isCoord)) return null;
  return v.map(([lon, lat]) => [round(lon, 6), round(lat, 6)]);
};

const toLines = (v: unknown): LngLat[][] | null => {
  if (!Array.isArray(v)) return null;
  const lines = v.map(toLine);
  return lines.every((line): line is LngLat[] => !!line && line.length >= 2) ? lines : null;
};

const toRing = (v: unknown): LngLat[] | null => {
  const ring = toLine(v);
  if (!ring || ring.length < 4) return null;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return ring;
};

const ringCenter = (ring: LngLat[]): LngLat => {
  const open = ring.slice(0, -1);
  return [
    round(open.reduce((sum, p) => sum + p[0], 0) / open.length, 6),
    round(open.reduce((sum, p) => sum + p[1], 0) / open.length, 6),
  ];
};

/** Lee y normaliza `circuit-mapped.geojson`. No lanza: devuelve avisos. */
export function parseMappedGeoJSON(input: unknown): MappedData {
  const warnings: string[] = [];
  const routes: MappedRoute[] = [];
  const centers = new Map<string, LngLat>();
  const rawZones = new Map<string, Omit<MappedZone, "center"> & { ring: LngLat[] }>();

  const data = input as FeatureCollection;
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    return { routes, zones: [], warnings: ["circuit-mapped.geojson no es un FeatureCollection"] };
  }

  // Primera pasada: centros y recorridos.
  for (const feature of data.features) {
    const props = feature.properties ?? {};
    const raw = String(props.grupo ?? props.nombre ?? props.id ?? "");
    const normalized = normalizeMappedId(raw);
    if (!normalized) {
      warnings.push(`circuito desconocido en el mapa detallado: "${raw}"`);
      continue;
    }

    const { id, variant } = normalized;
    const part = Number.isFinite(Number(props.parte)) ? Number(props.parte) : undefined;
    const key = `${id}:${variant ?? ""}:${part ?? 0}`;
    const geometry = feature.geometry;

    if (props.tipo === "centro_zona" && geometry?.type === "Point" && isCoord(geometry.coordinates)) {
      centers.set(key, [round(geometry.coordinates[0], 6), round(geometry.coordinates[1], 6)]);
    }

    if (props.tipo === "recorrido" && geometry) {
      const lines =
        geometry.type === "LineString"
          ? toLines([geometry.coordinates])
          : geometry.type === "MultiLineString"
            ? toLines(geometry.coordinates)
            : null;
      if (lines) routes.push({ id, ...(variant ? { variant } : {}), ...(part ? { part } : {}), lines });
      else warnings.push(`${id}: recorrido con geometría inválida`);
    }

    if (props.tipo === "zona" && geometry?.type === "Polygon") {
      const ring = Array.isArray(geometry.coordinates) ? toRing(geometry.coordinates[0]) : null;
      if (!ring) {
        warnings.push(`${id}: zona con geometría inválida`);
        continue;
      }
      const radius = Number(props.radio_m);
      rawZones.set(key, {
        id,
        ...(variant ? { variant } : {}),
        ...(part ? { part } : {}),
        ring,
        radius_m: Number.isFinite(radius) && radius > 0 ? radius : 300,
      });
    }
  }

  // Segunda pasada: las zonas ya pueden usar el centro exacto.
  const zones = [...rawZones.entries()].map(([key, zone]) => ({
    ...zone,
    center: centers.get(key) ?? ringCenter(zone.ring),
  }));

  return { routes, zones, warnings };
}

/** Punto en el 50 % del recorrido de la línea más larga. */
export function routeAnchor(route: MappedRoute): LatLon | null {
  let best: LngLat[] | null = null;
  let bestLength = 0;

  for (const line of route.lines) {
    let length = 0;
    for (let i = 1; i < line.length; i++) {
      length += distanceKm(
        { lon: line[i - 1]![0], lat: line[i - 1]![1] },
        { lon: line[i]![0], lat: line[i]![1] },
      );
    }
    if (length > bestLength) {
      bestLength = length;
      best = line;
    }
  }

  if (!best || best.length === 0) return null;
  if (bestLength === 0) return [round(best[0]![1]), round(best[0]![0])];

  const target = bestLength / 2;
  let walked = 0;
  for (let i = 1; i < best.length; i++) {
    const a = best[i - 1]!;
    const b = best[i]!;
    const segment = distanceKm({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });
    if (walked + segment >= target) {
      const t = segment === 0 ? 0 : (target - walked) / segment;
      return [round(a[1] + (b[1] - a[1]) * t), round(a[0] + (b[0] - a[0]) * t)];
    }
    walked += segment;
  }

  const last = best[best.length - 1]!;
  return [round(last[1]), round(last[0])];
}

/** Punto de referencia de un circuito con trazado o zonas detalladas. */
export function mappedAnchor(routes: MappedRoute[], zones: MappedZone[]): LatLon | null {
  for (const route of routes) {
    const anchor = routeAnchor(route);
    if (anchor) return anchor;
  }
  if (zones.length === 0) return null;

  const total = zones.reduce((sum, z) => sum + z.radius_m ** 2, 0);
  if (total === 0) return [zones[0]!.center[1], zones[0]!.center[0]];
  return [
    round(zones.reduce((sum, z) => sum + z.center[1] * z.radius_m ** 2, 0) / total),
    round(zones.reduce((sum, z) => sum + z.center[0] * z.radius_m ** 2, 0) / total),
  ];
}
