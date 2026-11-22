import type { CircuitState, StatusPayload } from "@sinluz/shared";
import { catalogIds } from "./catalog";
import { MAX_DURATION_MIN, plain, plausibleMW, type LlmResult, type Message } from "./llm";

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

  const events = result.cambios
    .filter((c) => catalogIds.has(c.circuito) && byMessage.has(c.mensaje_id))
    .sort((a, b) => (order.get(a.mensaje_id) ?? 0) - (order.get(b.mensaje_id) ?? 0));

  for (const ev of events) {
    const msg = byMessage.get(ev.mensaje_id)!;

    if (ev.estado === "ok") {
      circuits.delete(ev.circuito);
      continue;
    }

    const prev = circuits.get(ev.circuito);
    const duration =
      ev.duracion_min != null &&
      ev.duracion_min >= 0 &&
      ev.duracion_min <= MAX_DURATION_MIN
        ? ev.duracion_min
        : null;
    const explicit = duration != null;
    let since = explicit ? msg.date - duration * 60 : prev?.since ?? msg.date;
    const since_kind = explicit ? "explicit" : prev?.since_kind ?? "reported";

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
    const metricsMessage =
      result.metricas.mensaje_id != null ? byMessage.get(result.metricas.mensaje_id) : undefined;
    if (metricsMessage && /\bmw\b/i.test(plain(metricsMessage.text))) {
      const deficit = plausibleMW(result.metricas.deficit_mw);
      const served = plausibleMW(result.metricas.servido_mw);
      if (deficit != null) province.deficit_mw = deficit;
      if (served != null) province.served_mw = served;
    }
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

export function mergeOverrides(
  state: StatusPayload,
  overrides: Override[],
  now = 0,
  ttlSeconds = 0,
): StatusPayload {
  const circuits = new Map(state.circuits.filter((c) => c.status === "out").map((c) => [c.id, c]));

  for (const o of overrides) {
    if (o.status === "out" && ttlSeconds > 0 && o.updated_at < now - ttlSeconds) continue;

    if (o.status === "out") {
      const prev = circuits.get(o.circuit_id);
      circuits.set(o.circuit_id, {
        id: o.circuit_id,
        status: "out",
        since: o.since ?? prev?.since ?? o.updated_at,
        since_kind: "explicit",
        last_mention_at: Math.max(prev?.last_mention_at ?? 0, o.updated_at),
        source_message_id: null,
      });
      continue;
    }

    const prev = circuits.get(o.circuit_id);
    if (prev && (prev.last_mention_at ?? 0) > o.updated_at) continue;
    circuits.delete(o.circuit_id);
  }

  return { ...state, circuits: sortCircuits([...circuits.values()]) };
}
