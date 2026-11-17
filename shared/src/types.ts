import { z } from "zod";

/** Estado de un circuito tal como lo puede afirmar el canal. */
export const CircuitStatus = z.enum(["out", "none_reported", "unknown"]);
export type CircuitStatus = z.infer<typeof CircuitStatus>;

/** Intención de un mensaje del canal. */
export const Intent = z.enum([
  "snapshot", // lista completa de afectados ahora
  "add", // se incorporan circuitos
  "restore", // se restablece el servicio
  "top_n", // solo los más afectados (parcial, nunca borra)
  "metrics", // solo cifras MW
  "info", // avisos y recomendaciones
]);
export type Intent = z.infer<typeof Intent>;

export const CircuitKind = z.enum(["circuito", "linea"]);
export type CircuitKind = z.infer<typeof CircuitKind>;

export const CatalogCircuit = z.object({
  id: z.string().min(2),
  kind: CircuitKind,
  name: z.string().min(2),
  municipio: z.string().min(2),
  aliases: z.array(z.string()),
  anchor: z.tuple([z.number(), z.number()]),
  radius_m: z.number().int().positive(),
  geo_confidence: z.enum(["approximate", "centroid"]),
  notes: z.string().optional(),
});
export type CatalogCircuit = z.infer<typeof CatalogCircuit>;

export const CircuitState = z.object({
  id: z.string(),
  status: CircuitStatus,
  since: z.number().nullable(),
  reported_duration_min: z.number().nullable().optional(),
  source_message_id: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  duration_mismatch: z.boolean().optional(),
});
export type CircuitState = z.infer<typeof CircuitState>;

export const StatusPayload = z.object({
  generated_at: z.number(),
  source: z.object({
    channel: z.string(),
    last_message_id: z.number().nullable(),
    last_message_at: z.number().nullable(),
    age_min: z.number(),
    source_used: z.string(),
  }),
  province: z.object({
    deficit_mw: z.number().nullable(),
    served_mw: z.number().nullable(),
  }),
  circuits: z.array(CircuitState),
});
export type StatusPayload = z.infer<typeof StatusPayload>;

export const IngestBody = z.object({
  text: z.string().min(1),
  posted_at: z.number().int().optional(),
  id: z.number().int().optional(),
});
export type IngestBody = z.infer<typeof IngestBody>;

export const OverrideBody = z.object({
  circuit_id: z.string().min(2),
  status: CircuitStatus,
  since: z.number().int().nullable().optional(),
});
export type OverrideBody = z.infer<typeof OverrideBody>;
