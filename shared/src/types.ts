import { z } from "zod";

/**
 * Estado de un circuito según el último aviso del canal.
 * Regla de producto: se mantiene hasta que un aviso lo cambie.
 *  - `out`: el canal lo dio por afectado y no ha dicho que volvió.
 *  - `ok`:  el canal no lo da por afectado (nunca mencionado o ya restablecido).
 */
export const CircuitStatus = z.enum(["out", "ok"]);
export type CircuitStatus = z.infer<typeof CircuitStatus>;

export { STALE_AFTER_S, displayStatus, type DisplayStatus } from "./status";

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
  geo_confidence: z.enum(["mapped", "reported", "approximate", "centroid"]),
  /** De dónde sale la ubicación: trazado detallado, elTOQUE, manual o centroide. */
  geo_source: z.string().optional(),
  notes: z.string().optional(),
});
export type CatalogCircuit = z.infer<typeof CatalogCircuit>;

export const CircuitState = z.object({
  id: z.string(),
  status: CircuitStatus,
  /** Inicio de la afectación (solo con `out`). */
  since: z.number().nullable(),
  /** Cómo se determinó el inicio: hora explícita/duración vs primera vez reportado. */
  since_kind: z.enum(["explicit", "reported"]).optional(),
  /** Última vez que el canal habló de este circuito. */
  last_mention_at: z.number().nullable(),
  source_message_id: z.number().nullable(),
});
export type CircuitState = z.infer<typeof CircuitState>;

export const PipelineHealth = z.object({
  last_error: z.string().nullable(),
  /** Segundos unix hasta los que la ingesta está en cuarentena (0 o null = sin espera). */
  backoff_until: z.number().nullable(),
  /** Última lectura correcta del canal por el servidor. */
  last_ok_at: z.number().nullable(),
  /** Última ingesta correcta que aplicó cambios. */
  last_changes_at: z.number().nullable().optional(),
  /** Cantidad de cambios aplicados en esa ingesta. */
  last_changes_count: z.number().nullable().optional(),
});
export type PipelineHealth = z.infer<typeof PipelineHealth>;

export const StatusPayload = z.object({
  /** Última ingesta correcta del canal (se actualiza aunque no haya mensajes nuevos). */
  generated_at: z.number(),
  source: z.object({
    channel: z.string(),
    last_message_id: z.number().nullable(),
    last_message_at: z.number().nullable(),
  }),
  province: z.object({
    deficit_mw: z.number().nullable(),
    served_mw: z.number().nullable(),
  }),
  circuits: z.array(CircuitState),
  /** Estado operativo de la ingesta (opcional, para diagnóstico en la UI). */
  pipeline: PipelineHealth.optional(),
});
export type StatusPayload = z.infer<typeof StatusPayload>;

export const IngestBody = z.object({
  text: z.string().min(1).max(4000),
  posted_at: z.number().int().optional(),
  id: z.number().int().optional(),
});
export type IngestBody = z.infer<typeof IngestBody>;

export const OverrideBody = z.object({
  circuit_id: z.string().min(2),
  status: CircuitStatus,
  since: z.number().int().positive().nullable().optional(),
});
export type OverrideBody = z.infer<typeof OverrideBody>;
