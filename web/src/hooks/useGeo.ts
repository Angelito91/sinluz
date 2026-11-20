import { useEffect, useState } from "react";

export type Features = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { name: string }>;

// Una sola descarga compartida por el mapa y el cálculo de «dónde estoy».
let pending: Promise<Features | null> | null = null;

function load(): Promise<Features | null> {
  pending ??= fetch("/municipios.geojson")
    .then((r) => (r.ok ? (r.json() as Promise<Features>) : null))
    .catch(() => null);
  return pending;
}

export function useGeo(): Features | null {
  const [geo, setGeo] = useState<Features | null>(null);
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
