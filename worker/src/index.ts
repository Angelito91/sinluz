import { Hono } from "hono";
import { cors } from "hono/cors";
import { IngestBody, OverrideBody } from "@sinluz/shared";
import { catalog, catalogIds } from "./catalog";
import {
  clearCircuitOverride,
  getSetting,
  getSnapshot,
  getStoredState,
  lastIngest,
  listOverrides,
  llmEnabled,
  saveState,
  setCircuitOverride,
  type Env,
} from "./store";
import { DEFAULT_MODEL, decide, type Message } from "./llm";
import { applyChanges } from "./state";
import { ingest } from "./ingest";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

// Cabeceras de seguridad comunes. La API solo devuelve JSON.
app.use("*", async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
  c.header("x-frame-options", "DENY");
  c.header("permissions-policy", "geolocation=(), microphone=(), camera=()");
});

const CACHE_STATUS = "public, max-age=30, stale-while-revalidate=60, stale-if-error=86400";

app.get("/api/v1/status", async (c) => {
  const [payload, lastError, backoffUntil, lastOkAt] = await Promise.all([
    getSnapshot(c.env),
    getSetting(c.env, "last_error"),
    getSetting(c.env, "backoff_until"),
    getSetting(c.env, "last_ok_at"),
  ]);
  c.header("cache-control", CACHE_STATUS);
  const backoffRaw = backoffUntil ? Number(backoffUntil) : null;
  return c.json({
    ...payload,
    pipeline: {
      last_error: lastError || null,
      backoff_until: backoffRaw ? (backoffRaw > 1e12 ? Math.round(backoffRaw / 1000) : backoffRaw) : null,
      last_ok_at: lastOkAt ? Number(lastOkAt) || null : null,
    },
  });
});

app.get("/api/v1/circuits", (c) => {
  c.header("cache-control", "public, max-age=86400");
  return c.json(catalog);
});

app.get("/api/health", async (c) => {
  const [snapshot, lastLog, lastError] = await Promise.all([
    getSnapshot(c.env),
    lastIngest(c.env),
    getSetting(c.env, "last_error"),
  ]);

  // Las antigüedades se calculan ahora, no al guardar: así no se congelan si la ingesta falla.
  const nowSec = Math.floor(Date.now() / 1000);
  const pipelineAge = snapshot.generated_at > 0 ? Math.round((nowSec - snapshot.generated_at) / 60) : null;
  const lastMessageAt = snapshot.source.last_message_at;
  const channelAge = lastMessageAt ? Math.round((nowSec - lastMessageAt) / 60) : null;

  const healthy =
    llmEnabled(c.env) &&
    pipelineAge != null &&
    pipelineAge < 30 &&
    (channelAge == null || channelAge < 360) &&
    (lastLog?.ok ?? 0) === 1;

  c.header("cache-control", "no-store");
  return c.json(
    {
      healthy,
      pipeline_age_min: pipelineAge,
      channel_age_min: channelAge,
      last_ingest_at: lastLog?.at ?? null,
      last_ingest_source: lastLog?.source ?? null,
      last_ingest_ok: Boolean(lastLog?.ok),
      last_ingest_detail: lastLog?.detail ?? null,
      last_message_id: snapshot.source.last_message_id,
      affected: snapshot.circuits.filter((x) => x.status === "out").length,
      province: snapshot.province,
      llm_enabled: llmEnabled(c.env),
      llm_model: c.env.LLM_MODEL || DEFAULT_MODEL,
      last_error: lastError || null,
    },
    healthy ? 200 : 503,
  );
});

function authorized(c: { req: { header: (k: string) => string | undefined } }, token?: string) {
  if (!token) return false;
  const header = c.req.header("authorization") ?? "";
  return header === `Bearer ${token}`;
}

/** Ingesta manual: interpreta un mensaje real o de emergencia sin tocar el cursor del canal. */
app.post("/api/v1/ingest", async (c) => {
  if (!authorized(c, c.env.INGEST_TOKEN)) return c.json({ error: "no autorizado" }, 401);
  if (!llmEnabled(c.env)) return c.json({ error: "IA no disponible" }, 503);

  const body = IngestBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "cuerpo inválido" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const msg: Message = {
    id: body.data.id ?? now,
    date: body.data.posted_at ?? now,
    text: body.data.text,
  };

  const state = await getStoredState(c.env);
  const result = await decide(c.env.AI!, c.env.LLM_MODEL || DEFAULT_MODEL, {
    now,
    state,
    messages: [msg],
  });
  if (!result.ok) return c.json({ error: result.error }, 502);

  const next = applyChanges(state, [msg], result.result, now, false);
  await saveState(c.env, next);

  return c.json({
    ok: true,
    applied: result.result.cambios.length,
    affected: next.circuits.filter((x) => x.status === "out").length,
  });
});

app.post("/api/v1/admin/override", async (c) => {
  if (!authorized(c, c.env.ADMIN_TOKEN)) return c.json({ error: "no autorizado" }, 401);

  const body = OverrideBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "cuerpo inválido", issues: body.error.issues }, 400);
  if (!catalogIds.has(body.data.circuit_id)) {
    return c.json({ error: "circuito desconocido" }, 400);
  }

  const payload = await setCircuitOverride(
    c.env,
    body.data.circuit_id,
    body.data.status,
    body.data.since ?? null,
  );
  return c.json({ ok: true, circuit: payload.circuits.find((x) => x.id === body.data.circuit_id) });
});

app.get("/api/v1/admin/overrides", async (c) => {
  if (!authorized(c, c.env.ADMIN_TOKEN)) return c.json({ error: "no autorizado" }, 401);
  return c.json(await listOverrides(c.env));
});

app.delete("/api/v1/admin/override/:circuit", async (c) => {
  if (!authorized(c, c.env.ADMIN_TOKEN)) return c.json({ error: "no autorizado" }, 401);
  const payload = await clearCircuitOverride(c.env, c.req.param("circuit"));
  return c.json({ ok: true, affected: payload.circuits.filter((x) => x.status === "out").length });
});

/** Ejecuta la ingesta a mano desde el navegador/curl, sin esperar al cron. */
app.post("/api/v1/refresh", async (c) => {
  if (!authorized(c, c.env.INGEST_TOKEN)) return c.json({ error: "no autorizado" }, 401);
  const result = await ingest(c.env, "manual");
  return c.json(result, result.ok ? 200 : 502);
});

app.notFound((c) => c.json({ error: "no encontrado" }, 404));
app.onError((err, c) => {
  console.error("error", err);
  return c.json({ error: "error interno" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(ingest(env, "cron"));
  },
};
