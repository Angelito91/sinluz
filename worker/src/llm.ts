import { z } from "zod";
import type { StatusPayload } from "@sinluz/shared";
import { byId, catalog } from "./catalog";

export type AiBinding = { run(model: string, input: unknown): Promise<unknown> };

export const DEFAULT_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";
const TIMEOUT_MS = 60_000;
export const MAX_DURATION_MIN = 30 * 24 * 60;
const MAX_PROVINCE_MW = 600;

export type Message = { id: number; date: number; text: string };

export type LlmInput = {
  now: number;
  state: StatusPayload;
  messages: Message[];
};

export const LlmChange = z.object({
  circuito: z.string(),
  estado: z.enum(["out", "ok"]),
  mensaje_id: z.number().int(),
  duracion_min: z.number().int().nullable(),
});
export type LlmChange = z.infer<typeof LlmChange>;

export const LlmMetrics = z.object({
  deficit_mw: z.number().nullable(),
  servido_mw: z.number().nullable(),
  mensaje_id: z.number().int().nullable(),
});
export type LlmMetrics = z.infer<typeof LlmMetrics>;

export const LlmResult = z.object({
  cambios: z.array(LlmChange),
  metricas: LlmMetrics.nullable(),
});
export type LlmResult = z.infer<typeof LlmResult>;

export type DecisionResult =
  | { ok: true; result: LlmResult }
  | { ok: false; kind: "transient" | "invalid"; error: string };

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

const idForAlias = (alias: string): string => {
  const key = norm(alias);
  return catalog.find((c) => c.aliases.some((a) => norm(a) === key))?.id ?? "sin alias";
};

const seccionalizados = catalog.filter((c) => /-(?:sd|si)\d+$/i.test(c.id));
const santiagoBase = catalog.filter((c) => /^sc-\d{2}$/.test(c.id));
const lineas = catalog.filter((c) => c.kind === "linea");
const ids5390 = catalog
  .filter((c) => c.id.includes("5390") || c.aliases.some((a) => /\b5390\b/.test(a)))
  .map((c) => c.id);
const palmaIds = catalog.filter((c) => c.id.includes("palma")).map((c) => c.id);
const hospitalId =
  catalog.find(
    (c) => c.id.includes("hospital") || c.aliases.some((a) => norm(a).includes("hospital")),
  )?.id ?? "sin alias";

const santiagoBaseIds = santiagoBase.map((c) => c.id).join(", ");
const seccionalizadoIds = seccionalizados.map((c) => c.id).join(", ");
const lineExamples = lineas
  .slice(0, 6)
  .map((c) => `${c.id} (${c.name})`)
  .join(", ");

const CATALOG_TEXT = catalog
  .map((c) => `${c.id} | ${c.name} | ${c.municipio} | ${c.aliases.join(", ")}`)
  .join("\n");

