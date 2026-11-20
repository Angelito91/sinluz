import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Circle,
  CircleMarker,
  GeoJSON,
  MapContainer,
  Pane,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import type { PathOptions } from "leaflet";
import { Crosshair, Loader2 } from "lucide-react";
import "leaflet/dist/leaflet.css";
import type { AreaSummary } from "@sinluz/shared/areas";
import { AREA_COLOR, STATUS_COLOR, STATUS_LABEL, type Row } from "../lib/view";
import { elapsed } from "../lib/time";
import type { Locate } from "../hooks/useLocate";
import { useGeo, type Features } from "../hooks/useGeo";
import { useCircuitGeo, type CircuitGeo } from "../hooks/useCircuitGeo";

type Props = {
  areas: Map<string, AreaSummary>;
  /** Área seleccionada (municipio) o `null`. */
  area: string | null;
  onArea: (name: string | null) => void;
  /** Municipio en el que está el usuario, si se ha localizado. */
  here: string | null;
  locate: Locate;
  rows: Row[];
  selected: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
  now: number;
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

/** Relleno según el estado: la intensidad del rojo crece con la parte de circuitos afectados. */
function areaStyle(a: AreaSummary | undefined, selected: boolean, here: boolean): PathOptions {
  const tone = a?.tone ?? "ok";
  const fillOpacity = tone === "out" ? 0.18 + 0.36 * (a?.share ?? 0) : tone === "stale" ? 0.26 : 0.1;
  return {
    color: selected ? "#0b0d0f" : here ? "#2563eb" : "#ffffff",
    weight: selected || here ? 2.8 : 1.6,
    opacity: 0.95,
    fillColor: AREA_COLOR[tone],
    fillOpacity,
    lineJoin: "round",
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function labelHtml(name: string, a: AreaSummary | undefined): string {
  const sub = !a
    ? ""
    : a.out > 0
      ? `${a.out} de ${a.total} sin servicio`
      : a.stale > 0
        ? "sin confirmar"
        : "con servicio";
  return `<span class="area-name">${esc(name)}</span>${sub ? `<span class="area-sub">${sub}</span>` : ""}`;
}

const rank = (r: Row) => (r.status === "out" ? 3 : r.status === "stale" ? 2 : 1);

export default function MapView({
  areas,
  area,
  onArea,
  here,
  locate,
  rows,
  selected,
  onSelect,
  onClear,
  now,
}: Props) {
  const geo = useGeo();
  const circuits = useCircuitGeo();
  const [zoom, setZoom] = useState(8);

  // react-leaflet no restilla al cambiar las props: cambiar la clave rehace la capa.
  const key = useMemo(
    () =>
      [...areas.values()].map((a) => `${a.name}:${a.out}/${a.stale}/${a.total}`).join("|") + `#${area}#${here}`,
    [areas, area, here],
  );

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
      style={{ background: "#e9edea" }}
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
        maxNativeZoom={19}
        keepBuffer={3}
        updateWhenIdle
        opacity={0.9}
        className="basemap-tiles"
      />

      {geo && (
        <GeoJSON
          key={key}
          data={geo}
          style={(f) => {
            const name = f?.properties?.name as string;
            return areaStyle(areas.get(name), name === area, name === here);
          }}
          onEachFeature={(f, layer) => {
            const name = (f.properties as { name: string }).name;
            const a = areas.get(name);
            layer.bindTooltip(labelHtml(name, a), {
              permanent: true,
              direction: "center",
              className: `area-label${a?.tone === "out" ? " is-out" : ""}${name === area ? " is-selected" : ""}`,
              opacity: 1,
            });
            layer.on("click", (e) => {
              L.DomEvent.stopPropagation(e);
              onArea(name === area ? null : name);
            });
          }}
        />
      )}

      <Pane name="circuits" style={{ zIndex: 450 }}>
        <CircuitGeometry rows={rows} selected={selected} onSelect={onSelect} zoom={zoom} now={now} circuits={circuits} />
      </Pane>

      <CircuitMarkers
        rows={rows}
        selected={selected}
        onSelect={onSelect}
        zoom={zoom}
        now={now}
        circuits={circuits}
      />

      {locate.position && (
        <>
          <CircleMarker
            center={[locate.position.lat, locate.position.lon]}
            radius={Math.min(48, Math.max(10, locate.position.accuracy / 60))}
            pathOptions={{ color: "#2563eb", weight: 1, fillColor: "#2563eb", fillOpacity: 0.1, interactive: false }}
          />
          <CircleMarker
            center={[locate.position.lat, locate.position.lon]}
            radius={6}
            pathOptions={{ color: "#ffffff", weight: 2.5, fillColor: "#2563eb", fillOpacity: 1, interactive: false }}
          />
        </>
      )}

      <MapState onZoom={setZoom} />
      <ClearOnTap onClear={onClear} />
      <FitView geo={geo} area={area} selected={selected} rows={rows} circuits={circuits} />
      <Controls locate={locate} />
      <Legend />
    </MapContainer>
  );
}

/** Líneas y zonas detalladas: solo para los circuitos que las tienen. */
function CircuitGeometry({
  rows,
  selected,
  onSelect,
  zoom,
  now,
  circuits,
}: {
  rows: Row[];
  selected: string | null;
  onSelect: (id: string) => void;
  zoom: number;
  now: number;
  circuits: CircuitGeo | null;
}) {
  const byId = useMemo(() => new Map(rows.map((r) => [r.circuit.id, r])), [rows]);
  if (!circuits) return null;

  const showZones = zoom >= 11;

  return (
    <>
      {[...circuits.routes.values()].flat().map((route, index) => {
        const row = byId.get(route.id);
        if (!row) return null;
        const active = selected === row.circuit.id;
        const color =
          row.status === "out"
            ? STATUS_COLOR.out
            : row.status === "stale"
              ? STATUS_COLOR.stale
              : active
                ? "#0b0d0f"
                : "#52645b";
        const opacity = active ? 0.95 : row.status === "out" ? 0.8 : row.status === "stale" ? 0.7 : 0.32;
        return route.lines.map((line, lineIndex) => (
          <Polyline
            key={`${route.id}-${route.part ?? index}-${lineIndex}`}
            positions={line.map(([lon, lat]) => [lat, lon])}
            pathOptions={{
              color,
              weight: active ? 4 : row.status === "out" ? 3 : 2,
              opacity,
              lineCap: "round",
              lineJoin: "round",
            }}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                onSelect(route.id);
              },
            }}
          >
            {active && (
              <Tooltip sticky className={`circuit-label is-${row.status}`} opacity={1}>
                <span className="circuit-label-name">{row.circuit.name}</span>
                <span className="circuit-label-meta">{statusText(row, now)}</span>
              </Tooltip>
            )}
          </Polyline>
        ));
      })}

      {showZones &&
        [...circuits.zones.values()].flat().map((zone, index) => {
          const row = byId.get(zone.id);
          if (!row) return null;
          const active = selected === row.circuit.id;
          return (
            <Polygon
              key={`${zone.id}-${zone.variant ?? "z"}-${zone.part ?? index}`}
              positions={[zone.ring.map(([lon, lat]) => [lat, lon] as [number, number])]}
              pathOptions={{
                color: active ? "#0b0d0f" : row.status === "out" ? STATUS_COLOR.out : "#52645b",
                weight: active ? 2 : 1,
                opacity: active ? 0.8 : 0.25,
                fillColor: STATUS_COLOR[row.status],
                fillOpacity: active ? 0.18 : row.status === "out" ? 0.1 : 0.035,
                dashArray: active ? undefined : "3 3",
              }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  onSelect(zone.id);
                },
              }}
            />
          );
        })}
    </>
  );
}

