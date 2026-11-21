import { z } from "zod";
import type { StatusPayload } from "@sinluz/shared";
import { byId, catalog } from "./catalog";

/**
 * Interpretación de los avisos con Workers AI.
 *
 * El modelo es el único intérprete: recibe el estado actual, el catálogo y los
 * mensajes nuevos, y devuelve cambios/confirmaciones/métricas. No hay reglas ni
 * emparejador de alias como respaldo. Si falla o devuelve algo inválido, el
 * estado no se toca.
 */

/** Lo único que usamos del binding `AI` de Cloudflare. */
export type AiBinding = { run(model: string, input: unknown): Promise<unknown> };

export const DEFAULT_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";
const TIMEOUT_MS = 60_000;
export const MAX_DURATION_MIN = 30 * 24 * 60;
const MAX_PROVINCE_MW = 600;

export type Message = { id: number; date: number; text: string };

export type LlmInput = {
  /** Segundos unix de la ejecución. */
  now: number;
  /** Estado que el modelo debe tener en cuenta (solo circuitos afectados). */
  state: StatusPayload;
  /** Mensajes nuevos, en orden cronológico. */
  messages: Message[];
};

export const LlmChange = z.object({
  circuito: z.string(),
  estado: z.enum(["out", "ok"]),
  mensaje_id: z.number().int(),
  duracion_min: z.number().int().nullable(),
});
export type LlmChange = z.infer<typeof LlmChange>;

export const LlmConfirmation = z.object({
  circuito: z.string(),
  mensaje_id: z.number().int(),
  duracion_min: z.number().int().nullable(),
});
export type LlmConfirmation = z.infer<typeof LlmConfirmation>;

export const LlmMetrics = z.object({
  deficit_mw: z.number().nullish().transform((v) => v ?? null),
  servido_mw: z.number().nullish().transform((v) => v ?? null),
});

export const LlmResult = z.object({
  cambios: z.array(LlmChange),
  confirmaciones: z.array(LlmConfirmation).nullish().transform((v) => v ?? []),
  metricas: LlmMetrics.nullish().transform((v) => (v == null ? null : v)),
});
export type LlmResult = z.infer<typeof LlmResult>;

export type DecisionResult =
  | { ok: true; result: LlmResult }
  | { ok: false; error: string };

const CATALOG_TEXT = catalog
  .map((c) => `${c.id} | ${c.name} | ${c.municipio} | ${c.aliases.join(", ")}`)
  .join("\n");

