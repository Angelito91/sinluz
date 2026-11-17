import { useMemo, useState } from "react";
import { Radio } from "lucide-react";
import MapView from "./components/MapView";
import CircuitList from "./components/CircuitList";
import StatusBanner from "./components/StatusBanner";
import { useCatalog, useStatus } from "./hooks/useStatus";
import { useNow } from "./hooks/useNow";
import { useFavorites, useOnline } from "./hooks/useLocal";
import { ago } from "./lib/time";
import { buildRows, filterRows, sortRows } from "./lib/view";

export default function App() {
  const { status, error, isLoading, isValidating } = useStatus();
  const catalog = useCatalog();
  const now = useNow();
  const online = useOnline();
  const favorites = useFavorites();

  const [query, setQuery] = useState("");
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(() => sortRows(buildRows(catalog ?? [], status)), [catalog, status]);
  const visible = useMemo(
    () => filterRows(rows, query, onlyFavs ? favorites.ids : undefined),
    [rows, query, onlyFavs, favorites.ids],
  );

  const affected = rows.filter((r) => r.state.status === "out");
  const ageMin = status?.source.age_min ?? 0;
  const deficit = status?.province.deficit_mw;
  const served = status?.province.served_mw;

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-paper text-ink">
      <header className="flex items-center justify-between px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div>
          <h1 className="text-[19px] font-semibold leading-none tracking-tight">SinLuz</h1>
          <p className="mt-1 text-[11.5px] leading-none text-ink/45">Santiago de Cuba</p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-ink/45">
          <Radio className={`h-3 w-3 ${ageMin <= 90 ? "text-emerald-600" : "text-amber-600"}`} />
          <span className="tabular-nums">{ago(status?.source.last_message_at ?? null, now)}</span>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <div className="relative z-0 min-h-0 flex-1">
          <MapView rows={rows} selected={selected} onSelect={setSelected} />
        </div>

        <section
          className="relative z-10 flex h-[56%] shrink-0 flex-col rounded-t-[20px] border-t border-black/5 bg-paper shadow-[0_-8px_30px_rgba(0,0,0,0.06)]"
          aria-label="Estado de los circuitos"
        >
          <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-black/12" aria-hidden />

          <div className="px-4 pb-3 pt-2">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-ink/40">
                  Ahora mismo
                </p>
                <p className="mt-0.5 text-[24px] font-semibold leading-none tabular-nums">
                  {isLoading && !status ? "—" : affected.length}
                  <span className="ml-1.5 text-[13px] font-normal text-ink/50">
                    {affected.length === 1 ? "circuito afectado" : "circuitos afectados"}
                  </span>
                </p>
              </div>
              {(deficit != null || served != null) && (
                <div className="flex shrink-0 gap-1.5 pb-0.5">
                  {deficit != null && <Chip label="déficit" value={`${deficit} MW`} tone="out" />}
                  {served != null && <Chip label="servicio" value={`${served} MW`} />}
                </div>
              )}
            </div>
          </div>

          <StatusBanner online={online} ageMin={ageMin} error={error?.message} isValidating={isValidating} />

          {isLoading && !status ? (
            <Skeleton />
          ) : rows.length === 0 ? (
            <Empty />
          ) : (
            <CircuitList
              rows={visible}
              now={now}
              selected={selected}
              onSelect={setSelected}
              query={query}
              onQuery={setQuery}
              favorites={favorites}
              onlyFavs={onlyFavs}
              onOnlyFavs={setOnlyFavs}
              hasFavs={favorites.ids.length > 0}
            />
          )}

          <p className="shrink-0 border-t border-black/5 px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-[10px] leading-snug text-ink/35">
            Fuente: canal oficial de la Empresa Eléctrica de Santiago de Cuba. App no oficial.
            «Sin afectación reportada» no significa que haya corriente. Límites: geoBoundaries (CC BY
            4.0) · OpenStreetMap.
          </p>
        </section>
      </main>
    </div>
  );
}

function Chip({ label, value, tone }: { label: string; value: string; tone?: "out" }) {
  return (
    <span
      className={`rounded-lg px-2 py-1 text-[10.5px] leading-none ${
        tone === "out" ? "bg-red-50 text-red-800" : "bg-black/[0.04] text-ink/60"
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
          <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-black/10" />
          <div className="h-3 flex-1 animate-pulse rounded bg-black/8" style={{ maxWidth: `${70 - i * 6}%` }} />
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
