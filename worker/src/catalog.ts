import data from "../data/circuits.json";
import { CatalogCircuit } from "@sinluz/shared";

/** El catálogo es la única fuente de ids válidos. Se valida al arrancar. */
export const catalog = CatalogCircuit.array().parse(data);
export const byId = new Map(catalog.map((c) => [c.id, c]));
export const catalogIds = new Set(catalog.map((c) => c.id));
