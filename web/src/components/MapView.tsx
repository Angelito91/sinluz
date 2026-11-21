import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
import { Crosshair, Loader2, X } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { STATUS_LABEL, type Row } from "../lib/view";
import { elapsed } from "../lib/time";
import type { Locate } from "../hooks/useLocate";
import { useGeo, type Features } from "../hooks/useGeo";
import { useCircuitGeo, type CircuitGeo, type CircuitReference } from "../hooks/useCircuitGeo";

type Props = {
  /** Área seleccionada (municipio) o `null`. */
  area: string | null;
  onArea: (name: string | null) => void;
  /** Municipio en el que está el usuario, si se ha localizado. */
  here: string | null;
  locate: Locate;
  rows: Row[];
  selected: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
  now: number;
  dark: boolean;
};

const PROVINCE: [number, number][] = [
  [19.85, -77.1],
  [20.6, -75.32],
];

/** Límites duros del paneo: solo la provincia. */
const BOUNDS: [number, number][] = [
  [19.82, -77.13],
  [20.62, -75.29],
];

const CONFIDENCE: Record<string, string> = {
  mapped: "detallada",
  reported: "verificada",
  approximate: "aproximada",
  centroid: "por municipio",
};

/** Municipios: solo contorno. El color se reserva para los circuitos. */
function areaStyle(selected: boolean, here: boolean, dark: boolean): PathOptions {
  const base = dark ? "#2a3138" : "#c8cec9";
  return {
    color: selected ? (dark ? "#e8edf2" : "#0b0d0f") : here ? "#4ea1ff" : base,
    weight: selected || here ? 1.8 : 0.8,
    opacity: selected || here ? 0.95 : dark ? 0.7 : 0.9,
    fillColor: dark ? "#e8edf2" : "#0b0d0f",
    fillOpacity: selected ? (dark ? 0.06 : 0.03) : 0,
    lineJoin: "round",
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function labelHtml(name: string): string {
  return `<span class="area-name">${esc(name)}</span>`;
}

const rank = (r: Row) => (r.status === "out" ? 3 : r.status === "stale" ? 2 : 1);

function mapDot(status: Row["status"], dark: boolean): string {
  if (status === "out") return dark ? "#f07171" : "#d64545";
  if (status === "stale") return dark ? "#e0a83a" : "#c98a1b";
  return dark ? "#8c9a92" : "#77837c";
}

export default function MapView({
  area,
  onArea,
  here,
  locate,
  rows,
  selected,
  onSelect,
  onDeselect,
  now,
  dark,
}: Props) {
  const geo = useGeo();
  const circuits = useCircuitGeo();
  const [zoom, setZoom] = useState(8);

  // react-leaflet no restilla al cambiar las props: cambiar la clave rehace la capa.
  // Solo depende de la selección de municipio y del tema, no del estado de los circuitos.
  const key = useMemo(() => `${area ?? ""}#${here ?? ""}#${dark ? "d" : "l"}`, [area, here, dark]);
  const selectedRow = selected ? rows.find((r) => r.circuit.id === selected) : undefined;
  const reference = selectedRow ? circuits?.references.get(selectedRow.circuit.id) : undefined;

  return (
    <div className="relative h-full w-full">
      <MapContainer
        bounds={PROVINCE}
        boundsOptions={{ padding: [8, 8] }}
        minZoom={7}
        maxZoom={18}
        maxBounds={BOUNDS}
        maxBoundsViscosity={0.85}
        zoomControl={false}
        attributionControl={false}
        className="h-full w-full"
        style={{ background: dark ? "#0f1317" : "#f4f5f2" }}
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
          maxNativeZoom={19}
          keepBuffer={3}
          updateWhenIdle
          opacity={0.85}
          className="basemap-tiles"
        />

        <ProvinceMask geo={geo} dark={dark} />

        {geo && (
          <GeoJSON
            key={key}
            data={geo}
            style={(f) => {
              const name = f?.properties?.name as string;
              return areaStyle(name === area, name === here, dark);
            }}
            onEachFeature={(f, layer) => {
              const name = (f.properties as { name: string }).name;
              layer.bindTooltip(labelHtml(name), {
                permanent: true,
                direction: "center",
                className: "area-label",
                opacity: 0.9,
              });
              layer.on("click", (e) => {
                L.DomEvent.stopPropagation(e);
                onArea(name === area ? null : name);
              });
            }}
          />
        )}

        <Pane name="circuits" style={{ zIndex: 450 }}>
          <CircuitGeometry rows={rows} selected={selected} zoom={zoom} circuits={circuits} dark={dark} />
        </Pane>

        <CircuitMarkers
          rows={rows}
          selected={selected}
          onSelect={onSelect}
          zoom={zoom}
          now={now}
          circuits={circuits}
          dark={dark}
        />

        {locate.position && (
          <>
            <Circle
              center={[locate.position.lat, locate.position.lon]}
              radius={Math.max(30, locate.position.accuracy)}
              pathOptions={{
                color: "#4ea1ff",
                weight: 1,
                fillColor: "#4ea1ff",
                fillOpacity: dark ? 0.1 : 0.07,
                interactive: false,
              }}
            />
            <CircleMarker
              center={[locate.position.lat, locate.position.lon]}
              radius={5}
              pathOptions={{
                color: dark ? "#0b0e11" : "#ffffff",
                weight: 2,
                fillColor: "#4ea1ff",
                fillOpacity: 1,
                interactive: false,
              }}
            />
          </>
        )}

        <MapState onZoom={setZoom} />
        <ClearOnTap onDeselect={onDeselect} />
        <FitView geo={geo} area={area} selected={selected} rows={rows} circuits={circuits} />
        <InvalidateOnResize />
        {!selectedRow && <Controls locate={locate} />}
        {!selectedRow && <MapFooter dark={dark} />}
      </MapContainer>

      {selectedRow && (
        <SelectedCard row={selectedRow} reference={reference} now={now} onClose={onDeselect} dark={dark} />
      )}
    </div>
  );
}

/** Oculta todo lo que queda fuera de los municipios de Santiago de Cuba. */
function ProvinceMask({ geo, dark }: { geo: Features | null; dark: boolean }) {
  const rings = useMemo(() => {
    if (!geo) return null;

    const holes: [number, number][][] = [];
    for (const feature of geo.features) {
      const { geometry } = feature;
      if (geometry.type === "Polygon") {
        holes.push(geometry.coordinates[0]!.map(([lon, lat]) => [lat, lon] as [number, number]));
      } else if (geometry.type === "MultiPolygon") {
        for (const polygon of geometry.coordinates) {
          holes.push(polygon[0]!.map(([lon, lat]) => [lat, lon] as [number, number]));
        }
      }
    }
    if (holes.length === 0) return null;

    const world: [number, number][] = [
      [-85, -180],
      [-85, 180],
      [85, 180],
      [85, -180],
    ];
    return [world, ...holes];
  }, [geo]);

  if (!rings) return null;

  return (
    <Pane name="province-mask" style={{ zIndex: 250 }}>
      <Polygon
        positions={rings}
        pathOptions={{
          stroke: false,
          fillColor: dark ? "#0b0e11" : "#f4f5f2",
          fillOpacity: 1,
          interactive: false,
        }}
      />
    </Pane>
  );
}

/** Solo el circuito seleccionado dibuja su recorrido y sus zonas. */
function CircuitGeometry({
  rows,
  selected,
  zoom,
  circuits,
  dark,
}: {
  rows: Row[];
  selected: string | null;
  zoom: number;
  circuits: CircuitGeo | null;
  dark: boolean;
}) {
  if (!circuits || !selected) return null;

  const row = rows.find((r) => r.circuit.id === selected);
  if (!row) return null;

  const routes = circuits.routes.get(selected) ?? [];
  const zones = circuits.zones.get(selected) ?? [];
  if (routes.length === 0 && zones.length === 0) return null;

  const color = mapDot(row.status, dark);
  const stop = (e: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(e);

  return (
    <>
      {zoom >= 11 &&
        routes.flatMap((route, index) =>
          route.lines.map((line, lineIndex) => (
            <Polyline
              key={`${route.id}-${route.part ?? index}-${lineIndex}`}
              positions={line.map(([lon, lat]) => [lat, lon])}
              pathOptions={{
                color,
                weight: 3,
                opacity: 0.9,
                lineCap: "round",
                lineJoin: "round",
              }}
              eventHandlers={{ click: stop }}
            />
          )),
        )}

      {zoom >= 12 &&
        zones.map((zone, index) => (
          <Polygon
            key={`${zone.id}-${zone.variant ?? "z"}-${zone.part ?? index}`}
            positions={[zone.ring.map(([lon, lat]) => [lat, lon] as [number, number])]}
            pathOptions={{
              color,
              weight: 1.2,
              opacity: 0.7,
              fillColor: color,
              fillOpacity: dark ? 0.1 : 0.07,
              dashArray: "4 4",
            }}
            eventHandlers={{ click: stop }}
          />
        ))}
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
  dark,
}: {
  rows: Row[];
  selected: string | null;
  onSelect: (id: string) => void;
  zoom: number;
  now: number;
  circuits: CircuitGeo | null;
  dark: boolean;
}) {
  const ordered = useMemo(() => [...rows].sort((a, b) => rank(a) - rank(b)), [rows]);
  const ring = dark ? "#0b0e11" : "#ffffff";
  const activeStroke = dark ? "#e8edf2" : "#0b0d0f";

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

        const color = mapDot(row.status, dark);
        const radius = active ? 6.5 : row.status === "out" ? 5.5 : row.status === "stale" ? 4.5 : 3.5;
        const uncertain = ref?.confidence === "centroid";

        return (
          <Fragment key={row.circuit.id}>
            {(row.status === "out" || active) && (
              <CircleMarker
                center={position}
                radius={active ? 10 : 8.5}
                pathOptions={{
                  color,
                  weight: 1.5,
                  opacity: 0.45,
                  fillColor: color,
                  fillOpacity: dark ? 0.1 : 0.06,
                  interactive: false,
                }}
              />
            )}
            <CircleMarker
              center={position}
              radius={18}
              pathOptions={{ opacity: 0, fillColor: "#0b0d0f", fillOpacity: 0.001, weight: 0, className: "circuit-hit" }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  onSelect(row.circuit.id);
                },
              }}
            >
              {!active && (
                <Tooltip direction="top" offset={[0, -12]} opacity={1} className="circuit-label">
                  <span className="circuit-label-name">{row.circuit.name}</span>
                </Tooltip>
              )}
            </CircleMarker>
            <CircleMarker
              center={position}
              radius={radius}
              pathOptions={{
                color: active ? activeStroke : ring,
                weight: active ? 2.5 : 1.5,
                fillColor: color,
                fillOpacity: uncertain ? 0 : 1,
                dashArray: isLine ? "2.5 1.5" : undefined,
                interactive: false,
                className: "circuit-dot",
              }}
            />
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
      map.getContainer().classList.toggle("zoom-close", zoom >= 12);
    };
    apply();
    map.on("zoomend", apply);
    return () => void map.off("zoomend", apply);
  }, [map, onZoom]);
  return null;
}

