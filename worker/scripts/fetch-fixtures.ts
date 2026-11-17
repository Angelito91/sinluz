/**
 * Descarga el corpus real del canal y lo fusiona con el ya versionado.
 *
 * Uso:  bun run worker/scripts/fetch-fixtures.ts [--pages=10] [--limit=30] [--fresh]
 *
 * Respeta el límite del bridge (15 req/min): 1 petición cada 2 s como máximo.
 * Sin --fresh conserva los mensajes anteriores y añade los nuevos, así el corpus
 * crece en vez de desplazarse (las páginas se mueven con el tiempo).
 */
const BASE = "https://tg.i-c-a.su/json/electricastgo";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const pages = Number(args.get("pages") ?? 10);
const limit = Number(args.get("limit") ?? 30);
const fresh = args.get("fresh") === "true";

type Raw = { id: number; date: number; message?: string; views?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getPage(page: number): Promise<Raw[]> {
  const url = `${BASE}?limit=${limit}&page=${page}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "sinluz-fixtures/0.1" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { messages?: Raw[] };
      return data.messages ?? [];
    } catch (err) {
      console.warn(`  página ${page} intento ${attempt}: ${(err as Error).message}`);
      await sleep(4000 * attempt);
    }
  }
  return [];
}

const outPath = new URL("../test/fixtures/messages.json", import.meta.url).pathname;

const byId = new Map<number, Raw>();
if (!fresh) {
  try {
    const prev = (await Bun.file(outPath).json()) as { messages?: Raw[] };
    for (const m of prev.messages ?? []) byId.set(m.id, m);
    console.log(`  corpus previo: ${byId.size} mensajes`);
  } catch {
    // primer arranque: no hay nada que conservar
  }
}

const before = byId.size;

for (let page = 1; page <= pages; page++) {
  const batch = await getPage(page);
  for (const m of batch) {
    if (!m.message) continue;
    byId.set(m.id, { id: m.id, date: m.date, message: m.message, views: m.views });
  }
  console.log(`  página ${page}: ${batch.length} mensajes (acumulado ${byId.size})`);
  if (batch.length < limit) break;
  await sleep(2000);
}

const messages = [...byId.values()].sort((a, b) => a.id - b.id);

await Bun.write(
  outPath,
  JSON.stringify(
    {
      source: "https://t.me/electricastgo",
      fetched_at: new Date().toISOString(),
      count: messages.length,
      messages,
    },
    null,
    2,
  ),
);

console.log(
  `OK · ${messages.length} mensajes (${before} → ${messages.length}, +${
    messages.length - before
  }) · ${messages[0]?.id}..${messages.at(-1)?.id} → ${outPath}`,
);