export const SYSTEM_PROMPT = `Eres el intérprete de los avisos del canal oficial de Telegram de la Empresa Eléctrica de Santiago de Cuba.
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
      "duracion": { "horas": 16, "minutos": 20 }
    }
  ],
  "metricas": { "deficit_mw": 100, "servido_mw": 40, "mensaje_id": 123 }
}

Reglas de forma:
- "cambios" siempre es un array; puede estar vacío.
- "metricas" es un objeto o null. null significa "no cambies las cifras".
- "duracion" es null o un objeto con "horas" y "minutos" enteros. Solo tiene sentido con "out". No calcules el total de minutos: el servidor lo hace.
- No existe el estado "none": si no hay evidencia, omite el circuito.
- "mensaje_id" debe ser el id del mensaje que contiene la evidencia del cambio o de las métricas. No uses un mensaje que no menciona al circuito o las cifras.
- Puedes devolver varios cambios para el mismo circuito si el lote contiene un restablecimiento y después una nueva afectación. Aplícalos en orden cronológico lógico; no los fusiones.
- No copies "minutos_afectado" ni "desde" de estado_actual como duracion.
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

Si un circuito ya está en estado_actual.afectados y el mensaje lo vuelve a mencionar como afectado (por ejemplo, en "mayor tiempo de afectación"), devuélvelo igualmente como "out" con su duración. El servidor conserva el inicio anterior; no lo omitas.

### REGLA DE ORO
Nunca deduzcas por omisión. Que un circuito no aparezca en una lista NO significa que esté restablecido. Solo devuelve "ok" si el mensaje lo dice explícitamente.

Las listas "con mayor tiempo de afectación" y "actualización de los circuitos afectados" son parciales: marca out solo los listados y no toques a los demás.

Excepción: si el mensaje dice explícitamente que se restablece "toda la provincia", "todos los circuitos" o "el servicio queda restablecido", devuelve "ok" para todos los circuitos de estado_actual.afectados.
Si dice explícitamente que se restablecen todos los circuitos de un municipio nombrado, devuelve "ok" solo para los circuitos afectados de ese municipio en estado_actual.

### NO CAMBIAR CUANDO
- Son quejas, averías individuales reportadas por clientes, recomendaciones o publicidad.
- Solo hay cifras de MW sin lista de circuitos (solo cambia "metricas").
- Avisos sobre el SEN, sistema nacional, otra provincia o el país.
- Definiciones ("Disparo:", "Avería:" como explicación), resúmenes históricos ("ayer", "máxima afectación fue"), pronósticos/futuro ("mañana", "se realizará").
- Variaciones de voltaje/fluctuaciones sin indicar circuito fuera de servicio.

### DESAMBIGUACIÓN (usa el catálogo)
- "Circuito N" sin municipio = Santiago de Cuba. Ids base: ${santiagoBaseIds}. Si N no está en esa lista ni en las reglas siguientes (por ejemplo 4, 5 o 6), no lo inventes: usa el código si el mensaje lo trae o omite.
- "Circuito 9" = ${idForAlias("circuito 9")}; "9 seccionalizado" = ${idForAlias("9 seccionalizado")}.
- "Circuito 7" = ${idForAlias("circuito 7")}; "7 seccionalizado" = ${idForAlias("7 seccionalizado")}. Los códigos SD 3030 y SD 4630 distinguen las variantes.
- "17 seccionalizado" = ${idForAlias("17 seccionalizado")}; "11 seccionalizado" = ${idForAlias("11 seccionalizado")}.
- Seccionalizados con ID propio: ${seccionalizadoIds}. Usa el alias/código del catálogo; si el mensaje no permite decidir, omite.
- "1 y 2 de Contramaestre", "1 Contramaestre", "2 Contramaestre" = ct-contramaestre-01-02 (un solo id del catálogo).
- "3+2" = sc-03 y sc-02 (dos ids).
- Líneas/ramales: el número/código es la identidad principal. Ejemplos de IDs reales: ${lineExamples}.
- Si el mensaje trae un código entre paréntesis o tras "SD" (por ejemplo 5175), busca ese código en los alias del catálogo.
- "Línea 5390" sin código/municipio que la desambigüe (${ids5390.join(", ")}): omite si es ambigua.
- "Palma" solo no identifica circuito; omite. "Palma 1/2/4" sí (${palmaIds.join(", ")}).
- "Ramal"/"Subestación" con nombre propio: busca en alias del catálogo (por ejemplo "Ramal Hospital Contramaestre" -> ${hospitalId}).
- Si dos circuitos encajan y el mensaje no permite decidir, no devuelvas ninguno.
- Usa alias, municipio, estado_actual y contexto del mensaje. No adivines.

### DURACIONES
- Devuelve "duracion": { "horas": H, "minutos": M } con lo que diga el mensaje. No calcules minutos totales.
- "16 horas y 20 minutos" -> { "horas": 16, "minutos": 20 }. "9 horas" -> { "horas": 9, "minutos": 0 }. "45 minutos" -> { "horas": 0, "minutos": 45 }.
- "hora y media" -> { "horas": 1, "minutos": 30 }.
- Solo si el mensaje indica explícitamente cuánto lleva afectado.
- Si no hay duración explícita, "duracion": null. No inventes ni estimes.
- Si supera 30 días, usa null.

### MÉTRICAS
- "metricas" solo con cifras de la provincia de Santiago de Cuba.
- "MW afectados", "déficit" o "afectación" -> deficit_mw. "MW servidos"/"MW con servicio" -> servido_mw.
- Un guion antes de la cifra suele ser separador, no negativo: "MW Afectados -40" = 40.
- Si solo viene una cifra, la otra es null.
- Si hay varias en el lote, usa las del mensaje más reciente e incluye su "mensaje_id".
- Si el mensaje habla del SEN/país/otra provincia, metricas = null.
- No repitas cifras de estado_actual si el mensaje no las actualiza.
- No confundas quejas, transformadores, barriadas ni otros conteos con MW. Si no hay "MW" en el mensaje, metricas = null.
- Rango plausible: 0 a 600 MW. Fuera de rango, usa null.

### RUIDO
- Ignora <br>, emojis, flechas, negritas y errores de formato.
- Ignora teléfonos, enlaces, nombres de personas, mensajes políticos y publicidad.
- Si no hay cambios ni métricas nuevas: {"cambios":[],"metricas":null}`;

