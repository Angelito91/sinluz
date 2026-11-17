import type { CircuitState, Intent, StatusPayload } from "@sinluz/shared";
import { classify, parseMetrics } from "./classify";
import { findHits, groupHits, type AliasIndex } from "./normalize";

export type Runtime = {
  circuits: Map<string, CircuitState>;
  deficit_mw: number | null;
  served_mw: number | null;
  last_message_id: number | null;
  last_message_at: number | null;
};

export type IncomingMessage = { id: number; date: number; text: string };

export function emptyRuntime(): Runtime {
  return {
    circuits: new Map(),
    deficit_mw: null,
    served_mw: null,
    last_message_id: null,
    last_message_at: null,
  };
}

/**
 * Aplica un mensaje al estado. Reglas duras:
 *  - `top_n` e `info` nunca quitan circuitos del conjunto afectado.
 *  - un `snapshot` sin ninguna coincidencia se ignora (parseo roto o mensaje raro).
 *  - un circuito que sale del conjunto queda como `none_reported`, no como "con luz".
 */
export function applyMessage(
  rt: Runtime,
  msg: IncomingMessage,
  index: AliasIndex,
): { intent: Intent; affected: number } {
  const intent = classify(msg.text);
  const hits = groupHits(findHits(msg.text, index));
  const affected = hits.size;

  rt.last_message_id = msg.id;
  rt.last_message_at = msg.date;

  if (intent === "snapshot" && affected === 0) {
    // protección: no vaciamos el estado por un mensaje que no supimos leer
    return { intent: "info", affected };
  }

  switch (intent) {
    case "snapshot": {
      for (const [id, hit] of hits) {
        const prev = rt.circuits.get(id);
        const keepSince = prev?.status === "out" ? prev.since : msg.date;
        rt.circuits.set(id, {
          id,
          status: "out",
          since: keepSince,
          source_message_id: msg.id,
          confidence: hit.confidence,
          reported_duration_min: hit.minutes ?? prev?.reported_duration_min ?? null,
          duration_mismatch: mismatch(keepSince, msg.date, hit.minutes),
        });
      }
      for (const [id, prev] of rt.circuits) {
        if (prev.status === "out" && !hits.has(id)) {
          rt.circuits.set(id, {
            ...prev,
            status: "none_reported",
            since: null,
            reported_duration_min: null,
            source_message_id: msg.id,
          });
        }
      }
      break;
    }

    case "add": {
      for (const [id, hit] of hits) {
        const prev = rt.circuits.get(id);
        if (prev?.status === "out") {
          rt.circuits.set(id, {
            ...prev,
            source_message_id: msg.id,
            reported_duration_min: hit.minutes ?? prev.reported_duration_min ?? null,
            duration_mismatch: mismatch(prev.since, msg.date, hit.minutes),
          });
          continue;
        }
        rt.circuits.set(id, {
          id,
          status: "out",
          since: msg.date,
          source_message_id: msg.id,
          confidence: hit.confidence,
          reported_duration_min: hit.minutes ?? null,
          duration_mismatch: false,
        });
      }
      break;
    }

    case "restore": {
      for (const [id] of hits) {
        const prev = rt.circuits.get(id);
        if (!prev) continue;
        rt.circuits.set(id, {
          ...prev,
          status: "none_reported",
          since: null,
          reported_duration_min: null,
          source_message_id: msg.id,
        });
      }
      break;
    }

    case "top_n": {
      // lista parcial: solo actualiza tiempos, jamás borra
      for (const [id, hit] of hits) {
        const prev = rt.circuits.get(id);
        const since =
          prev?.status === "out" && prev.since
            ? prev.since
            : msg.date - (hit.minutes ?? 0) * 60;
        rt.circuits.set(id, {
          id,
          status: "out",
          since,
          source_message_id: msg.id,
          confidence: Math.min(hit.confidence, 0.6),
          reported_duration_min: hit.minutes ?? null,
          duration_mismatch: mismatch(since, msg.date, hit.minutes),
        });
      }
      break;
    }

    case "metrics": {
      const m = parseMetrics(msg.text);
      if (m.deficit_mw != null) rt.deficit_mw = m.deficit_mw;
      if (m.served_mw != null) rt.served_mw = m.served_mw;
      break;
    }

    case "info":
      break;
  }

  return { intent, affected };
}

function mismatch(since: number | null, messageDate: number, reported: number | null): boolean {
  if (!since || reported == null) return false;
  const computed = (messageDate - since) / 60;
  return Math.abs(computed - reported) > 15;
}

export function toPayload(rt: Runtime, generatedAt: number, sourceUsed: string): StatusPayload {
  const now = generatedAt;
  const circuits = [...rt.circuits.values()].sort((a, b) => {
    const rank = (s: CircuitState) => (s.status === "out" ? 0 : s.status === "unknown" ? 1 : 2);
    return rank(a) - rank(b) || (a.since ?? 0) - (b.since ?? 0);
  });

  return {
    generated_at: generatedAt,
    source: {
      channel: "@electricastgo",
      last_message_id: rt.last_message_id,
      last_message_at: rt.last_message_at,
      age_min: rt.last_message_at ? Math.max(0, Math.round((now - rt.last_message_at) / 60)) : 9999,
      source_used: sourceUsed,
    },
    province: { deficit_mw: rt.deficit_mw, served_mw: rt.served_mw },
    circuits,
  };
}
