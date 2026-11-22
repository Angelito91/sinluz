import type { StatusPayload } from "@sinluz/shared";
import { DEFAULT_MODEL, decide, type LlmResult, type Message } from "./llm";
import { filterLlmResult, guardMode } from "./mentions";
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
const MAX_PAGES = 4;
const BATCH_SIZE = 12;
const MAX_BATCHES = 4;
const MAX_AI_CALLS = 12;

type TelegramMessage = { id: number; date: number; message?: string };

export type IngestResult = {
  ok: boolean;
  skipped?: boolean;
  processed: number;
  changes: number;
  detail: string;
  discarded?: number[];
  dropped?: number;
  logged?: number;
};

const EMPTY_RESULT: LlmResult = { cambios: [], metricas: null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  let dropped = 0;
  let logged = 0;
  const discarded: number[] = [];
  let failure: { kind: "transient" | "invalid"; message: string } | null = null;
  const budget = { remaining: MAX_AI_CALLS };
  const batches = chunk(messages, BATCH_SIZE).slice(0, MAX_BATCHES);

  for (const batch of batches) {
    if (budget.remaining <= 0) break;

    const outcome = await processBatch(env, current, batch, nowSec, budget);
    current = outcome.state;
    processed += outcome.processed;
    changes += outcome.changes;
    dropped += outcome.dropped;
    logged += outcome.logged;
    discarded.push(...outcome.discarded);

    if (outcome.error) {
      failure = outcome.error;
      break;
    }
    if (outcome.processed < batch.length) break;
  }

  const pending = messages.length - processed;

  if (processed > 0) await saveState(env, current);

  if (failure) {
    const detail = `IA: ${failure.message}${processed > 0 ? ` · ${processed} guardados` : ""}${
      pending > 0 ? ` · ${pending} pendientes` : ""
    }${discarded.length > 0 ? ` · ${discarded.length} descartados (${discarded.join(",")})` : ""}`;
    await setSetting(env, "last_error", detail);
    if (processed > 0) await setSetting(env, "last_ok_at", String(nowSec));
    await logIngest(env, source, false, detail);
    await checkAlerts(env);
    return {
      ok: false,
      processed,
      changes,
      detail,
      discarded,
      dropped,
      logged,
    };
  }

  const detail = `${processed} mensajes · ${changes} cambios${
    discarded.length > 0 ? ` · ${discarded.length} descartados (${discarded.join(",")})` : ""
  }${dropped > 0 ? ` · ${dropped} bloqueados` : ""}${logged > 0 ? ` · ${logged} sin mención` : ""}${
    pending > 0 ? ` · ${pending} pendientes` : ""
  }`;

  await setSetting(env, "backoff_until", "0");
  await setSetting(env, "last_ok_at", String(nowSec));
  await setSetting(env, "last_error", "");
  await logIngest(env, source, true, detail);
  await checkAlerts(env);

  return {
    ok: true,
    processed,
    changes,
    detail,
    discarded,
    dropped,
    logged,
  };
}

type BatchOutcome = {
  state: StatusPayload;
  processed: number;
  changes: number;
  dropped: number;
  logged: number;
  discarded: number[];
  error?: { kind: "transient" | "invalid"; message: string };
};

async function processBatch(
  env: Env,
  state: StatusPayload,
  batch: Message[],
  now: number,
  budget: { remaining: number },
): Promise<BatchOutcome> {
  if (batch.length === 0) {
    return { state, processed: 0, changes: 0, dropped: 0, logged: 0, discarded: [] };
  }
  if (budget.remaining <= 0) {
    return { state, processed: 0, changes: 0, dropped: 0, logged: 0, discarded: [] };
  }

  budget.remaining -= 1;
  const decision = await decide(env.AI!, env.LLM_MODEL || DEFAULT_MODEL, {
    now,
    state,
    messages: batch,
  });

  if (!decision.ok) {
    if (decision.kind === "transient") {
      return {
        state,
        processed: 0,
        changes: 0,
        dropped: 0,
        logged: 0,
        discarded: [],
        error: { kind: "transient", message: decision.error },
      };
    }

    if (batch.length === 1) {
      const next = applyChanges(state, batch, EMPTY_RESULT, now);
      return {
        state: next,
        processed: 1,
        changes: 0,
        dropped: 0,
        logged: 0,
        discarded: [batch[0]!.id],
      };
    }

    const mid = Math.floor(batch.length / 2);
    const left = await processBatch(env, state, batch.slice(0, mid), now, budget);
    if (left.error) return left;

    const right = await processBatch(env, left.state, batch.slice(mid), now, budget);
    const combined: BatchOutcome = {
      state: right.state,
      processed: left.processed + right.processed,
      changes: left.changes + right.changes,
      dropped: left.dropped + right.dropped,
      logged: left.logged + right.logged,
      discarded: [...left.discarded, ...right.discarded],
      ...(right.error ? { error: right.error } : {}),
    };
    return combined;
  }

  const guarded = filterLlmResult(batch, decision.result, guardMode(env.MENTION_GUARD));
  const next = applyChanges(state, batch, guarded.result, now);

  return {
    state: next,
    processed: batch.length,
    changes: guarded.result.cambios.length,
    dropped: guarded.dropped.length,
    logged: guarded.logged.length,
    discarded: [],
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchNew(env: Env, lastId: number | null): Promise<Message[]> {
  const all: TelegramMessage[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await fetchPage(env, page, Number(env.INGEST_LIMIT || 30));
    if (batch.length === 0) break;
    all.push(...batch);

    const min = Math.min(...batch.map((m) => m.id));
    const covered = lastId == null ? batch.length < Number(env.INGEST_LIMIT || 30) : min <= lastId + 1;
    if (covered || batch.length < Number(env.INGEST_LIMIT || 30)) break;
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

const FETCH_ATTEMPTS = 3;
const RETRY_WAIT_MS = [5_000, 15_000];

async function fetchPage(env: Env, page: number, limit: number): Promise<TelegramMessage[]> {
  const url = `${env.INGEST_URL}?limit=${limit}${page > 1 ? `&page=${page}` : ""}`;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "sinluz/2.0 (+https://github.com/sinluz)",
      },
      signal: AbortSignal.timeout(20_000),
    });

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < FETCH_ATTEMPTS - 1) {
      const retry = Number(res.headers.get("retry-after"));
      const wait =
        Number.isFinite(retry) && retry > 0
          ? Math.min(retry * 1000, 20_000)
          : RETRY_WAIT_MS[Math.min(attempt, RETRY_WAIT_MS.length - 1)]!;
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as { messages?: TelegramMessage[] };
    return (data.messages ?? []).filter((m) => typeof m.message === "string" && m.message.length > 0);
  }
}

async function countRecentFailures(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM ingest_log WHERE ok = 0 AND at > ?",
  )
    .bind(Math.floor(Date.now() / 1000) - 3600)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

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
    // la alerta no debe romper la ingesta
  }
}
