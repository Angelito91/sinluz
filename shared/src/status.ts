/**
 * Lógica de estado sin dependencias: la usan el Worker y la PWA, y la PWA no
 * debe arrastrar zod por esto.
 */

/** Lo que se muestra: `stale` es un `out` que el canal no confirma desde hace horas. */
export type DisplayStatus = "out" | "ok" | "stale";

/** Un `out` sin ninguna mención en este tiempo pasa a «sin confirmar». */
export const STALE_AFTER_S = 12 * 3600;

export function displayStatus(
  c: { status: "out" | "ok"; last_mention_at: number | null },
  now: number,
): DisplayStatus {
  if (c.status === "out" && c.last_mention_at != null && now - c.last_mention_at > STALE_AFTER_S) {
    return "stale";
  }
  return c.status;
}