function statusText(row: Row, now: number): string {
  if (row.status === "out") return `sin servicio · ${elapsed(row.state.since, now)}`;
  if (row.status === "stale") return `sin confirmar · ${elapsed(row.state.since, now)}`;
  return STATUS_LABEL[row.status];
}

function CircuitMarkers({
  rows,
  selected,
  onSelect,
  zoom,
  now,
  circuits,
}: {
  rows: Row[];
  selected: string | null;
  onSelect: (id: string) => void;
  zoom: number;
  now: number;
  circuits: CircuitGeo | null;
}) {
  const outCount = rows.filter((r) => r.status === "out").length;
  const ordered = useMemo(() => [...rows].sort((a, b) => rank(a) - rank(b)), [rows]);

  return (
    <>
      {ordered.map((row) => {
        const ref = circuits?.references.get(row.circuit.id);
        const position: [number, number] = ref
          ? [ref.lat, ref.lon]
          : [row.circuit.anchor[0], row.circuit.anchor[1]];
        const active = selected === row.circuit.id;
        const isLine = row.circuit.kind === "linea";
        const visible = zoom >= 10 || active || row.status !== "ok";
        if (!visible) return null;

        const color = STATUS_COLOR[row.status];
        const permanent = active || (zoom >= 11 && row.status !== "ok" && outCount <= 10);

        return (
          <Fragment key={row.circuit.id}>
            {active && (
              <Circle
                center={position}
                radius={row.circuit.radius_m}
                pathOptions={{
                  color,
                  weight: 1,
                  opacity: 0.45,
                  fillColor: color,
                  fillOpacity: 0.06,
                  dashArray: "4 5",
                  interactive: false,
                }}
              />
            )}
            {(row.status === "out" || active) && (
              <CircleMarker
                center={position}
                radius={active ? 14 : 11}
                pathOptions={{
                  stroke: false,
                  fillColor: color,
                  fillOpacity: active ? 0.18 : 0.11,
                  interactive: false,
                  className: row.status === "out" ? "circuit-halo" : undefined,
                }}
              />
            )}
            <CircleMarker
              center={position}
              radius={active ? 7.5 : row.status === "out" ? 6 : row.status === "stale" ? 5 : 4}
              pathOptions={{
                color: active ? "#0b0d0f" : "#ffffff",
                weight: active ? 3 : 2,
                fillColor: color,
                fillOpacity: 1,
                dashArray: isLine ? "2.5 1.5" : undefined,
                className: `circuit-dot${active ? " is-active" : ""}${isLine ? " is-line" : ""}`,
              }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  onSelect(row.circuit.id);
                },
              }}
            >
              <Tooltip
                permanent={permanent}
                direction="top"
                offset={[0, -7]}
                opacity={1}
                className={`circuit-label is-${row.status}${active ? " is-active" : ""}`}
              >
                <span className="circuit-label-name">{row.circuit.name}</span>
                <span className="circuit-label-meta">{statusText(row, now)}</span>
              </Tooltip>
            </CircleMarker>
          </Fragment>
        );
      })}
    </>
  );
}

