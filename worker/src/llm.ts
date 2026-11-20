import { z } from "zod";
import type { StatusPayload } from "@sinluz/shared";
import { byId, catalog } from "./catalog";

/**
 * Interpretación de los avisos con Workers AI.
 *
 * El modelo es el único intérprete: recibe el estado actual, el catálogo y los
 * mensajes nuevos, y devuelve los cambios. No hay reglas ni emparejador de
 * alias como respaldo. Si falla o devuelve algo inválido, el estado no se toca.
 */

/** Lo único que usamos del binding `AI` de Cloudflare. */
export type AiBinding = { run(model: string, input: unknown): Promise<unknown> };

export const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const TIMEOUT_MS = 20_000;
export const MAX_DURATION_MIN = 7 * 24 * 60;
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
  circuit_id: z.string(),
  status: z.enum(["out", "ok"]),
  source_message_id: z.number().int(),
  duration_min: z.number().int().nullable(),
});
export type LlmChange = z.infer<typeof LlmChange>;

export const LlmResult = z.object({
  cambios: z.array(LlmChange),
  metrics: z
    .object({
      deficit_mw: z.number().nullable(),
      served_mw: z.number().nullable(),
    })
    .nullable(),
});
export type LlmResult = z.infer<typeof LlmResult>;

export type DecisionResult =
  | { ok: true; result: LlmResult }
  | { ok: false; error: string };

const CATALOG_TEXT = catalog
  .map((c) => `${c.id} | ${c.name} | ${c.municipio} | ${c.aliases.join(", ")}`)
  .join("\n");

