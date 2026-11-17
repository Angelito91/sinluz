import { useEffect, useState } from "react";
import { CircleMarker, GeoJSON, MapContainer, Tooltip, useMap } from "react-leaflet";
import type { PathOptions } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Row } from "../lib/view";
import { STATUS_COLOR } from "../lib/view";

type Props = {
  rows: Row[];
  selected: string | null;
  onSelect: (id: string) => void;
};

const PROVINCE: [number, number][] = [
  [19.85, -77.1],
  [20.6, -75.32],
];

/** Límites duros del paneo: un poco más amplios que la provincia. */
const BOUNDS: [number, number][] = [
  [19.5, -77.3],
  [20.75, -74.85],
];

/** Encuadra el circuito seleccionado sin mover el mapa en cada render. */
function Focus({ rows, selected }: { rows: Row[]; selected: string | null }) {
  const map = useMap();
  useEffect(() => {
    if (!selected) return;
    const row = rows.find((r) => r.circuit.id === selected);
    if (!row) return;
    map.flyTo(row.circuit.anchor, Math.max(map.getZoom(), 11), { duration: 0.6 });
  }, [selected, rows, map]);
  return null;
}

export default function MapView({ rows, selected, onSelect }: Props) {
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/municipios.geojson")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setGeo(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <MapContainer
      bounds={PROVINCE}
      boundsOptions={{ padding: [8, 8] }}
      minZoom={7}
      maxZoom={13}
      maxBounds={BOUNDS}
      maxBoundsViscosity={0.85}
      zoomControl={false}
      attributionControl={false}
      className="h-full w-full"
      style={{ background: "#f2f2ef" }}
    >
      {geo && (
        <GeoJSON
          data={geo}
          style={{
            color: "#cfcfc8",
            weight: 1,
            fillColor: "#ffffff",
            fillOpacity: 0.8,
          }}
        />
      )}

      {rows.map(({ circuit, state }) => {
        const color = STATUS_COLOR[state.status];
        const isSelected = selected === circuit.id;
        const options: PathOptions = {
          color: isSelected ? "#0b0d0f" : color,
          weight: isSelected ? 2 : 1,
          fillColor: color,
          fillOpacity: state.status === "out" ? 0.55 : state.status === "none_reported" ? 0.28 : 0.15,
          opacity: state.status === "unknown" ? 0.6 : 1,
        };

        return (
          <CircleMarker
            key={circuit.id}
            center={circuit.anchor}
            radius={isSelected ? 9 : state.status === "out" ? 7 : 5}
            pathOptions={options}
            eventHandlers={{ click: () => onSelect(circuit.id) }}
          >
            <Tooltip direction="top" offset={[0, -6]} opacity={0.95}>
              <span className="text-[11px] font-medium">{circuit.name}</span>
            </Tooltip>
          </CircleMarker>
        );
      })}

      <Focus rows={rows} selected={selected} />
      <Layers />
    </MapContainer>
  );
}

/** Control de zoom discreto, abajo a la derecha. */
function Layers() {
  const map = useMap();
  return (
    <div className="leaflet-bottom leaflet-right">
      <div className="leaflet-control flex flex-col overflow-hidden rounded-lg bg-white/90 shadow-sm">
        <button
          aria-label="Acercar"
          className="h-9 w-9 text-lg leading-none text-ink/70 active:bg-black/5"
          onClick={() => map.zoomIn()}
        >
          +
        </button>
        <button
          aria-label="Alejar"
          className="h-9 w-9 border-t border-black/5 text-lg leading-none text-ink/70 active:bg-black/5"
          onClick={() => map.zoomOut()}
        >
          −
        </button>
      </div>
    </div>
  );
}
