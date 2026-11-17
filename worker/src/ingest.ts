import type { Env } from "./store";
import { hashText, rebuild } from "./store";
import { classify } from "./classify";

const MIN = 60_000;
const MAX_BACKOFF_MIN = 40;

type TelegramMessage = { id: number; date: number; message?: string };

export type IngestResult = {
  ok: boolean;
  skipped?: boolean;
  stored: number;
  detail: string;
};

/**
 * Una sola petición por ejecución. El bridge es un servicio personal:
 * se le trata con cuidado (timeout corto, backoff exponencial, sin reintentos
 * agresivos). Cualquier error lo pone en cuarentena.
 */
export async function ingest(env: Env, source = "cron"): Promise<IngestResult> {
  const now = Date.now();

  const backoffRaw = await getSetting(env, "backoff_until");
  const backoffUntil = backoffRaw ? Number(backoffRaw) : 0;
  if (backoffUntil > now) {
    return {
      ok: false,
      skipped: true,
      stored: 0,
      detail: `cuarentena hasta ${new Date(backoffUntil).toISOString()}`,
    };
  }

  const limit = Number(env.INGEST_LIMIT ?? 30);
  const url = `${env.INGEST_URL}?limit=${limit}`;

  let messages: TelegramMessage[] = [];
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "sinluz/1.0 (+https://github.com/sinluz)",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { messages?: TelegramMessage[] };
    messages = (data.messages ?? []).filter((m) => typeof m.message === "string" && m.message.length > 0);
    if (messages.length === 0) throw new Error("respuesta sin mensajes");
  } catch (err) {
    const detail = (err as Error).message;
    const failures = await countRecentFailures(env);
    const minutes = Math.min(MAX_BACKOFF_MIN, 5 * 2 ** Math.min(failures, 3));
    await setSetting(env, "backoff_until", String(now + minutes * MIN));
    await log(env, source, false, detail);
    return { ok: false, stored: 0, detail: `fallo: ${detail} · backoff ${minutes} min` };
  }

  const statements = messages.map((m) =>
    env.DB.prepare(
      `INSERT INTO raw_messages (id, posted_at, text, text_hash, intent, parsed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         text = excluded.text,
         text_hash = excluded.text_hash,
         intent = excluded.intent,
         parsed_at = excluded.parsed_at
       WHERE raw_messages.text_hash <> excluded.text_hash`,
    ).bind(
      m.id,
      m.date,
      m.message!,
      hashText(m.message!),
      classify(m.message!),
      Math.floor(now / 1000),
    ),
  );

  try {
    await env.DB.batch(statements);
  } catch (err) {
    await log(env, source, false, `D1: ${(err as Error).message}`);
    return { ok: false, stored: 0, detail: `error guardando: ${(err as Error).message}` };
  }

  await setSetting(env, "backoff_until", "0");
  const payload = await rebuild(env, source);
  await log(env, source, true, `${messages.length} leídos · ${payload.circuits.length} circuitos`);
  await maybeAlert(env, payload.source.age_min);

  return { ok: true, stored: messages.length, detail: `${messages.length} mensajes` };
}

async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{
    value: string;
  }>();
  return row?.value ?? null;
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(key, value)
    .run();
}

async function countRecentFailures(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM ingest_log WHERE ok = 0 AND at > ?",
  )
    .bind(Math.floor(Date.now() / 1000) - 3600)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function log(env: Env, source: string, ok: boolean, detail: string): Promise<void> {
  await env.DB.prepare("INSERT INTO ingest_log (at, source, ok, detail) VALUES (?, ?, ?, ?)")
    .bind(Math.floor(Date.now() / 1000), source, ok ? 1 : 0, detail)
    .run();
}

/** Aviso al admin si el canal lleva más de 6 h sin publicar. */
async function maybeAlert(env: Env, ageMin: number): Promise<void> {
  if (!env.ALERT_BOT_TOKEN || !env.ALERT_CHAT_ID) return;
  if (ageMin < 360) return;

  const last = await getSetting(env, "last_alert_at");
  if (last && Date.now() - Number(last) < 6 * 60 * MIN) return;
  await setSetting(env, "last_alert_at", String(Date.now()));

  const text = `⚠️ SinLuz: el canal no publica desde hace ${Math.round(ageMin / 60)} h. Revisa el bridge o usa el ingreso manual.`;
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
