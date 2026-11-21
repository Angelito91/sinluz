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

type Event =
  | { kind: "out"; circuito: string; mensaje_id: number; duracion_min: number | null }
  | { kind: "ok"; circuito: string; mensaje_id: number }
  | { kind: "confirm"; circuito: string; mensaje_id: number; duracion_min: number | null };

/**
 * Aplica los cambios y confirmaciones que devolvió el modelo.
 *
 * Solo se aceptan ids del catálogo y mensajes del lote. Los eventos se aplican
 * en orden cronológico del lote; si un circuito tiene varios eventos, todos se
 * aplican (p. ej. ok y luego out). El `since` se calcula aquí, nunca en el
 * modelo.
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

  const events: Event[] = [];
  for (const c of result.cambios) {
    if (!catalogIds.has(c.circuito) || !byMessage.has(c.mensaje_id)) continue;
    events.push(
      c.estado === "ok"
        ? { kind: "ok", circuito: c.circuito, mensaje_id: c.mensaje_id }
        : { kind: "out", circuito: c.circuito, mensaje_id: c.mensaje_id, duracion_min: c.duracion_min },
    );
  }
  for (const c of result.confirmaciones) {
    if (!catalogIds.has(c.circuito) || !byMessage.has(c.mensaje_id)) continue;
    events.push({ kind: "confirm", circuito: c.circuito, mensaje_id: c.mensaje_id, duracion_min: c.duracion_min });
  }

  events.sort((a, b) => (order.get(a.mensaje_id) ?? 0) - (order.get(b.mensaje_id) ?? 0));

  for (const ev of events) {
    const msg = byMessage.get(ev.mensaje_id)!;

    if (ev.kind === "ok") {
      circuits.delete(ev.circuito);
      continue;
    }

    const prev = circuits.get(ev.circuito);
    // Una confirmación solo refresca circuitos ya afectados; si no estaba out,
    // se trata como evidencia de afectación.
    const duration =
      ev.duracion_min != null &&
      ev.duracion_min >= 0 &&
      ev.duracion_min <= MAX_DURATION_MIN
        ? ev.duracion_min
        : null;
    const explicit = duration != null;
    let since = explicit ? msg.date - duration * 60 : prev?.since ?? msg.date;
    const since_kind = explicit ? "explicit" : prev?.since_kind ?? "reported";

    // Guardia: si una duración explícita "rejuvenece" mucho un outage ya activo,
    // conserva el inicio anterior y solo refresca la confirmación.
    if (explicit && prev?.since != null && since > prev.since + 30 * 60) {
      since = prev.since;
    }

    const lastMention = Math.max(prev?.last_mention_at ?? 0, msg.date);

    circuits.set(ev.circuito, {
      id: ev.circuito,
      status: "out",
      since,
      since_kind,
      last_mention_at: lastMention,
      source_message_id: msg.id,
    });
  }

  const province = { ...state.province };
  if (result.metricas) {
    const deficit = plausibleMW(result.metricas.deficit_mw);
    const served = plausibleMW(result.metricas.servido_mw);
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
        since_kind: "explicit",
        last_mention_at: o.updated_at,
        source_message_id: null,
      });
    } else {
      circuits.delete(o.circuit_id);
    }
  }

  return { ...state, circuits: sortCircuits([...circuits.values()]) };
}
