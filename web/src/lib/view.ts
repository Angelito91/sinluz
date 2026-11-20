import type { CatalogCircuit, CircuitState, StatusPayload } from "@sinluz/shared";
import { displayStatus, type DisplayStatus } from "@sinluz/shared/status";

export type Row = {
  circuit: CatalogCircuit;
  state: CircuitState;
  /** Lo que se muestra: `out`, `ok`, o `stale` (afectado sin confirmar desde hace horas). */
  status: DisplayStatus;
};

/** Un circuito que el canal nunca ha mencionado cuenta como con servicio. */
const EMPTY: CircuitState = {
  id: "",
  status: "ok",
  since: null,
  last_mention_at: null,
  source_message_id: null,
};

export function buildRows(catalog: CatalogCircuit[], status: StatusPayload | undefined, now: number): Row[] {
  const byId = new Map((status?.circuits ?? []).map((c) => [c.id, c]));
  return catalog.map((circuit) => {
    const state = byId.get(circuit.id) ?? { ...EMPTY, id: circuit.id };
    return { circuit, state, status: displayStatus(state, now) };
  });
}

const rank = (r: Row) => (r.status === "out" ? 0 : r.status === "stale" ? 1 : 2);

export function sortRows(rows: Row[]): Row[] {
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.state.since ?? Number.MAX_SAFE_INTEGER) - (b.state.since ?? Number.MAX_SAFE_INTEGER) ||
      a.circuit.name.localeCompare(b.circuit.name, "es"),
  );
}

export function filterRows(rows: Row[], query: string, favs?: string[], area?: string | null): Row[] {
  const q = query
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  return rows.filter((r) => {
    if (favs && !favs.includes(r.circuit.id)) return false;
    if (area && r.circuit.municipio !== area) return false;
    if (!q) return true;
    const hay = `${r.circuit.name} ${r.circuit.municipio} ${r.circuit.id}`
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
    return hay.includes(q);
  });
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  out: "sin servicio",
  stale: "sin confirmar",
  ok: "con servicio",
};

export const STATUS_COLOR: Record<DisplayStatus, string> = {
  out: "#d64545",
  stale: "#c98a1b",
  ok: "#3f7d5c",
};

/** Color de relleno de un área según su estado resumido. */
export const AREA_COLOR = STATUS_COLOR;
