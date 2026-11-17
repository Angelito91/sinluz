/**
 * Replay determinista del corpus: reconstruye el estado y lo imprime.
 * Es la verificación principal tras tocar el parser.
 *
 * Uso: bun run worker/scripts/replay.ts [--json]
 */
import { writeFile } from "node:fs/promises";
import { loadCatalog, loadFixtures } from "./lib/fixtures";
import { buildAliasIndex } from "../src/normalize";
import { applyMessage, emptyRuntime, toPayload } from "../src/state";
import { classify } from "../src/classify";

const [catalog, fixtures] = await Promise.all([loadCatalog(), loadFixtures()]);
const index = buildAliasIndex(catalog);
const rt = emptyRuntime();

const intents = new Map<string, number>();
for (const m of fixtures) {
  applyMessage(rt, { id: m.id, date: m.date, text: m.message }, index);
  const i = classify(m.message);
  intents.set(i, (intents.get(i) ?? 0) + 1);
}

const payload = toPayload(rt, Math.floor(Date.now() / 1000), "replay");

if (process.argv.includes("--json")) {
  const out = new URL("../data/replay.json", import.meta.url);
  await writeFile(out, JSON.stringify(payload, null, 2));
  console.log(`→ ${out.pathname}`);
}

const affected = payload.circuits.filter((c) => c.status === "out");
const now = payload.generated_at;

console.log(`\nMensajes: ${fixtures.length} · últimas intenciones: ${JSON.stringify(Object.fromEntries(intents))}`);
console.log(`Provincia: ${payload.province.deficit_mw ?? "?"} MW afectados · ${payload.province.served_mw ?? "?"} MW servidos`);
console.log(`Afectados: ${affected.length} · sin afectación reportada: ${payload.circuits.length - affected.length}\n`);

const fmt = (min: number) => {
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${String(Math.round(min % 60)).padStart(2, "0")} min` : `${Math.round(min)} min`;
};

for (const c of affected) {
  const circuit = catalog.find((x) => x.id === c.id);
  const computed = c.since ? (now - c.since) / 60 : 0;
  const reported = c.reported_duration_min;
  const flag = c.duration_mismatch ? " ⚠ discrepancia" : "";
  console.log(
    `  ${c.id.padEnd(12)} ${String(circuit?.name ?? "?").padEnd(38)} ` +
      `${fmt(computed).padStart(12)}` +
      (reported != null ? `  (canal: ${fmt(reported)})` : "") +
      `  conf ${c.confidence.toFixed(2)}${flag}`,
  );
}
