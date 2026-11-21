import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Clock, Info, Monitor, Moon, Radio, Sun, X } from "lucide-react";
import MapView from "./components/MapView";
import CircuitList from "./components/CircuitList";
import StatusBanner from "./components/StatusBanner";
import { useCatalog, useStatus } from "./hooks/useStatus";
import { useNow } from "./hooks/useNow";
import { useFavorites, useOnline } from "./hooks/useLocal";
import { useTheme } from "./hooks/useTheme";
import { ago, elapsed, hhmm } from "./lib/time";
import { buildRows, filterRows, sortRows, STATUS_COLOR, type Row } from "./lib/view";
import { areaAt, summarizeAreas, type AreaFeature } from "@sinluz/shared/areas";
import { useGeo } from "./hooks/useGeo";
import { useLocate, type Locate } from "./hooks/useLocate";

const SNAP_POINTS = [0.4, 0.68, 0.92];
const MIN_SHEET = 0.32;
const MAX_SHEET = 0.94;

function snapSheet(value: number): number {
  let best = SNAP_POINTS[0]!;
  let bestDist = Math.abs(value - best);
  for (const p of SNAP_POINTS) {
    const d = Math.abs(value - p);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

type Toast = { id: number; text: string; tone: "out" | "ok" | "info" };

export default function App() {
  const { status, error, isLoading, isValidating } = useStatus();
  const catalog = useCatalog();
  const now = useNow();
  const online = useOnline();
  const favorites = useFavorites();
  const theme = useTheme();
  const dark = theme.resolved === "dark";

  const [query, setQuery] = useState("");
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [sheetFrac, setSheetFrac] = useState(0.4);
  const [dragging, setDragging] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ y: number; frac: number; moved: boolean } | null>(null);
  const prevStatusRef = useRef<Map<string, string> | null>(null);
  const toastId = useRef(0);
  const initialCircuitRef = useRef<string | null>(new URLSearchParams(location.search).get("c"));
  const geo = useGeo();
  const locate = useLocate();

  // «sin confirmar» depende de la hora: se recalcula cada minuto, no cada segundo.
  const minute = Math.floor(now / 60);
  const rows = useMemo(
    () => sortRows(buildRows(catalog ?? [], status, minute * 60)),
    [catalog, status, minute],
  );
  const visible = useMemo(
    () => filterRows(rows, query, onlyFavs ? favorites.ids : undefined, area, onlyIssues ? "issues" : "all"),
    [rows, query, onlyFavs, favorites.ids, area, onlyIssues],
  );
  const areas = useMemo(
    () => summarizeAreas(rows.map((r) => ({ municipio: r.circuit.municipio, status: r.status }))),
    [rows],
  );
  const municipios = useMemo(
    () => [...new Set(rows.map((r) => r.circuit.municipio))].sort((a, b) => a.localeCompare(b, "es")),
    [rows],
  );
  const favRows = useMemo(() => rows.filter((r) => favorites.ids.includes(r.circuit.id)), [rows, favorites.ids]);

  // Selección inicial desde la URL (?c=id) cuando el catálogo ya cargó.
  useEffect(() => {
    const id = initialCircuitRef.current;
    if (!id || rows.length === 0) return;
    const row = rows.find((r) => r.circuit.id === id);
    if (row) {
      setSelected(row.circuit.id);
      setArea(row.circuit.municipio);
    }
    initialCircuitRef.current = null;
  }, [rows]);

  // Sincroniza el circuito seleccionado con la URL para poder compartir/enlazar.
  useEffect(() => {
    const url = new URL(location.href);
    if (selected) url.searchParams.set("c", selected);
    else url.searchParams.delete("c");
    history.replaceState(null, "", url);
  }, [selected]);

  // En qué municipio está el usuario: se calcula aquí, la posición no sale del dispositivo.
  const pos = locate.position;
  const here = useMemo(
    () => (pos && geo ? areaAt(geo.features as unknown as AreaFeature[], pos.lat, pos.lon) : null),
    [pos, geo],
  );
  // Al localizarse, se selecciona su municipio.
  useEffect(() => {
    if (here) setArea(here);
  }, [here]);

  // Detecta cambios de estado entre actualizaciones y avisa (especialmente favoritos).
  useEffect(() => {
    if (!status || rows.length === 0) return;
    const curr = new Map(rows.map((r) => [r.circuit.id, r.status]));
    const prev = prevStatusRef.current;
    prevStatusRef.current = curr;
    if (!prev) return; // primera carga: no notificar

    const next: Toast[] = [];
    let other = 0;
    for (const r of rows) {
      const before = prev.get(r.circuit.id);
      const after = r.status;
      if (!before || before === after) continue;
      if (favorites.ids.includes(r.circuit.id)) {
        if (after === "out")
          next.push({ id: ++toastId.current, text: `${r.circuit.name}: sin servicio`, tone: "out" });
        else if (after === "ok")
          next.push({ id: ++toastId.current, text: `${r.circuit.name}: con servicio`, tone: "ok" });
        else if (after === "stale")
          next.push({ id: ++toastId.current, text: `${r.circuit.name}: sin confirmar`, tone: "info" });
      } else {
        other++;
      }
    }
    if (other > 0) next.push({ id: ++toastId.current, text: `${other} circuito${other === 1 ? "" : "s"} más cambiaron de estado`, tone: "info" });
    if (next.length === 0) return;
    setToasts((t) => [...next.slice(0, 4), ...t].slice(0, 4));
  }, [status, rows, favorites.ids]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => setToasts((t) => t.slice(0, -1)), 5500);
    return () => clearTimeout(timer);
  }, [toasts]);

  const pickArea = (name: string | null) => {
    setArea(name);
    setSelected(null);
  };

  const pickCircuit = (id: string | null) => {
    if (!id) {
      setSelected(null);
      return;
    }
    setSelected(id);
    const m = rows.find((r) => r.circuit.id === id)?.circuit.municipio;
    if (m) setArea(m);
  };
  const areaInfo = area ? areas.get(area) : null;
  const affected = rows.filter((r) => r.status === "out").length;
  const unconfirmed = rows.filter((r) => r.status === "stale").length;
  const okCount = Math.max(0, rows.length - affected - unconfirmed);
  // Antigüedades calculadas aquí con la hora actual: no vienen congeladas del servidor.
  const pipelineAgeMin = status ? Math.max(0, (now - status.generated_at) / 60) : 0;
  const lastMessageAt = status?.source.last_message_at ?? null;
  const channelAgeMin = lastMessageAt ? Math.max(0, (now - lastMessageAt) / 60) : null;
  const deficit = status?.province.deficit_mw;
  const served = status?.province.served_mw;
  const total = rows.length || 1;
  const lastChangesAt = status?.pipeline?.last_changes_at ?? null;
  const lastChangesCount = status?.pipeline?.last_changes_count ?? null;

  const ThemeIcon = theme.theme === "system" ? Monitor : dark ? Moon : Sun;
  const themeLabel =
    theme.theme === "system" ? "Tema: automático" : dark ? "Tema: oscuro" : "Tema: claro";

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const h = containerRef.current?.clientHeight || window.innerHeight;
      const dy = d.y - e.clientY;
      if (Math.abs(dy) > 6) d.moved = true;
      const next = Math.min(MAX_SHEET, Math.max(MIN_SHEET, d.frac + dy / h));
      setSheetFrac(next);
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragging(false);
      setSheetFrac((v) => snapSheet(v));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const onHandleDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { y: e.clientY, frac: sheetFrac, moved: false };
    setDragging(true);
  };

  const onHandleClick = () => {
    if (dragRef.current?.moved) return;
    setSheetFrac((v) => (v < 0.5 ? 0.68 : 0.4));
  };

  const sheetExpanded = sheetFrac > 0.55;

  return (
    <div ref={containerRef} className="mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-paper text-ink">
      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0 pt-0.5">
          <h1 className="text-[19px] font-semibold leading-none tracking-tight">SinLuz</h1>
          <p className="mt-1 text-[11.5px] leading-none text-ink/45">Santiago de Cuba</p>
        </div>
        <div className="flex shrink-0 items-start gap-1.5">
          <div className="flex flex-col items-end gap-1 pt-0.5 text-[10.5px] leading-tight text-ink/45">
            <div className="flex items-center gap-1.5" title="Última lectura correcta de SinLuz">
              <Clock className={`h-3 w-3 ${pipelineAgeMin <= 30 ? "text-emerald-500 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`} />
              <span className="tabular-nums">
                {status ? (
                  <>
                    Actualizado {ago(status.generated_at, now)}
                    <span className="text-ink/35"> · {hhmm(status.generated_at)}</span>
                  </>
                ) : (
                  "Actualizando…"
                )}
              </span>
            </div>
            <div className="flex items-center gap-1.5" title="Último mensaje publicado en el canal oficial">
              <Radio className="h-3 w-3 text-ink/35" />
              <span className="tabular-nums">
                Canal {ago(lastMessageAt, now)}
                {lastMessageAt ? <span className="text-ink/35"> · {hhmm(lastMessageAt)}</span> : null}
              </span>
            </div>
            {lastChangesAt && lastChangesCount ? (
              <div className="flex items-center gap-1.5 text-ink/40" title="Última ingesta que aplicó cambios">
                <Bell className="h-3 w-3" />
                <span className="tabular-nums">
                  +{lastChangesCount} cambios {ago(lastChangesAt, now)}
                </span>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={theme.cycle}
            aria-label={themeLabel}
            title={themeLabel}
            className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-ink/45 transition hover:bg-muted hover:text-ink/70"
          >
            <ThemeIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <div className="relative z-0 min-h-0 flex-1">
          <MapView
            area={area}
            onArea={pickArea}
            here={here}
            locate={locate}
            rows={rows}
            selected={selected}
            onSelect={pickCircuit}
            onDeselect={() => setSelected(null)}
            now={now}
            dark={dark}
          />
          <LocateNote locate={locate} here={here} loaded={!!geo} />
          <Toasts items={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
        </div>

        <section
          className={`relative z-10 flex shrink-0 flex-col rounded-t-[20px] border-t border-line bg-paper shadow-[0_-8px_30px_rgba(0,0,0,0.06)] dark:shadow-[0_-8px_30px_rgba(0,0,0,0.35)] ${
            dragging ? "" : "transition-[height] duration-300 ease-out"
          }`}
          style={{ height: `${sheetFrac * 100}%` }}
          aria-label="Estado de los circuitos"
        >
          <button
            type="button"
            onPointerDown={onHandleDown}
            onClick={onHandleClick}
            aria-expanded={sheetExpanded}
            aria-label={sheetExpanded ? "Contraer el panel" : "Expandir el panel"}
            className="mx-auto mt-1 flex h-7 w-20 shrink-0 cursor-grab touch-none items-center justify-center rounded-full active:cursor-grabbing"
          >
            <span className="h-1 w-10 rounded-full bg-ink/15" aria-hidden />
          </button>

          <div className="px-4 pb-2 pt-1">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-ink/40">
                  Ahora mismo
                </p>
                <p className="mt-0.5 text-[24px] font-semibold leading-none tabular-nums">
                  {isLoading && !status ? "—" : affected}
                  <span className="ml-1.5 text-[13px] font-normal text-ink/50">
                    de {rows.length} sin servicio
                  </span>
                </p>
                {unconfirmed > 0 && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-stale" title="Afectado según el último aviso, pero el canal no lo ha vuelto a mencionar en varias horas">
                    <Info className="h-3 w-3" /> {unconfirmed} sin confirmar
                  </p>
                )}
              </div>
              {(deficit != null || served != null) && (
                <div className="flex shrink-0 gap-1.5 pb-0.5">
                  {deficit != null && <Chip label="déficit" value={`${deficit} MW`} tone="out" />}
                  {served != null && <Chip label="servicio" value={`${served} MW`} />}
                </div>
              )}
            </div>

            {rows.length > 0 && (
              <div className="mt-2.5">
                <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                  {affected > 0 && (
                    <span className="h-full bg-out" style={{ width: `${(affected / total) * 100}%` }} />
                  )}
                  {unconfirmed > 0 && (
                    <span className="h-full bg-stale" style={{ width: `${(unconfirmed / total) * 100}%` }} />
                  )}
                  {okCount > 0 && (
                    <span className="h-full bg-ok/70 dark:bg-ok/60" style={{ width: `${(okCount / total) * 100}%` }} />
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink/55">
                  <span className="inline-flex items-center gap-1">
                    <i className="h-1.5 w-1.5 rounded-full bg-out" aria-hidden /> {affected} sin servicio
                  </span>
                  {unconfirmed > 0 && (
                    <span
                      className="inline-flex items-center gap-1"
                      title="Afectado según el último aviso, pero el canal no lo ha vuelto a mencionar en varias horas"
                    >
                      <i className="h-1.5 w-1.5 rounded-full bg-stale" aria-hidden /> {unconfirmed} sin confirmar
                      <Info className="h-3 w-3 text-stale/70" aria-hidden />
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <i className="h-1.5 w-1.5 rounded-full bg-ok/70 dark:bg-ok/60" aria-hidden /> {okCount} con servicio
                  </span>
                </div>
              </div>
            )}
          </div>

          {favRows.length > 0 && (
            <div className="mx-4 mb-2">
              <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-ink/40">Mis circuitos</p>
              <div className="space-y-1">
                {favRows.map((r) => (
                  <FavRow key={r.circuit.id} row={r} now={now} active={selected === r.circuit.id} onSelect={pickCircuit} />
                ))}
              </div>
            </div>
          )}

          {area && (
            <div className="mx-4 mb-2 rounded-xl bg-muted px-3 py-2 ring-1 ring-line/40">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">
                  {area}
                  {area === here && (
                    <span className="ml-1.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">estás aquí</span>
                  )}
                </p>
                <button onClick={() => pickArea(null)} className="text-[11.5px] text-ink/50 hover:text-ink/70 active:text-ink">
                  Ver todo
                </button>
              </div>
              <p className="mt-0.5 text-[12px] text-ink/60">
                {!areaInfo
                  ? "No hay circuitos de este municipio en el catálogo."
                  : areaInfo.out > 0
                    ? `${areaInfo.out} de ${areaInfo.total} circuitos sin servicio`
                    : areaInfo.stale > 0
                      ? `${areaInfo.stale} sin confirmar · el resto con servicio`
                      : `Sin afectaciones informadas en ${areaInfo.total} circuitos`}
              </p>
              {area === here && (
                <p className="mt-1 text-[11px] leading-snug text-ink/45">
                  No sabemos qué circuito te alimenta: mira los de tu municipio y elige el tuyo (⭐ para guardarlo).
                </p>
              )}
            </div>
          )}

          <StatusBanner
            online={online}
            pipelineAgeMin={pipelineAgeMin}
            channelAgeMin={channelAgeMin}
            error={error?.message}
            isValidating={isValidating}
            lastError={status?.pipeline?.last_error ?? null}
            backoffUntil={status?.pipeline?.backoff_until ?? null}
            now={now}
          />

          {isLoading && !status ? (
            <Skeleton />
          ) : rows.length === 0 ? (
            <Empty />
          ) : (
            <CircuitList
              rows={visible}
              now={now}
              selected={selected}
              onSelect={pickCircuit}
              query={query}
              onQuery={setQuery}
              favorites={favorites}
              onlyFavs={onlyFavs}
              onOnlyFavs={setOnlyFavs}
              hasFavs={favorites.ids.length > 0}
              onlyIssues={onlyIssues}
              onOnlyIssues={setOnlyIssues}
              area={area}
              onArea={pickArea}
              municipios={municipios}
              emptyText={
                query || onlyFavs || onlyIssues || (area && !rows.some((r) => r.circuit.municipio === area))
                  ? "Ningún circuito coincide con los filtros."
                  : "No hay circuitos disponibles."
              }
            />
          )}

          <details className="shrink-0 border-t border-line px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-[10.5px] leading-snug text-ink/50">
            <summary className="cursor-pointer list-none text-[11px] font-medium text-ink/60">
              Fuentes y límites
            </summary>
            <p className="mt-1.5">
              Fuente del estado: canal oficial de la Empresa Eléctrica de Santiago de Cuba. App no
              oficial. El estado de cada circuito es el del último aviso del canal: «con servicio»
              significa que no se ha informado ninguna afectación. Ubicación de circuitos{" "}
              <strong className="font-medium text-ink/70">aproximada</strong>, basada en aportes
              colaborativos y en el mapa de circuitos de elTOQUE; no es el área de servicio oficial.
              Límites: geoBoundaries (CC BY 4.0) · Mapa: OpenStreetMap.
            </p>
          </details>
        </section>
      </main>
    </div>
  );
}

function FavRow({ row, now, active, onSelect }: { row: Row; now: number; active: boolean; onSelect: (id: string) => void }) {
  const sinceLabel = row.state.since_kind === "reported" ? "reportado" : "desde";
  const text =
    row.status === "out"
      ? `Sin servicio · ${elapsed(row.state.since, now)} (${sinceLabel} ${hhmm(row.state.since)})`
      : row.status === "stale"
        ? "Sin confirmar"
        : "Con servicio";
  return (
    <button
      type="button"
      onClick={() => onSelect(row.circuit.id)}
      className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition ${
        active ? "border-ink/20 bg-muted" : "border-line bg-surface hover:bg-muted/60"
      }`}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[row.status] }} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-tight">{row.circuit.name}</span>
        <span className="block truncate text-[11px] text-ink/50">{text}</span>
      </span>
    </button>
  );
}

function Toasts({ items, onDismiss }: { items: Toast[]; onDismiss: (id: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-3 top-2 z-[1100] flex flex-col gap-1.5">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] shadow-sm backdrop-blur ${
            t.tone === "out"
              ? "border-out/20 bg-surface/97 text-out"
              : t.tone === "ok"
                ? "border-ok/20 bg-surface/97 text-ok"
                : "border-line bg-surface/97 text-ink/75"
          }`}
          role="status"
        >
          <Bell className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{t.text}</span>
          <button onClick={() => onDismiss(t.id)} aria-label="Cerrar aviso" className="text-ink/40 hover:text-ink/70">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Mensaje breve sobre el mapa cuando la localización no da un municipio. */
function LocateNote({ locate, here, loaded }: { locate: Locate; here: string | null; loaded: boolean }) {
  let text: string | null = null;
  if (locate.state === "denied") text = "Sin permiso de ubicación. Elige tu municipio en el mapa.";
  else if (locate.state === "unavailable") text = "No se pudo obtener tu ubicación. Elige tu municipio en el mapa.";
  else if (locate.state === "ok" && loaded && !here) text = "Estás fuera de la provincia de Santiago de Cuba.";
  if (!text) return null;
  return (
    <p className="pointer-events-none absolute inset-x-3 top-12 z-[1000] rounded-lg bg-surface/95 px-3 py-2 text-center text-[12px] text-ink/70 shadow-sm ring-1 ring-line backdrop-blur">
      {text}
    </p>
  );
}

function Chip({ label, value, tone }: { label: string; value: string; tone?: "out" }) {
  return (
    <span
      className={`rounded-lg px-2 py-1 text-[10.5px] leading-none ${
        tone === "out"
          ? "bg-red-50 text-red-800 ring-1 ring-red-200/60 dark:bg-red-500/12 dark:text-red-200 dark:ring-red-400/20"
          : "bg-muted text-ink/60 ring-1 ring-line/40"
      }`}
    >
      <span className="block text-[9px] uppercase tracking-wide opacity-60">{label}</span>
      <span className="mt-0.5 block font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2 px-4 py-2" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-ink/12" />
          <div className="h-3 flex-1 animate-pulse rounded bg-ink/10" style={{ maxWidth: `${70 - i * 6}%` }} />
        </div>
      ))}
    </div>
  );
}

function Empty() {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-[14px] font-medium">Todavía no hay datos</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink/50">
        El canal no ha publicado mensajes interpretables. La app se actualiza sola cada 5 minutos.
      </p>
    </div>
  );
}
