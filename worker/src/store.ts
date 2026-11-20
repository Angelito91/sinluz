import { StatusPayload, type CircuitStatus } from "@sinluz/shared";
import { emptyState, mergeOverrides, type Override } from "./state";
import type { AiBinding } from "./llm";

export type Env = {
  DB: D1Database;
  /** Binding de Workers AI (`[ai]` en wrangler.toml). */
  AI?: AiBinding;
  INGEST_URL: string;
  INGEST_LIMIT: string;
  /** Interruptor de emergencia: "false" apaga la IA sin borrar el binding. */
  LLM_ENABLED?: string;
  LLM_MODEL?: string;
  INGEST_TOKEN?: string;
  ADMIN_TOKEN?: string;
  ALERT_BOT_TOKEN?: string;
  ALERT_CHAT_ID?: string;
};

export type IngestLog = {
  at: number;
  source: string;
  ok: number;
  detail: string | null;
};

export function llmEnabled(env: Env): boolean {
  return Boolean(env.AI) && env.LLM_ENABLED !== "false";
}

function parseState(raw: string | null): StatusPayload {
  if (!raw) return emptyState(0);
  try {
    const parsed = StatusPayload.safeParse(JSON.parse(raw));
    if (!parsed.success) return emptyState(0);
    return { ...parsed.data, circuits: parsed.data.circuits.filter((c) => c.status === "out") };
  } catch {
    return emptyState(0);
  }
}

/** Estado crudo que interpretó la IA, sin correcciones manuales. */
export async function getStoredState(env: Env): Promise<StatusPayload> {
  const row = await env.DB.prepare("SELECT payload FROM state_snapshot WHERE id = 1").first<{
    payload: string;
  }>();
  return parseState(row?.payload ?? null);
}

/** Estado que sirve la API: estado crudo + correcciones manuales. */
export async function getSnapshot(env: Env): Promise<StatusPayload> {
  const [state, overrides] = await Promise.all([getStoredState(env), listOverrides(env)]);
  return mergeOverrides(state, overrides);
}

export async function saveState(env: Env, state: StatusPayload): Promise<StatusPayload> {
  const payload = StatusPayload.parse({
    ...state,
    circuits: state.circuits.filter((c) => c.status === "out"),
  });
  await env.DB.prepare(
    `INSERT INTO state_snapshot (id, payload, generated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, generated_at = excluded.generated_at`,
  )
    .bind(JSON.stringify(payload), payload.generated_at)
    .run();
  return payload;
}

/** Ingesta correcta sin mensajes nuevos: solo se anota que el canal se consultó. */
export async function touchState(env: Env, now: number): Promise<StatusPayload> {
  const state = await getStoredState(env);
  return saveState(env, { ...state, generated_at: now });
}

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{
    value: string;
  }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(key, value)
    .run();
}

export async function logIngest(
  env: Env,
  source: string,
  ok: boolean,
  detail: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO ingest_log (at, source, ok, detail) VALUES (?, ?, ?, ?)").bind(
      now,
      source,
      ok ? 1 : 0,
      detail,
    ),
    env.DB.prepare("DELETE FROM ingest_log WHERE at < ?").bind(now - 30 * 86400),
  ]);
}

export async function lastIngest(env: Env): Promise<IngestLog | null> {
  return env.DB.prepare(
    "SELECT at, source, ok, detail FROM ingest_log ORDER BY id DESC LIMIT 1",
  ).first<IngestLog>();
}

export async function listOverrides(env: Env): Promise<Override[]> {
  const { results } = await env.DB.prepare(
    "SELECT circuit_id, status, since, updated_at FROM circuit_overrides ORDER BY circuit_id",
  ).all<Override>();
  return results ?? [];
}

export async function setCircuitOverride(
  env: Env,
  circuitId: string,
  status: CircuitStatus,
  since: number | null,
): Promise<StatusPayload> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO circuit_overrides (circuit_id, status, since, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(circuit_id) DO UPDATE SET
       status = excluded.status, since = excluded.since, updated_at = excluded.updated_at`,
  )
    .bind(circuitId, status, status === "out" ? (since ?? now) : null, now)
    .run();
  return getSnapshot(env);
}

export async function clearCircuitOverride(env: Env, circuitId: string): Promise<StatusPayload> {
  await env.DB.prepare("DELETE FROM circuit_overrides WHERE circuit_id = ?").bind(circuitId).run();
  return getSnapshot(env);
}