const SYSTEM = `Eres el intérprete de los avisos del canal oficial de Telegram de la Empresa Eléctrica de Santiago de Cuba.
Conviertes mensajes nuevos en cambios de estado de circuitos y en cifras de la provincia.
No eres un asistente conversacional: tu única salida es un objeto JSON válido.

### ENTRADA
Recibirás un objeto JSON con:
- "ahora": fecha y hora actual en La Habana.
- "catalogo": circuitos válidos, uno por línea, formato "id | nombre | municipio | alias separados por comas".
- "estado_actual":
  - "afectados": circuitos actualmente sin servicio, con id, nombre, municipio, desde y minutos_afectado.
  - "metricas": { deficit_mw, servido_mw } vigentes (o null).
- "mensajes": mensajes nuevos en orden cronológico, cada uno con id, fecha y texto.

Los circuitos que no aparecen en estado_actual.afectados no tienen afectación registrada; puede que nunca se hayan mencionado. No los trates como restablecidos por no aparecer.

### SALIDA
Devuelve SOLO este JSON, sin markdown, sin explicaciones y sin texto adicional:

{
  "cambios": [
    {
      "circuito": "id exacto del catálogo",
      "estado": "out" | "ok",
      "mensaje_id": 123,
      "duracion_min": 980
    }
  ],
  "confirmaciones": [
    {
      "circuito": "id exacto del catálogo",
      "mensaje_id": 456,
      "duracion_min": null
    }
  ],
  "metricas": { "deficit_mw": 100, "servido_mw": 40 }
}

Reglas de forma:
- "cambios" y "confirmaciones" siempre son arrays; pueden estar vacíos.
- "metricas" es un objeto o null. null significa "no cambies las cifras".
- "duracion_min" es entero en minutos o null. Solo tiene sentido con "out" o confirmaciones.
- No existe el estado "none": si no hay evidencia, omite el circuito.
- "mensaje_id" debe ser el id del mensaje que contiene la evidencia del cambio/confirmación. No uses un mensaje que no menciona al circuito.
- Puedes devolver varios cambios para el mismo circuito si el lote contiene un restablecimiento y después una nueva afectación. Aplícalos en orden cronológico lógico; no los fusiones.
- No copies "minutos_afectado" ni "desde" de estado_actual como duracion_min.
- No inventes circuitos ni ids. Usa exactamente ids del catálogo.

### QUÉ ES UN CAMBIO
"estado": "out" cuando el mensaje afirma que el circuito:
- está sin servicio, afectado, interrumpido o sin corriente;
- está afectado por déficit de generación, avería o mantenimiento;
- está disparado, averiado o fuera de servicio;
- continúa, sigue o permanece afectado/sin servicio;
- se incorpora, se suma o entra a la afectación (no confundir con "al servicio");
- aparece en una lista de afectados / mayor tiempo de afectación / actualización de afectados.

"estado": "ok" cuando el mensaje afirma que el circuito:
- se restablece, se normaliza, se energiza, se recupera o vuelve el servicio;
- se encuentra con servicio, ya tiene servicio, quedó con servicio, o aparece como "Con servicio...";
- se incorpora o entra al servicio (no confundir con "a la afectación");
- aparece en una lista de "se encuentran con servicio" / "restablecidos" / "con servicio".

### QUÉ ES UNA CONFIRMACIÓN
Usa "confirmaciones" para un circuito que **ya está en estado_actual.afectados** y el mensaje vuelve a indicar que sigue afectado (por ejemplo, aparece otra vez en "mayor tiempo de afectación" o "actualización de afectados"), sin que haya un restablecimiento nuevo en ese mismo mensaje.
- La confirmación actualiza la última mención; no cambia el estado.
- Si el mensaje trae duración explícita, inclúyela en duracion_min; el servidor decide si conserva el inicio anterior.
- Si el circuito no estaba afectado y el mensaje lo reporta afectado, eso va en "cambios" como "out", no en "confirmaciones".

### REGLA DE ORO
Nunca deduzcas por omisión. Que un circuito no aparezca en una lista NO significa que esté restablecido. Solo devuelve "ok" si el mensaje lo dice explícitamente.

Las listas "con mayor tiempo de afectación" y "actualización de los circuitos afectados" son parciales: marca out/confirma solo los listados y no toques a los demás.

Excepción: si el mensaje dice explícitamente que se restablece "toda la provincia", "todos los circuitos" o "el servicio queda restablecido", devuelve "ok" para todos los circuitos de estado_actual.afectados.
Si dice explícitamente que se restablecen todos los circuitos de un municipio nombrado, devuelve "ok" solo para los circuitos afectados de ese municipio en estado_actual.

### NO CAMBIAR CUANDO
- Son quejas, averías individuales reportadas por clientes, recomendaciones o publicidad.
- Solo hay cifras de MW sin lista de circuitos (solo cambia "metricas").
- Avisos sobre el SEN, sistema nacional, otra provincia o el país.
- Definiciones ("Disparo:", "Avería:" como explicación), resúmenes históricos ("ayer", "máxima afectación fue"), pronósticos/futuro ("mañana", "se realizará").
- Variaciones de voltaje/fluctuaciones sin indicar circuito fuera de servicio.

### DESAMBIGUACIÓN (usa el catálogo)
- "Circuito N" sin municipio = Santiago de Cuba (sc-01..sc-26, salvo seccionalizados con ID propio en catálogo).
- "Circuito N de Palma/Palma N" = pa-palma-01/02/04 según corresponda.
- "1 y 2 de Contramaestre", "1 Contramaestre", "2 Contramaestre" = ct-contramaestre-01-02 (un solo id del catálogo).
- "3+2" = sc-03 y sc-02 (dos ids).
- Los circuitos con seccionalizado en el catálogo tienen ID propio: sc-07-sd3030, sc-07-si4630, sc-09-si4074, sc-09-si4615, sc-14-si3010. Usa el alias/código (3030, 4630, 4074, 4615, 3010) para resolver; si el mensaje dice solo "circuito 9 seccionalizado" o es ambiguo entre variantes, omite si no puedes decidir con seguridad.
- Líneas/ramales: el número/código es la identidad principal. Ejemplos de IDs reales: ct-4385, ct-4390, ct-4395-5175, ct-4435, sc-5330, sc-5975, sc-5980, sc-5980-0015, gu-5335-5618, pa-5385, sl-5395, slm-5380, sm-5390-md8005, iif-5390-4260.
- "Línea 4395... (5175)" / "III Frente 5175" = ct-4395-5175. "II Frente 4260/5390-4260" = iif-5390-4260.
- "Línea 5390" sin código/municipio que la desambigüe (puede ser sm-5390-md8005 o iif-5390-4260): omite si es ambigua.
- "Palma" solo no identifica circuito; omite. "Palma 1/2/4" sí.
- "Ramal"/"Subestación" con nombre propio: busca en alias del catálogo (ej. "Ramal Hospital Contramaestre" -> ct-hospital-contramaestre).
- Si dos circuitos encajan y el mensaje no permite decidir, no devuelvas ninguno.
- Usa alias, municipio, estado_actual y contexto del mensaje. No adivines.

### DURACIONES
- "16 horas y 20 minutos" -> 980. "9 horas" -> 540. "45 minutos" -> 45.
- "hora y media" -> 90. "11 horas y 56 minutos" -> 716.
- Solo si el mensaje indica explícitamente cuánto lleva afectado o desde cuándo.
- Si indica hora de inicio explícita ("desde las 10:00", "afectado desde las 14:30"), calcula duracion_min = fecha/hora del mensaje - hora de inicio. Si la hora de inicio parece posterior a la del mensaje, asume el día anterior.
- Si no hay inicio ni duración explícitos, duracion_min = null. No inventes ni estimes.
- Si supera 43 200 minutos (30 días), usa null.

### MÉTRICAS
- "metricas" solo con cifras de la provincia de Santiago de Cuba.
- "MW afectados", "déficit" o "afectación" -> deficit_mw. "MW servidos"/"MW con servicio" -> servido_mw.
- Un guion antes de la cifra suele ser separador, no negativo: "MW Afectados -40" = 40.
- Si solo viene una cifra, la otra es null. Si hay varias en el lote, usa las del mensaje más reciente.
- Si el mensaje habla del SEN/país/otra provincia, metricas = null.
- No repitas cifras de estado_actual si el mensaje no las actualiza.
- Rango plausible: 0 a 600 MW. Fuera de rango, usa null.

### RUIDO
- Ignora <br>, emojis, flechas, negritas y errores de formato.
- Ignora teléfonos, enlaces, nombres de personas, mensajes políticos y publicidad.
- Si no hay cambios, confirmaciones ni métricas nuevas: {"cambios":[],"confirmaciones":[],"metricas":null}`;

