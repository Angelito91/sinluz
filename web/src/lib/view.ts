import type { CatalogCircuit, CircuitState, StatusPayload } from "@sinluz/shared";

export type Row = {
  circuit: CatalogCircuit;
  state: CircuitState;
};

const EMPTY: CircuitState = {
  id: "",
  status: "unknown",
  since: null,
  source_message_id: null,
  confidence: 0,
};

export function buildRows(catalog: CatalogCircuit[], status?: StatusPayload): Row[] {
  const byId = new Map((status?.circuits ?? []).map((c) => [c.id, c]));
  return catalog.map((circuit) => ({
    circuit,
    state: byId.get(circuit.id) ?? { ...EMPTY, id: circuit.id },
  }));
}

const rank = (s: CircuitState) => (s.status === "out" ? 0 : s.status === "none_reported" ? 1 : 2);

export function sortRows(rows: Row[]): Row[] {
  return [...rows].sort(
    (a, b) =>
      rank(a.state) - rank(b.state) ||
      (a.state.since ?? Number.MAX_SAFE_INTEGER) - (b.state.since ?? Number.MAX_SAFE_INTEGER) ||
      a.circuit.name.localeCompare(b.circuit.name, "es"),
  );
}

export function filterRows(rows: Row[], query: string, favs?: string[]): Row[] {
  const q = query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return rows.filter((r) => {
    if (favs && !favs.includes(r.circuit.id)) return false;
    if (!q) return true;
    const hay = `${r.circuit.name} ${r.circuit.municipio} ${r.circuit.id}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return hay.includes(q);
  });
}

export const STATUS_LABEL: Record<CircuitState["status"], string> = {
  out: "sin servicio",
  none_reported: "sin afectación reportada",
  unknown: "sin datos",
};

export const STATUS_COLOR: Record<CircuitState["status"], string> = {
  out: "#d64545",
  none_reported: "#3f7d5c",
  unknown: "#a3a39c",
};
