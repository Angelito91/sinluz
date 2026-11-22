import { readFile, writeFile } from "node:fs/promises";
import type { StatusPayload } from "@sinluz/shared";
import { catalogIds } from "../src/catalog";
import {
  DEFAULT_MODEL,
  decide,
  parseResult,
  type AiBinding,
  type LlmChange,
  type LlmInput,
} from "../src/llm";
import { filterLlmResult } from "../src/mentions";
import { applyChanges, emptyState } from "../src/state";

/**
 * Evaluación del corpus etiquetado.
 *
 *   bun run eval:replay              # respuestas grabadas, sin credenciales
 *   bun run eval:live                # Workers AI vía REST
 *   bun run eval:live -- --save out.json
 *
 * En vivo lee CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_API_TOKEN del entorno. No las
 * imprime ni las pone en la URL.
 */

type Label = {
  cambios: { circuito: string; estado: "out" | "ok" }[];
  metricas?: { deficit_mw: number | null; servido_mw: number | null };
};

type LabelsFile = { labels: Record<string, Label> };
type ReplayFile = { responses: Record<string, unknown> };
type Fixture = { messages: { id: number; date: number; message?: string }[] };

type Outcome = {
  id: number;
  ok: boolean;
  missing: string[];
  extra: string[];
  metrics: string | null;
  error: string | null;
};

const ROOT = new URL("../../", import.meta.url).pathname;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name: string) => process.argv.includes(name);

const replay = !has("--live");
const limit = Number(arg("--limit") ?? 0);
const labelsPath = arg("--labels") ?? `${ROOT}worker/test/fixtures/labels.json`;
const replayPath = arg("--replay-file") ?? `${ROOT}worker/test/fixtures/llm-replay.json`;
const savePath = arg("--save");
const model = arg("--model") ?? process.env.LLM_MODEL ?? DEFAULT_MODEL;

const labels = JSON.parse(await readFile(labelsPath, "utf8")) as LabelsFile;
const fixtures = JSON.parse(
  await readFile(`${ROOT}worker/test/fixtures/messages.json`, "utf8"),
) as Fixture;
const messages = new Map(fixtures.messages.map((m) => [m.id, m]));

const ids = Object.keys(labels.labels)
  .map(Number)
  .sort((a, b) => a - b)
  .slice(0, limit > 0 ? limit : undefined);

for (const id of ids) {
  if (!messages.has(id)) throw new Error(`falta el mensaje ${id} en messages.json`);
  for (const c of labels.labels[String(id)]!.cambios) {
    if (!catalogIds.has(c.circuito)) throw new Error(`el mensaje ${id} etiqueta un id inexistente: ${c.circuito}`);
  }
}

const replayResponses = replay
  ? ((JSON.parse(await readFile(replayPath, "utf8")) as ReplayFile).responses ?? {})
  : {};

if (!replay) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) {
    console.error(
      "Faltan CLOUDFLARE_ACCOUNT_ID y/o CLOUDFLARE_API_TOKEN. " +
        "Para evaluar sin credenciales usa: bun run eval:replay",
    );
    process.exit(1);
  }
  if (!/^[a-f0-9]{32}$/i.test(account)) {
    console.error("CLOUDFLARE_ACCOUNT_ID no tiene el formato esperado.");
    process.exit(1);
  }
}

function liveAi(account: string, token: string, capture: (raw: unknown) => void): AiBinding {
  return {
    async run(modelName, input) {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${modelName}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(60_000),
        },
      );
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; result?: unknown; errors?: { message?: string }[] }
        | null;

      if (!res.ok || !body?.success) {
        const detail = body?.errors?.[0]?.message ?? `HTTP ${res.status}`;
        throw new Error(detail);
      }
      capture(body.result);
      return body.result;
    },
  };
}

const key = (c: { circuito: string; estado: string }) => `${c.circuito}:${c.estado}`;
const fmt = (values: string[]) => (values.length ? values.join(", ") : "—");