const FEW_SHOT: Array<{ role: "user" | "assistant"; content: string }> = [
  {
    role: "user",
    content: JSON.stringify({
      ahora: "2026-11-19 20:15",
      catalogo: "sc-08 | Circuito 8 | Santiago de Cuba | circuito 8",
      estado_actual: {
        afectados: [{ id: "sc-08", nombre: "Circuito 8", municipio: "Santiago de Cuba", desde: "2026-11-19 14:10", minutos_afectado: 365 }],
        metricas: { deficit_mw: 100, servido_mw: 40 },
      },
      mensajes: [{ id: 501, fecha: "2026-11-19 20:15", texto: "Se restablece el servicio eléctrico al circuito 8 de Santiago." }],
    }),
  },
  {
    role: "assistant",
    content: JSON.stringify({ cambios: [{ circuito: "sc-08", estado: "ok", mensaje_id: 501, duracion_min: null }], confirmaciones: [], metricas: null }),
  },
  {
    role: "user",
    content: JSON.stringify({
      ahora: "2026-11-19 21:00",
      catalogo: "sc-01 | Circuito 1 | Santiago de Cuba | circuito 1\nct-4390 | Linea 4390 | Contramaestre | 4390-Contramaestre",
      estado_actual: { afectados: [], metricas: null },
      mensajes: [{ id: 502, fecha: "2026-11-19 21:00", texto: "Circuitos con mayor tiempo de afectación:\nCircuito 1 ➡️ 9 horas\nLínea 4390-Contramaestre ➡️ 16 horas y 20 minutos" }],
    }),
  },
  {
    role: "assistant",
    content: JSON.stringify({
      cambios: [
        { circuito: "sc-01", estado: "out", mensaje_id: 502, duracion_min: 540 },
        { circuito: "ct-4390", estado: "out", mensaje_id: 502, duracion_min: 980 },
      ],
      confirmaciones: [],
      metricas: null,
    }),
  },
  {
    role: "user",
    content: JSON.stringify({
      ahora: "2026-11-19 22:00",
      catalogo: "sc-25 | Circuito 25 | Santiago de Cuba | circuito 25",
      estado_actual: {
        afectados: [{ id: "sc-25", nombre: "Circuito 25", municipio: "Santiago de Cuba", desde: "2026-11-18 20:00", minutos_afectado: 1560 }],
        metricas: null,
      },
      mensajes: [{ id: 503, fecha: "2026-11-19 22:00", texto: "Actualización de circuitos afectados por déficit:\nCircuito 25 ➡️ 26 horas" }],
    }),
  },
  {
    role: "assistant",
    content: JSON.stringify({
      cambios: [],
      confirmaciones: [{ circuito: "sc-25", mensaje_id: 503, duracion_min: 1560 }],
      metricas: null,
    }),
  },
  {
    role: "user",
    content: JSON.stringify({
      ahora: "2026-11-19 22:30",
      catalogo: "sc-08 | Circuito 8 | Santiago de Cuba | circuito 8",
      estado_actual: { afectados: [], metricas: null },
      mensajes: [{ id: 504, fecha: "2026-11-19 22:30", texto: "En estos momentos la provincia tiene 100 MW afectados. Con servicio 40 MW." }],
    }),
  },
  {
    role: "assistant",
    content: JSON.stringify({ cambios: [], confirmaciones: [], metricas: { deficit_mw: 100, servido_mw: 40 } }),
  },
];