const SYSTEM = `Eres el intérprete de los avisos del canal oficial de Telegram de la Empresa
Eléctrica de Santiago de Cuba. Conviertes mensajes nuevos en cambios de estado
de circuitos y en cifras de la provincia. No eres un asistente conversacional:
tu única salida es un objeto JSON.

ENTRADA
Recibes un objeto JSON con:
- ahora: fecha y hora actual en La Habana.
- catalogo: circuitos válidos, uno por línea, con formato:
  id | nombre | municipio | alias separados por comas.
- estado_actual:
  - afectados: circuitos que ahora están sin servicio, con id, nombre,
    municipio, desde y minutos_afectado.
  - deficit_mw y served_mw: cifras vigentes de la provincia.
- mensajes: mensajes nuevos en orden cronológico, cada uno con id, fecha y texto.

Los circuitos que no aparecen en estado_actual.afectados están con servicio.

SALIDA
Devuelve SOLO este JSON, sin markdown, sin explicaciones y sin texto adicional:

{
  "cambios": [
    {
      "circuit_id": "id exacto del catálogo",
      "status": "out" | "ok",
      "source_message_id": 123,
      "duration_min": 980
    }
  ],
  "metrics": { "deficit_mw": 100, "served_mw": 40 }
}

Reglas de forma:
- "cambios" siempre es un array; puede estar vacío.
- "duration_min" es un entero de minutos o null. Solo se usa con "out".
- "metrics" es un objeto o null. null significa "no cambies las cifras".
- No devuelvas circuitos que el mensaje no menciona. No existe el estado
  "none": simplemente omite el circuito.
- Un solo cambio por circuito. Si aparece en varios mensajes, usa el mensaje
  más reciente y su source_message_id.

QUÉ SIGNIFICA "out"
Devuelve "out" cuando el mensaje afirma que el circuito:
- está sin servicio o afectado;
- está afectado por déficit de generación;
- está disparado, averiado o fuera de servicio;
- se incorpora, se suma o entra a la afectación;
- aparece en una lista de "circuitos con mayor tiempo de afectación",
  "circuitos afectados" o "actualización de los circuitos afectados".

QUÉ SIGNIFICA "ok"
Devuelve "ok" cuando el mensaje afirma que el circuito:
- se restablece o vuelve el servicio;
- se encuentra con servicio;
- aparece en una lista de "se encuentran con servicio" o
  "con servicio: Circuito ...".

NO CAMBIES NINGÚN CIRCUITO cuando solo aparece en:
- quejas, averías individuales reportadas por clientes, recomendaciones o
  publicidad;
- cifras de MW sin una lista de circuitos (en ese caso solo cambian "metrics");
- avisos sobre el SEN, el sistema nacional, otra provincia o el país.

REGLA DE ORO
Nunca deduzcas por omisión. Que un circuito no aparezca en una lista NO
significa que esté restablecido. Solo devuelve "ok" si el mensaje lo dice
explícitamente.

Las listas "con mayor tiempo de afectación" y "actualización de los circuitos
afectados" son parciales: marca "out" solo los listados y no toques a los demás.

Excepción: si el mensaje dice explícitamente que se restablece "toda la
provincia", "todos los circuitos" o "el servicio queda restablecido", devuelve
"ok" para todos los circuitos de estado_actual.afectados.

Si un circuito ya está afectado y el mensaje confirma que continúa (por ejemplo,
aparece otra vez en una lista de afectados), devuélvelo como "out". Así se
actualiza la última confirmación, aunque el inicio no cambie. Si el mensaje
añade una duración nueva, incluye esa duration_min; el servidor conservará el
inicio anterior si no hay duración.

DESAMBIGUACIÓN
- "Circuito N" sin municipio = Santiago de Cuba (ids sc-NN).
- "Circuito N de Palma" o "Circuito N Palma" = pal-NN.
- "Circuito N de Contramaestre" o "Circuito N Contramaestre" = cta-NN.
- Si el mensaje está dividido por municipios o encabezados ("Santiago:",
  "Palma:", "Contramaestre:"), usa ese encabezado para los números que
  aparecen debajo.
- Para líneas, el número de línea (4385, 4390, 5390, 5395, 5975...) es la
  identidad principal. El municipio que lo acompaña es una pista y puede estar
  mal escrito; si el número existe en el catálogo, usa ese id.
- "ll Frente" = Línea II Frente; "lll Frente" = Línea III Frente.
- "Circuito 9 seccionalizado" es el circuito 9: "seccionalizado" describe el
  tramo, no crea otro circuito.
- Un número entre paréntesis después de una línea es su seccionalizado y no
  cambia la identidad: "Línea 4395Contramaestre(5175)" es la línea 4395.
- "3+2" son los circuitos 3 y 2. "1 y 2 de Contramaestre" son los circuitos 1 y
  2 de Contramaestre. Expande siempre esas listas.
- "Ramal" o "Subestación" con nombre propio se buscan en los alias del catálogo
  (por ejemplo, "Ramal Hospital Contramaestre").
- Usa los alias del catálogo, el municipio, el estado actual y el resto del
  mensaje como contexto.
- Si dos circuitos encajan y el mensaje no permite decidir, no devuelvas cambio
  para ese circuito. No adivines.
- No inventes circuitos ni ids. Usa exactamente los ids del catálogo.

DURACIONES
- "16 horas y 20 minutos" -> 980.
- "9 horas" -> 540.
- "45 minutos" -> 45.
- Solo si el mensaje dice explícitamente cuánto lleva afectado el circuito.
- Si no lo dice, duration_min = null.
- Si el valor supera 10 080 minutos (7 días), usa null: probablemente no es una
  duración real.

CIFRAS
- "metrics" solo con cifras de la provincia de Santiago de Cuba.
- "MW afectados", "déficit" o "afectación" -> deficit_mw.
- "MW servidos", "MW con servicio" o "con servicio X MW" -> served_mw.
- Un guion antes de la cifra casi siempre es un separador, no un negativo:
  "MW Afectados -40" significa 40 MW afectados.
- Si solo viene una cifra, la otra es null.
- Si hay varias cifras en el lote, usa las del mensaje más reciente.
- Si el mensaje habla del SEN, del país o de otra provincia, metrics = null.
- No repitas las cifras de estado_actual si el mensaje no las actualiza.
- Rango plausible: 0 a 600 MW. Fuera de ese rango, usa null.

RUIDO
- El texto puede traer <br>, emojis, flechas, negritas y errores de formato.
  Ignóralos para interpretar.
- Ignora teléfonos, enlaces, nombres de personas, mensajes políticos y
  publicidad.
- Si no hay cambios ni cifras nuevas:
  {"cambios":[],"metrics":null}

EJEMPLOS

Ejemplo 1
estado_actual: [{ "id": "sc-08", "desde": "2026-11-19 14:10" }]
mensajes: [{
  "id": 501,
  "fecha": "2026-11-19 20:15",
  "texto": "Se restablece el servicio eléctrico al circuito 8 de Santiago."
}]
Salida:
{"cambios":[{"circuit_id":"sc-08","status":"ok","source_message_id":501,"duration_min":null}],"metrics":null}

Ejemplo 2
mensajes: [{
  "id": 502,
  "texto": "Circuitos con mayor tiempo de afectación:\\nCircuito 1 ➡️ 9 horas\\nLínea 4390-Contramaestre ➡️ 16 horas y 20 minutos"
}]
Salida:
{"cambios":[{"circuit_id":"sc-01","status":"out","source_message_id":502,"duration_min":540},{"circuit_id":"line-4390","status":"out","source_message_id":502,"duration_min":980}],"metrics":null}

Ejemplo 3
mensajes: [{
  "id": 503,
  "texto": "Se afecta el servicio eléctrico en los siguientes circuitos:\\n8\\n9\\n12"
}]
Salida:
{"cambios":[{"circuit_id":"sc-08","status":"out","source_message_id":503,"duration_min":null},{"circuit_id":"sc-09","status":"out","source_message_id":503,"duration_min":null},{"circuit_id":"sc-12","status":"out","source_message_id":503,"duration_min":null}],"metrics":null}

Ejemplo 4
mensajes: [{
  "id": 504,
  "texto": "En estos momentos la provincia tiene 100 MW afectados. Con servicio 40 MW."
}]
Salida:
{"cambios":[],"metrics":{"deficit_mw":100,"served_mw":40}}

Ejemplo 5
mensajes: [{
  "id": 505,
  "texto": "Situación del SEN: MW Afectados 1245, MW Servidos 1800."
}]
Salida:
{"cambios":[],"metrics":null}

Ejemplo 6
mensajes: [{
  "id": 506,
  "texto": "Estimados clientes, para reportar averías llame al 18888."
}]
Salida:
{"cambios":[],"metrics":null}

RECORDATORIO FINAL
- Un cambio sin mensaje que lo respalde no existe: source_message_id debe ser
  el id de un mensaje del lote.
- Si dudas entre dos circuitos, no devuelvas ninguno de los dos.
- Si no hay cambios: {"cambios":[],"metrics":null}`;

const SCHEMA = {
  type: "object",
  properties: {
    cambios: {
      type: "array",
      items: {
        type: "object",
        properties: {
          circuit_id: { type: "string" },
          status: { type: "string", enum: ["out", "ok"] },
          source_message_id: { type: "integer" },
          duration_min: { type: ["integer", "null"] },
        },
        required: ["circuit_id", "status", "source_message_id", "duration_min"],
        additionalProperties: false,
      },
    },
    metrics: {
      type: ["object", "null"],
      properties: {
        deficit_mw: { type: ["number", "null"] },
        served_mw: { type: ["number", "null"] },
      },
      required: ["deficit_mw", "served_mw"],
      additionalProperties: false,
    },
  },
  required: ["cambios", "metrics"],
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
      deficit_mw: input.state.province.deficit_mw,
      served_mw: input.state.province.served_mw,
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
  if (!parsed.success) return { ok: false, error: "respuesta de IA inválida" };
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
