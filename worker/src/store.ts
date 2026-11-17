import type { CircuitStatus, StatusPayload } from "@sinluz/shared";
import { aliasIndex } from "./catalog";
import { applyMessage, emptyRuntime, toPayload } from "./state";

export type Env = {
  DB: D1Database;
  INGEST_URL: string;
  INGEST_LIMIT: string;
  LLM_ENABLED?: string;
  INGEST_TOKEN?: string;
  ADMIN_TOKEN?: string;
  ALERT_BOT_TOKEN?: string;
  ALERT_CHAT_ID?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
};

type RawRow = { id: number; posted_at: number; text: string };

type OverrideRow = {
  circuit_id: string;
  status: CircuitStatus;
  since: number | null;
};

/** Hash síncrono y barato: solo detecta ediciones de texto. */
export function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Reconstruye el estado completo desde los mensajes crudos. Idempotente.
 * Las correcciones manuales se aplican al final, así que un rebuild no las
 * borra: eso es justo lo que las hace útiles.
 */
export async function rebuild(env: Env, sourceUsed = "cron"): Promise<StatusPayload> {
  const { results } = await env.DB.prepare(
    "SELECT id, posted_at, text FROM raw_messages ORDER BY posted_at ASC, id ASC",
  ).all<RawRow>();

  const rt = emptyRuntime();
  for (const row of results ?? []) {
    applyMessage(rt, { id: row.id, date: row.posted_at, text: row.text }, aliasIndex);
  }

  const payload = toPayload(rt, Math.floor(Date.now() / 1000), sourceUsed);
  await applyOverrides(env, payload);
  await saveSnapshot(env, payload);

  return payload;
}

/** Aplica las filas de `circuit_overrides` sobre el payload. */
export async function applyOverrides(env: Env, payload: StatusPayload): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT circuit_id, status, since FROM circuit_overrides",
  ).all<OverrideRow>();
  for (const row of results ?? []) {
    const idx = payload.circuits.findIndex((c) => c.id === row.circuit_id);
    const next = {
      id: row.circuit_id,
      status: row.status,
      since: row.status === "out" ? row.since : null,
      source_message_id: null,
      confidence: 1,
      reported_duration_min: null,
    };
    if (idx >= 0) payload.circuits[idx] = next;
    else payload.circuits.push(next);
  }
}

async function saveSnapshot(env: Env, payload: StatusPayload): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO state_snapshot (id, payload, generated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, generated_at = excluded.generated_at`,
  )
    .bind(JSON.stringify(payload), payload.generated_at)
    .run();
}

export async function getSnapshot(env: Env): Promise<StatusPayload> {
  const row = await env.DB.prepare("SELECT payload FROM state_snapshot WHERE id = 1").first<{
    payload: string;
  }>();
  if (row) return JSON.parse(row.payload) as StatusPayload;

  // Primer arranque: si ya hay mensajes, reconstruimos; si no, estado vacío.
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM raw_messages").first<{ n: number }>();
  if ((count?.n ?? 0) > 0) return rebuild(env, "rebuild");

  const empty = toPayload(emptyRuntime(), Math.floor(Date.now() / 1000), "empty");
  await applyOverrides(env, empty);
  return empty;
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

  // Reconstruye para que el override se aplique sobre el estado real.
  return rebuild(env, "override");
}

/** Borra una corrección manual; el estado vuelve a lo que digan los mensajes. */
export async function clearCircuitOverride(env: Env, circuitId: string): Promise<StatusPayload> {
  await env.DB.prepare("DELETE FROM circuit_overrides WHERE circuit_id = ?").bind(circuitId).run();
  return rebuild(env, "override");
}

export async function listOverrides(env: Env): Promise<OverrideRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT circuit_id, status, since FROM circuit_overrides ORDER BY circuit_id",
  ).all<OverrideRow>();
  return results ?? [];
}
