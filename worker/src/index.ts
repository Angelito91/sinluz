import { Hono } from "hono";
import { cors } from "hono/cors";
import { IngestBody, OverrideBody } from "@sinluz/shared";
import { catalog } from "./catalog";
import {
  clearCircuitOverride,
  getSnapshot,
  listOverrides,
  rebuild,
  setCircuitOverride,
  type Env,
} from "./store";
import { ingest } from "./ingest";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

const CACHE_STATUS = "public, max-age=30, stale-while-revalidate=60, stale-if-error=86400";

app.get("/api/v1/status", async (c) => {
  const payload = await getSnapshot(c.env);
  c.header("cache-control", CACHE_STATUS);
  return c.json(payload);
});

app.get("/api/v1/circuits", (c) => {
  c.header("cache-control", "public, max-age=86400");
  return c.json(catalog);
});

app.get("/api/health", async (c) => {
  const [snapshot, count, lastLog] = await Promise.all([
    getSnapshot(c.env),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM raw_messages").first<{ n: number }>(),
    c.env.DB.prepare("SELECT at, source, ok, detail FROM ingest_log ORDER BY id DESC LIMIT 1").first<{
      at: number;
      source: string;
      ok: number;
      detail: string;
    }>(),
  ]);

  const healthy = snapshot.source.age_min < 360 && (lastLog?.ok ?? 0) === 1;
  c.header("cache-control", "no-store");
  return c.json(
    {
      healthy,
      last_ingest_at: lastLog?.at ?? null,
      last_ingest_source: lastLog?.source ?? null,
      last_ingest_ok: Boolean(lastLog?.ok),
      last_ingest_detail: lastLog?.detail ?? null,
      last_message_id: snapshot.source.last_message_id,
      age_min: snapshot.source.age_min,
      raw_messages: count?.n ?? 0,
      affected: snapshot.circuits.filter((x) => x.status === "out").length,
      province: snapshot.province,
    },
    healthy ? 200 : 503,
  );
});

function authorized(c: { req: { header: (k: string) => string | undefined } }, token?: string) {
  if (!token) return false;
  const header = c.req.header("authorization") ?? "";
  return header === `Bearer ${token}`;
}

/** Ingesta manual: override de un mensaje real o entrada de emergencia. */
app.post("/api/v1/ingest", async (c) => {
  if (!authorized(c, c.env.INGEST_TOKEN)) return c.json({ error: "no autorizado" }, 401);

  const body = IngestBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "cuerpo inválido" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const id = body.data.id ?? now;
  const posted_at = body.data.posted_at ?? now;

  await c.env.DB.prepare(
    `INSERT INTO raw_messages (id, posted_at, text, text_hash, parsed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET text = excluded.text, text_hash = excluded.text_hash, parsed_at = excluded.parsed_at`,
  )
    .bind(id, posted_at, body.data.text, String(id), now)
    .run();

  const payload = await rebuild(c.env, "manual");
  return c.json({ ok: true, affected: payload.circuits.filter((x) => x.status === "out").length });
});

app.post("/api/v1/admin/override", async (c) => {
  if (!authorized(c, c.env.ADMIN_TOKEN)) return c.json({ error: "no autorizado" }, 401);

  const body = OverrideBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "cuerpo inválido", issues: body.error.issues }, 400);

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
