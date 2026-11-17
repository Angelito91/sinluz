/**
 * Informe de cobertura del catálogo sobre el corpus real.
 *
 * Uso: bun run worker/scripts/report.ts
 * Salida: worker/data/report.md y worker/data/unmatched.csv
 */
import { writeFile } from "node:fs/promises";
import { toCsv } from "./lib/csv";
import { LIST_INTENTS, fmtDate, loadCatalog, loadFixtures } from "./lib/fixtures";
import { classify } from "../src/classify";
import { buildAliasIndex, findHits, unmatchedSegments } from "../src/normalize";

const [catalog, fixtures] = await Promise.all([loadCatalog(), loadFixtures()]);
const index = buildAliasIndex(catalog);

const byIntent = new Map<string, number>();
const unmatched = new Map<string, { count: number; example: number }>();
const usedCircuits = new Map<string, number>();

let listMessages = 0;
let listWithHits = 0;
let totalHits = 0;
let totalUnmatched = 0;

for (const m of fixtures) {
  const intent = classify(m.message);
  byIntent.set(intent, (byIntent.get(intent) ?? 0) + 1);

  const hits = findHits(m.message, index);
  const misses = unmatchedSegments(m.message, index);
  totalHits += hits.length;
  totalUnmatched += misses.length;

  for (const h of hits) usedCircuits.set(h.id, (usedCircuits.get(h.id) ?? 0) + 1);
  for (const key of misses) {
    const prev = unmatched.get(key);
    unmatched.set(key, { count: (prev?.count ?? 0) + 1, example: prev?.example ?? m.id });
  }

  if (LIST_INTENTS.has(intent)) {
    listMessages++;
    if (hits.length > 0) listWithHits++;
  }
}

const coverage = listMessages === 0 ? 0 : (listWithHits / listMessages) * 100;
const mentionCoverage =
  totalHits + totalUnmatched === 0 ? 0 : (totalHits / (totalHits + totalUnmatched)) * 100;

const topUnmatched = [...unmatched.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 60);
const neverUsed = catalog.filter((c) => !usedCircuits.has(c.id));

const dates = fixtures.map((f) => f.date).sort((a, b) => a - b);

const md = `# Informe de cobertura · SinLuz

Generado sobre **${fixtures.length}** mensajes reales (${fmtDate(dates[0])} → ${fmtDate(dates.at(-1)!)}).

## Resultado

| Métrica | Valor |
|---|---|
| Mensajes con lista de circuitos | ${listMessages} |
| De ellos, con al menos un circuito identificado | ${listWithHits} |
| **Cobertura por mensaje** | **${coverage.toFixed(1)}%** |
| Menciones identificadas | ${totalHits} |
| Menciones sin identificar | ${totalUnmatched} |
| **Cobertura por mención** | **${mentionCoverage.toFixed(1)}%** |

Objetivo: cobertura por mensaje ≥ 95%.

## Distribución de intenciones

| Intención | Mensajes |
|---|---|
${[...byIntent.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `| \`${k}\` | ${v} |`)
  .join("\n")}

## Tokens sin identificar (top 60)

${
  topUnmatched.length
    ? `| Token canónico | Veces | Mensaje de ejemplo |\n|---|---|---|\n${topUnmatched
        .map(([k, v]) => `| \`${k}\` | ${v.count} | ${v.example} |`)
        .join("\n")}`
    : "_Ninguno. El catálogo cubre todo el corpus._"
}

## Circuitos del catálogo sin menciones

${neverUsed.length ? neverUsed.map((c) => `- \`${c.id}\` — ${c.name}`).join("\n") : "_Todos los circuitos aparecen al menos una vez._"}

## Circuitos más mencionados

${[...usedCircuits.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .map(([id, n]) => {
    const c = catalog.find((x) => x.id === id);
    return `- \`${id}\` — ${c?.name ?? "?"} · ${n} menciones`;
  })
  .join("\n")}
`;

await writeFile(new URL("../data/report.md", import.meta.url), md);
await writeFile(
  new URL("../data/unmatched.csv", import.meta.url),
  toCsv([
    ["token", "veces", "mensaje_ejemplo"],
    ...[...unmatched.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([k, v]) => [k, v.count, v.example]),
  ]),
);

console.log(`Cobertura por mensaje: ${coverage.toFixed(1)}%  (${listWithHits}/${listMessages})`);
console.log(`Cobertura por mención: ${mentionCoverage.toFixed(1)}%  (${totalHits}/${totalHits + totalUnmatched})`);
console.log(`Tokens sin identificar: ${unmatched.size}`);
console.log("→ worker/data/report.md · worker/data/unmatched.csv");

if (coverage < 80) process.exitCode = 2;
