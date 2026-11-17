import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { aliasIndex } from "../src/catalog";
import { applyMessage, emptyRuntime } from "../src/state";

/**
 * Prueba dorada sobre el corpus real del canal.
 * Si el parser cambia, este test dice exactamente cómo cambia el estado.
 *
 * El corpus crece con `bun run fixtures` (fusiona, no reemplaza). Al añadir
 * mensajes nuevos hay que revisar esta lista a mano: es el momento en que se
 * detecta un cambio de comportamiento no intencionado.
 */
const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/messages.json", import.meta.url), "utf8"),
) as { messages: { id: number; date: number; message: string }[] };

test("el corpus real produce un estado estable y coherente", () => {
  const rt = emptyRuntime();
  for (const m of fixtures.messages) {
    applyMessage(rt, { id: m.id, date: m.date, text: m.message }, aliasIndex);
  }

  const out = [...rt.circuits.values()]
    .filter((c) => c.status === "out")
    .map((c) => c.id)
    .sort();

  // Reconstruido desde 293 mensajes (60185..60505). Los 5 primeros vienen del
  // último snapshot; el resto se acumula con los `add` y `top_n` posteriores,
  // que por diseño nunca borran estado.
  expect(out).toEqual([
    "line-4390",
    "line-5380",
    "line-5390",
    "line-5975",
    "pal-04",
    "sc-01",
    "sc-03",
    "sc-11",
    "sc-13",
    "sc-14",
    "sc-15",
    "tf-iii",
  ]);

  // no debe quedar ningún circuito en un estado inventado
  for (const c of rt.circuits.values()) {
    expect(["out", "none_reported", "unknown"]).toContain(c.status);
    if (c.status === "none_reported") expect(c.since).toBe(null);
  }

  // las cifras de la provincia salen del canal
  expect(rt.deficit_mw).toBe(107);
  expect(rt.served_mw).toBe(40);
  expect(rt.last_message_id).toBe(60505);

  // el corpus completo no debe dejar circuitos sin clasificar por nombre
  expect(fixtures.messages.length).toBeGreaterThan(280);
});
