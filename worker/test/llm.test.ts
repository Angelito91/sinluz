import { describe, expect, test } from "bun:test";
import { decide, parseResult, SYSTEM_PROMPT, type AiBinding, type LlmInput } from "../src/llm";
import { catalogIds } from "../src/catalog";
import { emptyState } from "../src/state";

const state = {
  ...emptyState(1_700_000_000),
  circuits: [
    {
      id: "sc-08",
      status: "out" as const,
      since: 1_699_990_000,
      last_mention_at: 1_699_990_000,
      source_message_id: 1,
    },
  ],
};

const input: LlmInput = {
  now: 1_700_000_000,
  state,
  messages: [{ id: 10, date: 1_699_999_000, text: "Se restablece el servicio al circuito 8" }],
};

const fake = (response: unknown): AiBinding => ({ run: async () => ({ response }) });

describe("decide", () => {
  test("acepta una respuesta válida y calcula la duración en el servidor", async () => {
    const r = await decide(
      fake({
        cambios: [
          {
            circuito: "sc-08",
            estado: "out",
            mensaje_id: 10,
            duracion: { horas: 16, minutos: 20 },
          },
        ],
        metricas: null,
      }),
      "m",
      input,
    );

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.cambios).toEqual([
        { circuito: "sc-08", estado: "out", mensaje_id: 10, duracion_min: 980 },
      ]);
    }
  });

  test("convierte horas y minutos parciales", () => {
    const parsed = parseResult({
      cambios: [
        { circuito: "sc-08", estado: "out", mensaje_id: 10, duracion: { horas: 9, minutos: 0 } },
        { circuito: "sc-08", estado: "out", mensaje_id: 10, duracion: { horas: 0, minutos: 45 } },
        { circuito: "sc-08", estado: "out", mensaje_id: 10, duracion: null },
        { circuito: "sc-08", estado: "ok", mensaje_id: 10, duracion: { horas: null, minutos: null } },
      ],
      metricas: null,
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.result.cambios.map((c) => c.duracion_min)).toEqual([540, 45, null, null]);
    }
  });

  test("una duración mayor de 30 días se descarta", () => {
    const parsed = parseResult({
      cambios: [
        {
          circuito: "sc-08",
          estado: "out",
          mensaje_id: 10,
          duracion: { horas: 24 * 31, minutos: 0 },
        },
      ],
      metricas: null,
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.result.cambios[0]?.duracion_min).toBeNull();
  });

  test("acepta métricas con el mensaje que las respalda", () => {
    const parsed = parseResult({
      cambios: [],
      metricas: { deficit_mw: 100, servido_mw: 40, mensaje_id: 10 },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.result.metricas).toEqual({ deficit_mw: 100, servido_mw: 40, mensaje_id: 10 });
    }
  });

  test("rechaza una respuesta que no cumple el esquema", () => {
    expect(parseResult({ cambios: "nada" }).ok).toBe(false);
    expect(parseResult({ cambios: [], metricas: { deficit_mw: "100" } }).ok).toBe(false);
    expect(parseResult(undefined).ok).toBe(false);
  });

  test("rechaza JSON inválido entregado como texto", async () => {
    expect((await decide(fake("no soy json"), "m", input)).ok).toBe(false);
  });

  test("si el modelo falla, devuelve un error en vez de lanzar", async () => {
    const broken: AiBinding = {
      run: async () => {
        throw new Error("cuota diaria");
      },
    };
    const r = await decide(broken, "m", input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("transient");
      expect(r.error).toContain("cuota diaria");
    }
  });

  test("un contexto demasiado largo se marca como error inválido", async () => {
    const tooLong: AiBinding = {
      run: async () => {
        throw new Error("maximum context length exceeded");
      },
    };
    const r = await decide(tooLong, "m", input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("invalid");
  });

  test("manda catálogo, estado y mensajes, con temperatura 0 y JSON schema", async () => {
    let sent: any;
    const spy: AiBinding = {
      run: async (_model, body) => {
        sent = body;
        return { response: { cambios: [], metricas: null } };
      },
    };

    await decide(spy, "m", input);

    expect(sent.temperature).toBe(0);
    expect(sent.response_format.type).toBe("json_schema");
    expect(sent.max_tokens).toBe(4096);
    expect(sent.response_format.json_schema.required).toEqual(["cambios", "metricas"]);

    const user = JSON.parse(sent.messages[sent.messages.length - 1].content);
    expect(user.catalogo).toContain("sc-08");
    expect(user.estado_actual.afectados[0]).toMatchObject({ id: "sc-08", minutos_afectado: 167 });
    expect(user.estado_actual.metricas).toEqual({ deficit_mw: null, servido_mw: null });
    expect(user.mensajes[0]).toMatchObject({ id: 10 });
    expect(sent.messages[0].content).toContain("REGLA DE ORO");
  });

  test("limpia HTML y entidades antes de mandar los mensajes", async () => {
    let sent: any;
    const spy: AiBinding = {
      run: async (_model, body) => {
        sent = body;
        return { response: { cambios: [], metricas: null } };
      },
    };

    await decide(spy, "m", {
      ...input,
      messages: [{ id: 11, date: 1_699_999_100, text: "<b>Afectado</b><br>Circuito 8&nbsp;ya" }],
    });

    const user = JSON.parse(sent.messages[sent.messages.length - 1].content);
    expect(user.mensajes[0].texto).toBe("Afectado\nCircuito 8 ya");
  });
});

describe("prompt", () => {
  test("no pide confirmaciones y sí pide horas y minutos", () => {
    expect(SYSTEM_PROMPT).not.toContain("confirmaciones");
    expect(SYSTEM_PROMPT).toContain('"horas"');
    expect(SYSTEM_PROMPT).toContain('"minutos"');
  });

  test("explica que un circuito ya afectado sigue siendo out", () => {
    expect(SYSTEM_PROMPT).toContain("ya está en estado_actual.afectados");
  });

  test("todos los ids literales del prompt existen en el catálogo", () => {
    const ids = SYSTEM_PROMPT.match(/\b(?:sc|ct|pa|sl|slm|sm|gu|iif)-[a-z0-9-]+\b/g) ?? [];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(catalogIds.has(id)).toBe(true);
  });

  test("incluye la desambiguación de seccionalizados", () => {
    expect(SYSTEM_PROMPT).toContain("9 seccionalizado");
    expect(SYSTEM_PROMPT).toContain("17 seccionalizado");
    expect(SYSTEM_PROMPT).toContain("11 seccionalizado");
  });
});