/** Zoom actual y clases de CSS para las etiquetas de municipio. */
function MapState({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const apply = () => {
      const zoom = map.getZoom();
      onZoom(zoom);
      map.getContainer().classList.toggle("zoom-far", zoom < 9);
      map.getContainer().classList.toggle("zoom-close", zoom >= 11);
    };
    apply();
    map.on("zoomend", apply);
    return () => void map.off("zoomend", apply);
  }, [map, onZoom]);
  return null;
}

/** Tocar fuera de cualquier área la deselecciona. */
function ClearOnTap({ onClear }: { onClear: () => void }) {
  useMapEvents({ click: onClear });
  return null;
}

/** Encuadra el circuito seleccionado; si no hay, el municipio; si no, la provincia. */
function FitView({
  geo,
  area,
  selected,
  rows,
  circuits,
}: {
  geo: Features | null;
  area: string | null;
  selected: string | null;
  rows: Row[];
  circuits: CircuitGeo | null;
}) {
  const map = useMap();
  const loaded = !!geo;

  const row = selected ? rows.find((r) => r.circuit.id === selected) : undefined;
  const ref = row ? circuits?.references.get(row.circuit.id) : undefined;
  const anchor: [number, number] | null = row
    ? ref
      ? [ref.lat, ref.lon]
      : [row.circuit.anchor[0], row.circuit.anchor[1]]
    : null;
  const anchorKey = anchor ? anchor.join(",") : "";

  useEffect(() => {
    if (anchor) {
      map.flyTo(anchor, Math.max(map.getZoom(), 12), { duration: 0.5 });
      return;
    }
    if (!geo) return;
    const feature = area ? geo.features.find((f) => f.properties.name === area) : null;
    if (feature) {
      map.flyToBounds(L.geoJSON(feature).getBounds(), { padding: [24, 24], duration: 0.5, maxZoom: 11 });
    } else {
      map.flyToBounds(PROVINCE, { padding: [8, 8], duration: 0.5 });
    }
    // solo cuando cambia la selección: no moverse en cada actualización de datos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, area, loaded, anchorKey]);
  return null;
}

/** Botón «¿dónde estoy?» y zoom discreto, abajo a la derecha. */
function Controls({ locate }: { locate: Locate }) {
  const map = useMap();
  const btn = "h-10 w-10 text-lg leading-none text-ink/70 active:bg-black/5";
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className="leaflet-bottom leaflet-right" onClick={stop} onDoubleClick={stop}>
      <div className="leaflet-control flex flex-col gap-2">
        <button
          aria-label="Mostrar dónde estoy"
          onClick={locate.request}
          disabled={locate.state === "loading"}
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/95 text-blue-600 shadow-sm active:bg-black/5 disabled:opacity-60"
        >
          {locate.state === "loading" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Crosshair className="h-5 w-5" />}
        </button>
        <div className="flex flex-col overflow-hidden rounded-lg bg-white/95 shadow-sm">
          <button aria-label="Acercar" className={btn} onClick={() => map.zoomIn()}>
            +
          </button>
          <button aria-label="Alejar" className={`${btn} border-t border-black/5`} onClick={() => map.zoomOut()}>
            −
          </button>
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const item = (color: string, text: string, line = false) => (
    <span className="flex items-center gap-1.5">
      <span
        className={`h-2.5 w-2.5 rounded-full ${line ? "border border-dashed" : ""}`}
        style={{ background: line ? "transparent" : color, borderColor: color }}
      />
      {text}
    </span>
  );
  return (
    <div className="leaflet-bottom leaflet-left" onClick={(e) => e.stopPropagation()}>
      <div className="leaflet-control map-legend flex flex-col gap-1 text-[10px] leading-none text-ink/70">
        {item(AREA_COLOR.out, "Sin servicio")}
        {item(AREA_COLOR.stale, "Sin confirmar")}
        {item(AREA_COLOR.ok, "Con servicio")}
        {item("#52645b", "Línea", true)}
        <span className="mt-0.5 border-t border-black/5 pt-1 text-[9px] leading-tight text-ink/45">
          Relleno: municipio · punto: circuito
          <br />
          Ubicación aproximada
          <br />©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-black/20 underline-offset-2"
          >
            OpenStreetMap
          </a>
        </span>
      </div>
    </div>
  );
}