const FEW_SHOT: Array<{ role: "user" | "assistant"; content: string }> = [
  {
    role: "user",
    content: JSON.stringify({
      ahora: "2026-11-19 20:15",
      catalogo: "sc-08 | Circuito 8 | Santiago de Cuba | circuito 8",
      estado_actual: {
        afectados: [
          {
            id: "sc-08",
            nombre: "Circuito 8",
            municipio: "Santiago de Cuba",
            desde: "2026-11-19 14:10",
            minutos_afectado: 365,
          },
        ],
        metricas: { deficit_mw: 100, servido_mw: 40 },
      },
      mensajes: [
        {
          id: 501,
          fecha: "2026-11-19 20:15",
          texto: "Se restablece el servicio eléctrico al circuito 8 de Santiago.",
        },
      ],
    }),
  },
  {
    role: "assistant",
    content: JSON.stringify({
      cambios: [{ circuito: "sc-08", estado: "ok", mensaje_id: 501, duracion: null }],
      metricas: null,
    }),
  },
  {
    role: "user",
    content: JSON.stringify({
      ahora: "2026-11-19 21:00",
      catalogo:
        "sc-01 | Circuito 1 | Santiago de Cuba | circuito 1\nct-4390 | Linea 4390 | Contramaestre | 4390-Contramaestre",
      estado_actual: { afectados: [], metricas: null },
      mensajes: [
        {
          id: 502,
          fecha: "2026-11-19 21:00",
          texto:
            "Circuitos con mayor tiempo de afectación:\nCircuito 1 ➡️ 9 horas\nLínea 4390-Contramaestre ➡️ 16 horas y 20 minutos",
        },
      ],
    }),
  },
  {
    role: "assistant",
    content: JSON.stringify({
      cambios: [
        {
          circuito: "sc-01",
          estado: "out",
          mensaje_id: 502,
          duracion: { horas: 9, minutos: 0 },
        },
        {
          circuito: "ct-4390",
          estado: "out",
          mensaje_id: 502,
          duracion: { horas: 16, minutos: 20 },
        },
      ],
      metricas: null,
    }),
  },
  {
    role: "user",
    content: JSON.stringify({
      ahora: "2026-11-19 22:00",
      catalogo: "sc-25 | Circuito 25 | Santiago de Cuba | circuito 25",
      estado_actual: {
        afectados: [
          {
            id: "sc-25",
            nombre: "Circuito 25",
            municipio: "Santiago de Cuba",
            desde: "2026-11-18 20:00",
            minutos_afectado: 1560,
          },
        ],
        metricas: null,
      },
      mensajes: [
        {
          id: 503,
          fecha: "2026-11-19 22:00",
          texto: "Actualización de circuitos afectados por déficit:\nCircuito 25 ➡️ 26 horas",
        },
      ],
    }),
  },
  {
    role: "assistant",
    content: JSON.stringify({
      cambios: [
        {
          circuito: "sc-25",
          estado: "out",
          mensaje_id: 503,
          duracion: { horas: 26, minutos: 0 },
        },
      ],
      metricas: null,
    }),
  },
  {
    role: "user",
    content: JSON.stringify({
      ahora: "2026-11-19 22:30",
      catalogo: "sc-08 | Circuito 8 | Santiago de Cuba | circuito 8",
      estado_actual: { afectados: [], metricas: null },
      mensajes: [
        {
          id: 504,
          fecha: "2026-11-19 22:30",
          texto: "En estos momentos la provincia tiene 100 MW afectados. Con servicio 40 MW.",
        },
      ],
    }),
  },
  {
    role: "assistant",
    content: JSON.stringify({
      cambios: [],
      metricas: { deficit_mw: 100, servido_mw: 40, mensaje_id: 504 },
    }),
  },
  {
    role: "user",
    content: JSON.stringify({
      ahora: "2026-11-19 23:00",
      catalogo: "sc-08 | Circuito 8 | Santiago de Cuba | circuito 8",
      estado_actual: { afectados: [], metricas: null },
      mensajes: [
        {
          id: 505,
          fecha: "2026-11-19 23:00",
          texto:
            "Actualización de las quejas existentes en la Provincia. Actualmente tenemos reportadas un total de 333 quejas. Barriadas afectadas por interrupciones: 26. Transformadores dañados en la provincia: 42.",
        },
      ],
    }),
  },
  {
    role: "assistant",
    content: JSON.stringify({ cambios: [], metricas: null }),
  },
  {
    role: "user",
    content: JSON.stringify({
      ahora: "2026-11-19 23:30",
      catalogo:
        "sc-09-si4074 | Circuito 9-SI4074 | Santiago de Cuba | circuito 9, 9 de Santiago\nsc-09-si4615 | Circuito 9-SI4615 | Santiago de Cuba | 9 seccionalizado",
      estado_actual: { afectados: [], metricas: null },
      mensajes: [
        {
          id: 506,
          fecha: "2026-11-19 23:30",
          texto: "Se afecta el circuito 9 seccionalizado y se restablece el circuito 9.",
        },
      ],
    }),
  },
  {
    role: "assistant",
    content: JSON.stringify({
      cambios: [
        { circuito: "sc-09-si4615", estado: "out", mensaje_id: 506, duracion: null },
        { circuito: "sc-09-si4074", estado: "ok", mensaje_id: 506, duracion: null },
      ],
      metricas: null,
    }),
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
          duracion: {
            type: ["object", "null"],
            properties: {
              horas: { type: ["integer", "null"] },
              minutos: { type: ["integer", "null"] },
            },
            required: ["horas", "minutos"],
            additionalProperties: false,
          },
        },
        required: ["circuito", "estado", "mensaje_id", "duracion"],
        additionalProperties: false,
      },
    },
    metricas: {
      type: ["object", "null"],
      properties: {
        deficit_mw: { type: ["number", "null"] },
        servido_mw: { type: ["number", "null"] },
        mensaje_id: { type: ["integer", "null"] },
      },
      required: ["deficit_mw", "servido_mw", "mensaje_id"],
      additionalProperties: false,
    },
  },
  required: ["cambios", "metricas"],
  additionalProperties: false,
};