const SCHEMA = {
  type: "object",
  properties: {
    cambios: {
      type: "array",
      items: {
        type: "object",
        properties: {
          circuito: { type: "string" },
          estado: { type: "string", enum: ["out", "ok"] },
          mensaje_id: { type: "integer" },
          duracion_min: { type: ["integer", "null"] },
        },
        required: ["circuito", "estado", "mensaje_id", "duracion_min"],
        additionalProperties: false,
      },
    },
    confirmaciones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          circuito: { type: "string" },
          mensaje_id: { type: "integer" },
          duracion_min: { type: ["integer", "null"] },
        },
        required: ["circuito", "mensaje_id", "duracion_min"],
        additionalProperties: false,
      },
    },
    metricas: {
      type: ["object", "null"],
      properties: {
        deficit_mw: { type: ["number", "null"] },
        servido_mw: { type: ["number", "null"] },
      },
      required: ["deficit_mw", "servido_mw"],
      additionalProperties: false,
    },
  },
  required: ["cambios", "confirmaciones", "metricas"],
  additionalProperties: false,
};

const plain = (text: string) =>
  text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u200b/g, "")
    .trim();

const havana = (ts: number) =>
  new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Havana",
  }).format(new Date(ts * 1000));

function buildUser(input: LlmInput): string {
  const afectados = input.state.circuits
    .filter((c) => c.status === "out")
    .map((c) => {
      const info = byId.get(c.id);
      return {
        id: c.id,
        nombre: info?.name ?? c.id,
        municipio: info?.municipio ?? "",
        desde: c.since != null ? havana(c.since) : null,
        minutos_afectado:
          c.since != null ? Math.max(0, Math.round((input.now - c.since) / 60)) : null,
      };
    });

  return JSON.stringify({
    ahora: havana(input.now),
    catalogo: CATALOG_TEXT,
    estado_actual: {
      afectados,
      metricas: {
        deficit_mw: input.state.province.deficit_mw,
        servido_mw: input.state.province.served_mw,
      },
    },
    mensajes: input.messages.map((m) => ({
      id: m.id,
      fecha: havana(m.date),
      texto: plain(m.text),
    })),
  });
}

/** Pregunta al modelo. Devuelve un error explícito si falla o no cumple el esquema. */
export async function decide(
  ai: AiBinding,
  model: string,
  input: LlmInput,
): Promise<DecisionResult> {
  let raw: unknown;
  try {
    raw = await withTimeout(
      ai.run(model, {
        messages: [
          { role: "system", content: SYSTEM },
          ...FEW_SHOT,
          { role: "user", content: buildUser(input) },
        ],
        response_format: { type: "json_schema", json_schema: SCHEMA },
        temperature: 0,
        max_tokens: 4096,
      }),
      TIMEOUT_MS,
    );
  } catch (err) {
    return { ok: false, error: `IA no disponible: ${(err as Error).message}` };
  }

  const parsed = LlmResult.safeParse(readJson((raw as { response?: unknown } | null)?.response));
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 4)
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `respuesta de IA inválida: ${detail}` };
  }
  return { ok: true, result: parsed.data };
}

/** Workers AI devuelve el objeto ya parseado; algunos modelos lo devuelven como texto. */
function readJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Una cifra provincial fuera de rango es un error de lectura, no un dato. */
export function plausibleMW(n: number | null): number | null {
  return n != null && Number.isFinite(n) && n >= 0 && n <= MAX_PROVINCE_MW ? n : null;
}
