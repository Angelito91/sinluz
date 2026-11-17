import type { CatalogCircuit, StatusPayload } from "@sinluz/shared";

const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export type { CatalogCircuit, StatusPayload };

export async function getStatus(): Promise<StatusPayload> {
  const res = await fetch(`${API}/api/v1/status`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function getCatalog(): Promise<CatalogCircuit[]> {
  const res = await fetch("/circuits.json");
  if (!res.ok) throw new Error(`catálogo ${res.status}`);
  return res.json();
}
