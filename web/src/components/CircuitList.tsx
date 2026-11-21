import { Search, Star, X } from "lucide-react";
import type { Row } from "../lib/view";
import { STATUS_COLOR, STATUS_LABEL } from "../lib/view";
import { ago, elapsed, hhmm } from "../lib/time";

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
  emptyText,
}: Props) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 pb-2">
        <div className="relative flex-1">
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
        {hasFavs && (
          <button
            onClick={() => onOnlyFavs(!onlyFavs)}
            aria-pressed={onlyFavs}
            className={`flex h-10 items-center gap-1.5 rounded-xl border px-3 text-[13px] transition ${
              onlyFavs
                ? "border-ink bg-ink text-paper"
                : "border-line bg-surface text-ink/70 hover:border-ink/20"
            }`}
          >
            <Star className={`h-3.5 w-3.5 ${onlyFavs ? "fill-current" : ""}`} />
            Mi circuito
          </button>
        )}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-6">
        {rows.length === 0 && (
          <li className="px-3 py-10 text-center text-[13px] text-ink/55">{emptyText}</li>
        )}

        {rows.map(({ circuit, state, status }) => {
          const fav = favorites.has(circuit.id);
          const active = selected === circuit.id;
          const detail =
            status === "out"
              ? `desde ${hhmm(state.since)}`
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
                    <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-ink/45">
                      {circuit.municipio} · {detail}
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
