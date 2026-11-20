import type { CircuitState, StatusPayload } from "@sinluz/shared";
import { catalogIds } from "./catalog";
import { MAX_DURATION_MIN, plausibleMW, type LlmResult, type Message } from "./llm";

export type Override = {
  circuit_id: string;
  status: string;
  since: number | null;
  updated_at: number;
};

export function emptyState(now = 0): StatusPayload {
  return {
    generated_at: now,
    source: { channel: "@electricastgo", last_message_id: null, last_message_at: null },
    province: { deficit_mw: null, served_mw: null },
    circuits: [],
  };
}

const sortCircuits = (circuits: CircuitState[]) =>
  [...circuits].sort(
    (a, b) => (a.since ?? 0) - (b.since ?? 0) || a.id.localeCompare(b.id),
  );

/**
 * Aplica los cambios que devolvió el modelo.
 *
 * Solo se aceptan ids del catálogo y mensajes del lote. Si un circuito aparece
 * varias veces, gana el mensaje más reciente. El `since` se calcula aquí, nunca
 * en el modelo: duración publicada > inicio anterior > fecha del mensaje.
 */
export function applyChanges(
  state: StatusPayload,
  batch: Message[],
  result: LlmResult,
  now: number,
  advanceCursor = true,
): StatusPayload {
  const order = new Map(batch.map((m, i) => [m.id, i]));
  const byMessage = new Map(batch.map((m) => [m.id, m]));
  const circuits = new Map(state.circuits.filter((c) => c.status === "out").map((c) => [c.id, c]));

  const valid = result.cambios
    .filter((c) => catalogIds.has(c.circuit_id) && byMessage.has(c.source_message_id))
    .sort(
      (a, b) =>
        (order.get(a.source_message_id) ?? 0) - (order.get(b.source_message_id) ?? 0),
    );

  for (const change of valid) {
    const msg = byMessage.get(change.source_message_id)!;

    if (change.status === "ok") {
      circuits.delete(change.circuit_id);
      continue;
    }

    const prev = circuits.get(change.circuit_id);
    const duration =
      change.duration_min != null &&
      change.duration_min >= 0 &&
      change.duration_min <= MAX_DURATION_MIN
        ? change.duration_min
        : null;
    const since = duration != null ? msg.date - duration * 60 : prev?.since ?? msg.date;

    circuits.set(change.circuit_id, {
      id: change.circuit_id,
      status: "out",
      since,
      last_mention_at: msg.date,
      source_message_id: msg.id,
    });
  }

  const province = { ...state.province };
  if (result.metrics) {
    const deficit = plausibleMW(result.metrics.deficit_mw);
    const served = plausibleMW(result.metrics.served_mw);
    if (deficit != null) province.deficit_mw = deficit;
    if (served != null) province.served_mw = served;
  }

  const last = batch[batch.length - 1];
  return {
    ...state,
    generated_at: now,
    province,
    circuits: sortCircuits([...circuits.values()]),
    source:
      advanceCursor && last
        ? { ...state.source, last_message_id: last.id, last_message_at: last.date }
        : state.source,
  };
}

/**
 * Las correcciones manuales se aplican al leer, no dentro del snapshot. Así,
 * borrar una corrección devuelve el estado que interpretó la IA.
 */
export function mergeOverrides(state: StatusPayload, overrides: Override[]): StatusPayload {
  const circuits = new Map(state.circuits.filter((c) => c.status === "out").map((c) => [c.id, c]));

  for (const o of overrides) {
    if (o.status === "out") {
      circuits.set(o.circuit_id, {
        id: o.circuit_id,
        status: "out",
        since: o.since ?? o.updated_at,
        last_mention_at: o.updated_at,
        source_message_id: null,
      });
    } else {
      circuits.delete(o.circuit_id);
    }
  }

  return { ...state, circuits: sortCircuits([...circuits.values()]) };
}
