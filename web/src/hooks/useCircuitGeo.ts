import { useEffect, useState } from "react";

type LngLat = [number, number];

export type CircuitReference = {
  lat: number;
  lon: number;
  confidence: string;
  source: string;
};

export type CircuitRoute = {
  id: string;
  part?: number;
  variant?: string;
  lines: LngLat[][];
};

export type CircuitZone = {
  id: string;
  part?: number;
  variant?: string;
  radius_m: number;
  ring: LngLat[];
};

export type CircuitGeo = {
  references: Map<string, CircuitReference>;
  routes: Map<string, CircuitRoute[]>;
  zones: Map<string, CircuitZone[]>;
};

type Props = {
  layer?: string;
  id?: string;
  confidence?: string;
  source?: string;
  radius_m?: number;
  part?: number;
  variant?: string;
};

type Collection = GeoJSON.FeatureCollection<
  GeoJSON.Point | GeoJSON.LineString | GeoJSON.MultiLineString | GeoJSON.Polygon,
  Props
>;

const toLngLat = (p: GeoJSON.Position): LngLat => [p[0]!, p[1]!];
const toLine = (line: GeoJSON.Position[]): LngLat[] => line.map(toLngLat);

// Una sola descarga compartida por el mapa y cualquier detalle de circuito.
let pending: Promise<CircuitGeo | null> | null = null;

function parse(data: Collection): CircuitGeo {
  const references = new Map<string, CircuitReference>();
  const routes = new Map<string, CircuitRoute[]>();
  const zones = new Map<string, CircuitZone[]>();

  for (const feature of data.features ?? []) {
    const p = feature.properties;
    if (!p?.id) continue;

    if (p.layer === "reference" && feature.geometry.type === "Point") {
      const [lon, lat] = toLngLat(feature.geometry.coordinates);
      references.set(p.id, {
        lat,
        lon,
        confidence: p.confidence ?? "approximate",
        source: p.source ?? "",
      });
      continue;
    }

    if (p.layer === "route") {
      const g = feature.geometry;
      const lines =
        g.type === "LineString"
          ? [toLine(g.coordinates)]
          : g.type === "MultiLineString"
            ? g.coordinates.map(toLine)
            : [];
      if (lines.length === 0) continue;
      const route: CircuitRoute = {
        id: p.id,
        lines,
        ...(p.part != null ? { part: p.part } : {}),
        ...(p.variant ? { variant: p.variant } : {}),
      };
      routes.set(p.id, [...(routes.get(p.id) ?? []), route]);
      continue;
    }

    if (p.layer === "zone" && feature.geometry.type === "Polygon") {
      const ring = feature.geometry.coordinates[0];
      if (!ring || ring.length < 4) continue;
      const zone: CircuitZone = {
        id: p.id,
        ring: toLine(ring),
        radius_m: p.radius_m ?? 300,
        ...(p.part != null ? { part: p.part } : {}),
        ...(p.variant ? { variant: p.variant } : {}),
      };
      zones.set(p.id, [...(zones.get(p.id) ?? []), zone]);
    }
  }

  return { references, routes, zones };
}

function load(): Promise<CircuitGeo | null> {
  pending ??= fetch("/circuits.geojson")
    .then((r) => (r.ok ? (r.json() as Promise<Collection>) : null))
    .then((d) => (d ? parse(d) : null))
    .catch(() => null);
  return pending;
}

export function useCircuitGeo(): CircuitGeo | null {
  const [geo, setGeo] = useState<CircuitGeo | null>(null);
  useEffect(() => {
    let alive = true;
    load().then((d) => {
      if (alive) setGeo(d);
      if (!d) pending = null; // permite reintentar
    });
    return () => {
      alive = false;
    };
  }, []);
  return geo;
}