const outcomes: Outcome[] = [];
const rawSaved: Record<string, unknown> = {};
let state: StatusPayload = emptyState(0);
let tp = 0;
let fp = 0;
let fn = 0;
let metricHits = 0;
let metricTotal = 0;

for (const id of ids) {
  const fixture = messages.get(id)!;
  const message = { id, date: fixture.date, text: fixture.message ?? "" };
  const label = labels.labels[String(id)]!;
  const input: LlmInput = { now: message.date, state, messages: [message] };

  let captured: unknown;
  const decision = replay
    ? parseResult(replayResponses[String(id)])
    : await decide(liveAi(process.env.CLOUDFLARE_ACCOUNT_ID!, process.env.CLOUDFLARE_API_TOKEN!, (raw) => {
        captured = raw;
      }), model, input);

  if (captured !== undefined) rawSaved[String(id)] = captured;

  if (!decision.ok) {
    outcomes.push({
      id,
      ok: false,
      missing: [],
      extra: [],
      metrics: null,
      error: decision.error,
    });
    continue;
  }

  const guarded = filterLlmResult([message], decision.result, "enforce");
  state = applyChanges(state, [message], guarded.result, message.date);

  const expected = new Set(label.cambios.map(key));
  const actual = new Set(guarded.result.cambios.map((c: LlmChange) => key(c)));
  const missing = [...expected].filter((k) => !actual.has(k)).sort();
  const extra = [...actual].filter((k) => !expected.has(k)).sort();

  tp += [...expected].filter((k) => actual.has(k)).length;
  fp += extra.length;
  fn += missing.length;

  let metrics: string | null = null;
  const expectedMetrics = label.metricas;
  if (expectedMetrics) {
    metricTotal += 1;
    const actualMetrics = guarded.result.metricas;
    if (
      actualMetrics?.deficit_mw === expectedMetrics.deficit_mw &&
      actualMetrics?.servido_mw === expectedMetrics.servido_mw
    ) {
      metricHits += 1;
    } else {
      metrics = `métricas ${expectedMetrics.deficit_mw}/${expectedMetrics.servido_mw} != ${
        actualMetrics?.deficit_mw ?? "null"
      }/${actualMetrics?.servido_mw ?? "null"}`;
    }
  } else if (guarded.result.metricas) {
    const m = guarded.result.metricas;
    if (m.deficit_mw != null || m.servido_mw != null) {
      metrics = `métricas inesperadas ${m.deficit_mw ?? "null"}/${m.servido_mw ?? "null"}`;
    }
  }

  outcomes.push({
    id,
    ok: missing.length === 0 && extra.length === 0 && metrics == null,
    missing,
    extra,
    metrics,
    error: null,
  });
}

if (savePath) {
  await writeFile(
    savePath,
    JSON.stringify(
      {
        version: 1,
        notes: "Respuestas crudas grabadas por eval:live. Reproducibles con eval:replay.",
        responses: rawSaved,
      },
      null,
      2,
    ) + "\n",
  );
}

const failed = outcomes.filter((o) => !o.ok);
const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

console.log(`Modo: ${replay ? `replay (${replayPath})` : `live (${model})`}`);
console.log(
  `Mensajes: ${outcomes.length} · exactos: ${outcomes.length - failed.length} · ` +
    `cambios: ${tp} aciertos, ${fp} sobran, ${fn} faltan · ` +
    `precisión ${(precision * 100).toFixed(1)}% · recall ${(recall * 100).toFixed(1)}% · F1 ${(f1 * 100).toFixed(1)}%`,
);
console.log(`Métricas: ${metricHits}/${metricTotal}`);

if (failed.length > 0) {
  console.log(`\nFallos (${failed.length}):`);
  for (const o of failed) {
    const parts = [
      o.error ? `error: ${o.error}` : null,
      o.missing.length ? `faltan ${fmt(o.missing)}` : null,
      o.extra.length ? `sobran ${fmt(o.extra)}` : null,
      o.metrics,
    ].filter(Boolean);
    console.log(`  ${o.id}: ${parts.join(" · ")}`);
  }
  process.exit(1);
}
