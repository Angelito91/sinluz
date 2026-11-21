import { AlertTriangle, Info, Search, Star, X } from "lucide-react";
import type { Row } from "../lib/view";
import { STATUS_COLOR, STATUS_LABEL } from "../lib/view";
import { ago, elapsed, hhmm } from "../lib/time";

const STALE_HELP = "Afectado según el último aviso, pero el canal no lo ha vuelto a mencionar en varias horas.";

type Props = {
  rows: Row[];
  now: number;
  selected: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
  favorites: { has: (id: string) => boolean; toggle: (id: string) => void };
  onlyFavs: boolean;
  onOnlyFavs: (v: boolean) => void;
  hasFavs: boolean;
  onlyIssues: boolean;
  onOnlyIssues: (v: boolean) => void;
  area: string | null;
  onArea: (a: string | null) => void;
  municipios: string[];
  emptyText: string;
};

export default function CircuitList({
  rows,
  now,
  selected,
  onSelect,
  query,
  onQuery,
  favorites,
  onlyFavs,
  onOnlyFavs,
  hasFavs,
  onlyIssues,
  onOnlyIssues,
  area,
  onArea,
  municipios,
  emptyText,
}: Props) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/35" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Buscar circuito o municipio"
            aria-label="Buscar circuito"
            className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-9 text-[14px] text-ink outline-none placeholder:text-ink/35 focus:border-ink/25"
          />
          {query && (
            <button
              aria-label="Borrar búsqueda"
              onClick={() => onQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-ink/40 hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={() => onOnlyIssues(!onlyIssues)}
          aria-pressed={onlyIssues}
          aria-label="Mostrar solo circuitos sin servicio o sin confirmar"
          title="Solo sin servicio o sin confirmar"
          className={`flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-[12.5px] transition ${
            onlyIssues
              ? "border-out/30 bg-out/10 text-out"
              : "border-line bg-surface text-ink/60 hover:border-ink/20"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="hidden min-[360px]:inline">Problemas</span>
        </button>
        {hasFavs && (
          <button
            onClick={() => onOnlyFavs(!onlyFavs)}
            aria-pressed={onlyFavs}
            className={`flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-[12.5px] transition ${
              onlyFavs
                ? "border-ink bg-ink text-paper"
                : "border-line bg-surface text-ink/70 hover:border-ink/20"
            }`}
          >
            <Star className={`h-3.5 w-3.5 ${onlyFavs ? "fill-current" : ""}`} />
            <span className="hidden min-[360px]:inline">Mi circuito</span>
          </button>
        )}
      </div>

      {municipios.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-2 scrollbar-none" role="group" aria-label="Filtrar por municipio">
          <ChipBtn active={area === null} onClick={() => onArea(null)}>
            Todos
          </ChipBtn>
          {municipios.map((m) => (
            <ChipBtn key={m} active={area === m} onClick={() => onArea(area === m ? null : m)}>
              {m}
            </ChipBtn>
          ))}
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-6">
        {rows.length === 0 && (
          <li className="px-3 py-10 text-center text-[13px] text-ink/55">{emptyText}</li>
        )}

        {rows.map(({ circuit, state, status }) => {
          const fav = favorites.has(circuit.id);
          const active = selected === circuit.id;
          const sinceLabel = state.since_kind === "reported" ? "reportado" : "desde";
          const confirm =
            state.last_mention_at != null ? ` · confirmado ${ago(state.last_mention_at, now)}` : "";
          const detail =
            status === "out"
              ? `${sinceLabel} ${hhmm(state.since)}${confirm}`
              : status === "stale"
                ? `sin confirmar · último aviso ${ago(state.last_mention_at, now)}`
                : state.last_mention_at
                  ? `con servicio · aviso ${ago(state.last_mention_at, now)}`
                  : STATUS_LABEL.ok;

          return (
            <li key={circuit.id}>
              <div
                className={`group flex items-center gap-3 rounded-xl px-2 py-2.5 transition ${
                  active ? "bg-muted" : "hover:bg-muted/60"
                }`}
              >
                <button
                  onClick={() => onSelect(circuit.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  aria-current={active}
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      background: STATUS_COLOR[status],
                      boxShadow:
                        status === "out"
                          ? "0 0 0 3px color-mix(in srgb, var(--color-out) 18%, transparent)"
                          : undefined,
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium leading-tight">
                      {circuit.name}
                    </span>
                    <span
                      className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] leading-tight text-ink/45"
                      title={status === "stale" ? STALE_HELP : undefined}
                    >
                      <span className="truncate">
                        {circuit.municipio} · {detail}
                      </span>
                      {status === "stale" && <Info className="h-3 w-3 shrink-0 text-stale/70" aria-hidden />}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-right text-[12.5px] tabular-nums ${
                      status === "out" ? "font-semibold text-out" : "text-ink/35"
                    }`}
                  >
                    {status === "out" ? elapsed(state.since, now) : ""}
                  </span>
                </button>

                <button
                  onClick={() => favorites.toggle(circuit.id)}
                  aria-label={fav ? "Quitar de mi circuito" : "Marcar como mi circuito"}
                  aria-pressed={fav}
                  className={`shrink-0 rounded-full p-1.5 transition ${
                    fav ? "text-amber-500" : "text-ink/20 hover:text-ink/45"
                  }`}
                >
                  <Star className={`h-4 w-4 ${fav ? "fill-current" : ""}`} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChipBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11.5px] transition ${
        active ? "border-ink/20 bg-ink/10 text-ink" : "border-line bg-surface text-ink/55 hover:text-ink/75"
      }`}
    >
      {children}
    </button>
  );
}
