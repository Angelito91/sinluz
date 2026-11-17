import { readFile } from "node:fs/promises";
import type { CatalogCircuit } from "@sinluz/shared";

export type Fixture = { id: number; date: number; message: string; views?: number };

export async function loadFixtures(): Promise<Fixture[]> {
  const raw = await readFile(new URL("../../test/fixtures/messages.json", import.meta.url), "utf8");
  return (JSON.parse(raw) as { messages: Fixture[] }).messages;
}

export async function loadCatalog(): Promise<CatalogCircuit[]> {
  const raw = await readFile(new URL("../../data/circuits.json", import.meta.url), "utf8");
  return JSON.parse(raw) as CatalogCircuit[];
}

export const LIST_INTENTS = new Set(["snapshot", "add", "restore", "top_n"]);

export const fmtDate = (unix: number) =>
  new Intl.DateTimeFormat("es-CU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Havana",
  }).format(new Date(unix * 1000));
