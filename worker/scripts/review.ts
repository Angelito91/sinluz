/**
 * Genera la muestra de mensajes para etiquetado humano.
 * Conserva las etiquetas ya escritas si el archivo existe.
 *
 * Uso: bun run worker/scripts/review.ts [--n=100]
 * Salida: worker/data/messages_review.csv
 */
import { readFile, writeFile } from "node:fs/promises";
import { readRecords, toCsv } from "./lib/csv";
import { LIST_INTENTS, fmtDate, loadCatalog, loadFixtures } from "./lib/fixtures";
import { classify } from "../src/classify";
import { buildAliasIndex, groupHits, findHits } from "../src/normalize";

const nArg = process.argv.find((a) => a.startsWith("--n="));
const target = Number(nArg?.split("=")[1] ?? 100);

const [catalog, fixtures] = await Promise.all([loadCatalog(), loadFixtures()]);
const index = buildAliasIndex(catalog);

const list = fixtures.filter((m) => LIST_INTENTS.has(classify(m.message)));
const rest = fixtures.filter((m) => !LIST_INTENTS.has(classify(m.message)));

// muestreo determinista: extremos + paso fijo
function sample<T>(arr: T[], count: number): T[] {
  if (arr.length <= count) return arr;
  const step = arr.length / count;
  return Array.from({ length: count }, (_, i) => arr[Math.floor(i * step)]);
}

const picked = [...list, ...sample(rest, Math.max(10, target - list.length))]
  .sort((a, b) => a.id - b.id)
  .slice(0, target);

// etiquetas previas
const outUrl = new URL("../data/messages_review.csv", import.meta.url);
let previous = new Map<string, Record<string, string>>();
try {
  const raw = await readFile(outUrl, "utf8");
  previous = new Map(readRecords(raw).map((r) => [r.id, r]));
} catch {
  previous = new Map();
}

const rows: (string | number)[][] = [
  ["id", "fecha", "texto", "intent_detectada", "circuitos_detectados", "correct_intent", "correct_circuits", "notes"],
];

let kept = 0;
for (const m of picked) {
  const prev = previous.get(String(m.id));
  if (prev?.correct_intent) kept++;
  rows.push([
    m.id,
    fmtDate(m.date),
    m.message.replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim(),
    classify(m.message),
    [...groupHits(findHits(m.message, index)).keys()].join("|"),
    prev?.correct_intent ?? "",
    prev?.correct_circuits ?? "",
    prev?.notes ?? "",
  ]);
}

await writeFile(outUrl, toCsv(rows));

console.log(`OK · ${picked.length} mensajes → worker/data/messages_review.csv`);
console.log(`   ${picked.length - kept} sin etiquetar · ${kept} etiquetas conservadas`);
console.log("   Rellena solo correct_intent y correct_circuits. Luego: bun run data:score");
