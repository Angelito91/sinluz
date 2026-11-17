import data from "../data/circuits.json";
import type { CatalogCircuit } from "@sinluz/shared";
import { buildAliasIndex } from "./normalize";

export const catalog = data as CatalogCircuit[];
export const aliasIndex = buildAliasIndex(catalog);
export const byId = new Map(catalog.map((c) => [c.id, c]));
