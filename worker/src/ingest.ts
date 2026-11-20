import { DEFAULT_MODEL, decide, type Message } from "./llm";
import {
  getSetting,
  getSnapshot,
  getStoredState,
  llmEnabled,
  logIngest,
  saveState,
  setSetting,
  touchState,
  type Env,
} from "./store";
import { applyChanges } from "./state";

const MIN = 60_000;
const MAX_BACKOFF_MIN = 40;
/** 1 página normal + hasta 3 anteriores si entre dos ingestas se publicó más de lo que cabe. */
const MAX_PAGES = 4;
/** Mensajes por llamada al modelo. */
const BATCH_SIZE = 15;
/** Tope de llamadas al modelo por ejecución. */
const MAX_BATCHES = 4;

type TelegramMessage = { id: number; date: number; message?: string };

export type IngestResult = {
  ok: boolean;
  skipped?: boolean;
  processed: number;
  changes: number;
  detail: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ingesta incremental: el estado vive en una sola fila y avanza por lotes.
 * Si el modelo falla, no se guarda nada y el próximo cron reintenta.
 */
export async function ingest(env: Env, source = "cron"): Promise<IngestResult> {
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);

  const backoffRaw = await getSetting(env, "backoff_until");
  const backoffUntil = backoffRaw ? Number(backoffRaw) : 0;
  if (backoffUntil > now) {
    await checkAlerts(env);
    return {
      ok: false,
      skipped: true,
      processed: 0,
      changes: 0,
      detail: `cuarentena hasta ${new Date(backoffUntil).toISOString()}`,
    };
  }

  if (!llmEnabled(env)) {
    const detail = env.AI ? "IA desactivada por LLM_ENABLED" : "falta el binding AI";
    await setSetting(env, "last_error", detail);
    await logIngest(env, source, false, detail);
    await checkAlerts(env);
    return { ok: false, processed: 0, changes: 0, detail };
  }

  const state = await getStoredState(env);
  let messages: Message[];

  try {
    messages = await fetchNew(env, state.source.last_message_id);
  } catch (err) {
    const detail = (err as Error).message;
    const failures = await countRecentFailures(env);
    const minutes = Math.min(MAX_BACKOFF_MIN, 5 * 2 ** Math.min(failures, 3));
    await setSetting(env, "backoff_until", String(now + minutes * MIN));
    await setSetting(env, "last_error", detail);
    await logIngest(env, source, false, detail);
    await checkAlerts(env);
    return { ok: false, processed: 0, changes: 0, detail: `fallo: ${detail} · backoff ${minutes} min` };
  }

  if (messages.length === 0) {
    await touchState(env, nowSec);
    await setSetting(env, "backoff_until", "0");
    await setSetting(env, "last_ok_at", String(nowSec));
    await setSetting(env, "last_error", "");
    await logIngest(env, source, true, "sin mensajes nuevos");
    await checkAlerts(env);
    return { ok: true, processed: 0, changes: 0, detail: "sin mensajes nuevos" };
  }

  let current = state;
  let processed = 0;
  let changes = 0;
  const batches = chunk(messages, BATCH_SIZE).slice(0, MAX_BATCHES);

  for (const batch of batches) {
    const result = await decide(env.AI!, env.LLM_MODEL || DEFAULT_MODEL, {
      now: nowSec,
      state: current,
      messages: batch,
    });

    if (!result.ok) {
      await setSetting(env, "last_error", result.error);
      await logIngest(env, source, false, `IA: ${result.error}`);
      await checkAlerts(env);
      return { ok: false, processed: 0, changes: 0, detail: `IA: ${result.error}` };
    }

    current = applyChanges(current, batch, result.result, nowSec);
    processed += batch.length;
    changes += result.result.cambios.length;
  }

  // Un solo guardado: si un lote falla, el estado anterior y el cursor no se tocan.
  await saveState(env, current);

  const pending = messages.length - processed;
  const detail = `${processed} mensajes · ${changes} cambios${pending > 0 ? ` · ${pending} pendientes` : ""}`;
  await setSetting(env, "backoff_until", "0");
  await setSetting(env, "last_ok_at", String(nowSec));
  await setSetting(env, "last_error", "");
  await logIngest(env, source, true, detail);
  await checkAlerts(env);

  return { ok: true, processed, changes, detail };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Pide páginas hasta cubrir el último id procesado (o hasta MAX_PAGES). */
async function fetchNew(env: Env, lastId: number | null): Promise<Message[]> {
  const limit = Number(env.INGEST_LIMIT ?? 30);
  const all: TelegramMessage[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageMessages = await fetchPage(env, page, limit);
    if (pageMessages.length === 0) break;
    all.push(...pageMessages);

    const min = Math.min(...pageMessages.map((m) => m.id));
    const covered = lastId == null ? pageMessages.length < limit : min <= lastId + 1;
    if (covered || pageMessages.length < limit) break;
    await sleep(2000); // el bridge admite 15 peticiones/min
  }

  const unique = new Map<number, Message>();
  for (const m of all) {
    if (typeof m.message !== "string" || m.message.trim().length === 0) continue;
    if (lastId != null && m.id <= lastId) continue;
    unique.set(m.id, { id: m.id, date: m.date, text: m.message });
  }

  return [...unique.values()].sort((a, b) => a.id - b.id || a.date - b.date);
}

async function fetchPage(env: Env, page: number, limit: number): Promise<TelegramMessage[]> {
  const url = `${env.INGEST_URL}?limit=${limit}${page > 1 ? `&page=${page}` : ""}`;
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "sinluz/2.0 (+https://github.com/sinluz)",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { messages?: TelegramMessage[] };
  return (data.messages ?? []).filter((m) => typeof m.message === "string" && m.message.length > 0);
}

async function countRecentFailures(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM ingest_log WHERE ok = 0 AND at > ?",
  )
    .bind(Math.floor(Date.now() / 1000) - 3600)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Avisa al admin por Telegram:
 *  - no se puede leer el canal desde hace más de 1 h
 *  - el canal lleva más de 6 h sin publicar (solo si la lectura funciona)
 */
async function checkAlerts(env: Env): Promise<void> {
  if (!env.ALERT_BOT_TOKEN || !env.ALERT_CHAT_ID) return;

  const now = Date.now();
  const lastOk = Number((await getSetting(env, "last_ok_at")) ?? 0) * 1000;

  if (lastOk > 0 && now - lastOk > 60 * MIN) {
    const h = Math.max(1, Math.round((now - lastOk) / (60 * MIN)));
    await alertOnce(
      env,
      "alert_pipeline_at",
      `⚠️ SinLuz: no se puede actualizar el estado desde hace ${h} h. Revisa el bridge o la IA.`,
    );
    return;
  }

  const snapshot = await getSnapshot(env);
  const lastMessage = (snapshot.source.last_message_at ?? 0) * 1000;
  if (lastMessage > 0 && now - lastMessage > 360 * MIN) {
    const h = Math.round((now - lastMessage) / (60 * MIN));
    await alertOnce(env, "alert_channel_at", `⚠️ SinLuz: el canal no publica desde hace ${h} h.`);
  }
}

/** Un mismo aviso no se repite antes de 6 h. */
async function alertOnce(env: Env, key: string, text: string): Promise<void> {
  const last = await getSetting(env, key);
  if (last && Date.now() - Number(last) < 6 * 60 * MIN) return;
  await setSetting(env, key, String(Date.now()));

  try {
    await fetch(`https://api.telegram.org/bot${env.ALERT_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.ALERT_CHAT_ID, text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // una alerta fallida no debe romper la ingesta
  }
}