/** Tocar fuera de cualquier área cierra la tarjeta sin perder el encuadre. */
function ClearOnTap({ onDeselect }: { onDeselect: () => void }) {
  useMapEvents({ click: onDeselect });
  return null;
}

/** Recalcula el mapa cuando su contenedor cambia de tamaño (p. ej. al arrastrar el panel). */
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const target = map.getContainer().parentElement ?? map.getContainer();
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    });
    ro.observe(target);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [map]);
  return null;
}

/** Encuadra el circuito seleccionado; si no, el municipio; si no, la provincia. */
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
      map.flyTo(anchor, Math.max(map.getZoom(), 14), { duration: 0.5 });
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

/** Evita que los clics del control lleguen al mapa y muevan el encuadre. */
function useControlRef() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);
  return ref;
}

/** Botón «¿dónde estoy?», abajo a la derecha. */
function Controls({ locate }: { locate: Locate }) {
  const ref = useControlRef();

  return (
    <div ref={ref} className="leaflet-bottom leaflet-right">
      <div className="leaflet-control">
        <button
          aria-label="Mostrar dónde estoy"
          onClick={locate.request}
          disabled={locate.state === "loading"}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-surface/95 text-ink/70 shadow-sm ring-1 ring-line backdrop-blur active:bg-muted disabled:opacity-60"
        >
          {locate.state === "loading" ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Crosshair className="h-4.5 w-4.5" />}
        </button>
      </div>
    </div>
  );
}

