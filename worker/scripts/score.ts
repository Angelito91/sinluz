/**
 * Compara el parser con las etiquetas humanas de messages_review.csv.
 *
 * Uso: bun run worker/scripts/score.ts
 */
import { readFile } from "node:fs/promises";
import { readRecords } from "./lib/csv";

const raw = await readFile(new URL("../data/messages_review.csv", import.meta.url), "utf8");
const rows = readRecords(raw).filter((r) => r.correct_intent);
if (rows.length === 0) {
  console.log("No hay mensajes etiquetados todavía. Ejecuta: bun run data:review");
  process.exit(0);
}

const intents = ["snapshot", "add", "restore", "top_n", "metrics", "info"] as const;
const confusion = new Map<string, Map<string, number>>();
let correct = 0;
let circuitRows = 0;
let circuitOk = 0;

for (const r of rows) {
  const detected = r.intent_detectada;
  const expected = r.correct_intent;
  const m = confusion.get(expected) ?? new Map();
  m.set(detected, (m.get(detected) ?? 0) + 1);
  confusion.set(expected, m);
  if (detected === expected) correct++;

  if (r.correct_circuits) {
    circuitRows++;
    const a = new Set(r.correct_circuits.split("|").map((s) => s.trim()).filter(Boolean));
    const b = new Set(r.circuitos_detectados.split("|").map((s) => s.trim()).filter(Boolean));
    const same = a.size === b.size && [...a].every((x) => b.has(x));
    if (same) circuitOk++;
  }
}

const acc = (correct / rows.length) * 100;
console.log(`Intención: ${acc.toFixed(1)}%  (${correct}/${rows.length})`);
if (circuitRows) {
  console.log(`Circuitos: ${((circuitOk / circuitRows) * 100).toFixed(1)}% exactos  (${circuitOk}/${circuitRows})`);
}

console.log("\nMatriz de confusión (filas = esperado, columnas = detectado)\n");
const pad = 9;
console.log("".padEnd(pad) + intents.map((i) => i.padStart(pad)).join(""));
for (const expected of intents) {
  const row = confusion.get(expected);
  if (!row) continue;
  const cells = intents.map((i) => String(row.get(i) ?? 0).padStart(pad)).join("");
  console.log(expected.padEnd(pad) + cells);
}

const worst = [...confusion.entries()]
  .flatMap(([expected, row]) =>
    [...row.entries()]
      .filter(([detected]) => detected !== expected)
      .map(([detected, n]) => ({ expected, detected, n })),
  )
  .sort((a, b) => b.n - a.n)
  .slice(0, 5);

if (worst.length) {
  console.log("\nConfusiones más frecuentes:");
  for (const w of worst) console.log(`  ${w.expected} → ${w.detected}: ${w.n}`);
}

if (acc < 90) process.exitCode = 2;
