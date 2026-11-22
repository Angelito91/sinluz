import { byId } from "./catalog";
import type { LlmResult, Message } from "./llm";

export type GuardMode = "off" | "log" | "enforce";

export type GuardEvent = {
  circuito: string;
  mensaje_id: number;
  reason: "no_mention" | "bulk_ok";
};

export type GuardedResult = {
  result: LlmResult;
  dropped: GuardEvent[];
  logged: GuardEvent[];
};

export function guardMode(value: string | undefined): GuardMode {
  if (value === "enforce") return "enforce";
  if (value === "off") return "off";
  return "log";
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const UNIT =
  /\b\d+(?:[.,]\d+)?\s*(?:horas?|minutos?|mw|mws|megavatios?|quejas?|transformadores?|barriadas?)\b/g;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termRegex = (term: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, "u");

const termCache = new Map<string, string[]>();

function termsFor(circuitId: string): string[] {
  const cached = termCache.get(circuitId);
  if (cached) return cached;

  const circuit = byId.get(circuitId);
  if (!circuit) {
    termCache.set(circuitId, []);
    return [];
  }

  const terms = new Set<string>();
  const add = (value: string) => {
    const key = normalize(value);
    if (key) terms.add(key);
  };

  for (const alias of circuit.aliases) {
    add(alias);
    for (const digits of normalize(alias).match(/\d+/g) ?? []) {
      add(String(Number(digits)));
    }
  }
  add(circuit.name);

  const result = [...terms];
  termCache.set(circuitId, result);
  return result;
}

export function mentionsCircuit(text: string, circuitId: string): boolean {
  const cleaned = normalize(text).replace(UNIT, " ");
  return termsFor(circuitId).some((term) => termRegex(term).test(cleaned));
}

const RESET_VERB =
  /\b(se restablece|se restablecen|se restablecio|se restablecieron|queda restablecido|quedan restablecidos|se normaliza|se normalizan|vuelve el servicio|vuelven el servicio)\b/;
const UNIVERSAL =
  /\b(toda la provincia|todos los circuitos|todo el municipio|todos los municipios)\b/;

export function hasUniversalReset(text: string): boolean {
  const normalized = normalize(text);
  return RESET_VERB.test(normalized) && UNIVERSAL.test(normalized);
}

export function filterLlmResult(
  batch: Message[],
  result: LlmResult,
  mode: GuardMode,
): GuardedResult {
  if (mode === "off") return { result, dropped: [], logged: [] };

  const byMessage = new Map(batch.map((m) => [m.id, m]));
  const okCount = new Map<number, number>();
  for (const change of result.cambios) {
    if (change.estado === "ok") {
      okCount.set(change.mensaje_id, (okCount.get(change.mensaje_id) ?? 0) + 1);
    }
  }

  const dropped: GuardEvent[] = [];
  const logged: GuardEvent[] = [];

  const cambios = result.cambios.filter((change) => {
    const message = byMessage.get(change.mensaje_id);
    if (!message) return true;
    if (mentionsCircuit(message.text, change.circuito)) return true;
    if (change.estado === "ok" && hasUniversalReset(message.text)) return true;

    const bulk =
      change.estado === "ok" &&
      (okCount.get(change.mensaje_id) ?? 0) > 1;

    const event: GuardEvent = {
      circuito: change.circuito,
      mensaje_id: change.mensaje_id,
      reason: bulk ? "bulk_ok" : "no_mention",
    };

    if (bulk || mode === "enforce") {
      dropped.push(event);
      return false;
    }
    logged.push(event);
    return true;
  });

  return { result: { ...result, cambios }, dropped, logged };
}
