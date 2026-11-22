import data from "../data/circuits.json";
import { CatalogCircuit } from "@sinluz/shared";

export const catalog = CatalogCircuit.array().parse(data);
export const byId = new Map(catalog.map((c) => [c.id, c]));
export const catalogIds = new Set(catalog.map((c) => c.id));