const RawDuration = z
  .object({
    horas: z.number().int().nullish().transform((v) => v ?? null),
    minutos: z.number().int().nullish().transform((v) => v ?? null),
  })
  .nullish()
  .transform((v) => v ?? null);

const RawChange = z.object({
  circuito: z.string(),
  estado: z.enum(["out", "ok"]),
  mensaje_id: z.number().int(),
  duracion: RawDuration,
});

const RawMetrics = z.object({
  deficit_mw: z.number().nullish().transform((v) => v ?? null),
  servido_mw: z.number().nullish().transform((v) => v ?? null),
  mensaje_id: z.number().int().nullish().transform((v) => v ?? null),
});

const RawResult = z.object({
  cambios: z.array(RawChange),
  metricas: RawMetrics.nullish().transform((v) => v ?? null),
});

function toMinutes(d: { horas: number | null; minutos: number | null } | null): number | null {
  if (d == null || (d.horas == null && d.minutos == null)) return null;
  const horas = d.horas ?? 0;
  const minutos = d.minutos ?? 0;
  if (horas < 0 || minutos < 0) return null;
  const total = horas * 60 + minutos;
  return total <= MAX_DURATION_MIN ? total : null;
}

export const plain = (text: string) =>
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

export function parseResult(raw: unknown): DecisionResult {
  const body = (raw as { response?: unknown } | null)?.response ?? raw;
  const parsed = RawResult.safeParse(readJson(body));
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 4)
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
    return { ok: false, kind: "invalid", error: `respuesta de IA inválida: ${detail}` };
  }

  return {
    ok: true,
    result: {
      cambios: parsed.data.cambios.map((c) => ({
        circuito: c.circuito,
        estado: c.estado,
        mensaje_id: c.mensaje_id,
        duracion_min: toMinutes(c.duracion),
      })),
      metricas: parsed.data.metricas
        ? {
            deficit_mw: parsed.data.metricas.deficit_mw,
            servido_mw: parsed.data.metricas.servido_mw,
            mensaje_id: parsed.data.metricas.mensaje_id,
          }
        : null,
    },
  };
}

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
          { role: "system", content: SYSTEM_PROMPT },
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
    const message = (err as Error).message;
    const kind = /context|too long|maximum.*(?:token|length)|prompt.*long/i.test(message)
      ? "invalid"
      : "transient";
    return { ok: false, kind, error: `IA no disponible: ${message}` };
  }

  return parseResult(raw);
}

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

export function plausibleMW(n: number | null): number | null {
  return n != null && Number.isFinite(n) && n >= 0 && n <= MAX_PROVINCE_MW ? n : null;
}