/** Leyenda mínima + atribución. */
function MapFooter({ dark }: { dark: boolean }) {
  const ref = useControlRef();

  return (
    <div ref={ref} className="leaflet-bottom leaflet-left">
      <div className="leaflet-control map-footer">
        <span>
          <i style={{ background: mapDot("out", dark) }} /> Sin servicio
        </span>
        <span>
          <i style={{ background: mapDot("stale", dark) }} /> Sin confirmar
        </span>
        <span>
          <i className="is-ok" /> Con servicio
        </span>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap
        </a>
      </div>
    </div>
  );
}

function SelectedCard({
  row,
  reference,
  now,
  onClose,
  dark,
}: {
  row: Row;
  reference?: CircuitReference;
  now: number;
  onClose: () => void;
  dark: boolean;
}) {
  const color = mapDot(row.status, dark);
  const confidence = CONFIDENCE[reference?.confidence ?? ""] ?? "aproximada";
  const meta =
    row.status === "out"
      ? "text-out font-medium"
      : row.status === "stale"
        ? "text-stale font-medium"
        : "text-ink/55";

  return (
    <section
      aria-label={`Detalle de ${row.circuit.name}`}
      aria-live="polite"
      className="selected-card absolute inset-x-3 bottom-3 z-[1000] rounded-2xl border border-line bg-surface/97 p-3 shadow-[0_8px_30px_rgba(0,0,0,0.16)] backdrop-blur-md dark:shadow-[0_8px_30px_rgba(0,0,0,0.45)]"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: color, boxShadow: row.status === "out" ? `0 0 0 4px ${color}33` : undefined }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-ink/40">{row.circuit.municipio}</p>
          <p className="truncate text-[15px] font-semibold leading-tight">{row.circuit.name}</p>
          <p className={`mt-0.5 text-[12px] ${meta}`}>{statusText(row, now)}</p>
          <p className="mt-1 text-[10px] leading-snug text-ink/40">
            Ubicación {confidence} · no oficial ·{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-ink/20 underline-offset-2"
            >
              © OpenStreetMap
            </a>
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Cerrar detalle del circuito"
          className="rounded-full p-1.5 text-ink/40 transition hover:bg-muted hover:text-ink/70"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
