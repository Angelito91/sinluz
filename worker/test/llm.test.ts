import { describe, expect, test } from "bun:test";
import { decide, type AiBinding, type LlmInput } from "../src/llm";
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
  test("acepta una respuesta válida", async () => {
    const r = await decide(
      fake({
        cambios: [{ circuito: "sc-08", estado: "ok", mensaje_id: 10, duracion_min: null }],
        confirmaciones: [],
        metricas: null,
      }),
      "m",
      input,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.cambios).toEqual([
        { circuito: "sc-08", estado: "ok", mensaje_id: 10, duracion_min: null },
      ]);
      expect(r.result.confirmaciones).toEqual([]);
    }
  });

  test("acepta confirmaciones y metricas en español", async () => {
    const r = await decide(
      fake({
        cambios: [],
        confirmaciones: [{ circuito: "sc-08", mensaje_id: 10, duracion_min: 60 }],
        metricas: { deficit_mw: 100, servido_mw: 40 },
      }),
      "m",
      input,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.confirmaciones[0]).toMatchObject({ circuito: "sc-08", duracion_min: 60 });
      expect(r.result.metricas).toEqual({ deficit_mw: 100, servido_mw: 40 });
    }
  });

  test("rechaza una respuesta que no cumple el esquema", async () => {
    expect((await decide(fake({ cambios: "nada" }), "m", input)).ok).toBe(false);
    expect((await decide(fake({ cambios: [], metricas: { deficit_mw: "100" } }), "m", input)).ok).toBe(
      false,
    );
    expect((await decide(fake(undefined), "m", input)).ok).toBe(false);
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
    if (!r.ok) expect(r.error).toContain("cuota diaria");
  });

  test("acepta la forma y deja el rango de la duración al servidor", async () => {
    const r = await decide(
      fake({
        cambios: [
          { circuito: "sc-08", estado: "out", mensaje_id: 10, duracion_min: 99_000 },
        ],
        confirmaciones: [],
        metricas: null,
      }),
      "m",
      input,
    );
    expect(r.ok).toBe(true);
  });

  test("manda catálogo, estado y mensajes, con temperatura 0 y JSON schema", async () => {
    let sent: any;
    const spy: AiBinding = {
      run: async (_model, body) => {
        sent = body;
        return { response: { cambios: [], confirmaciones: [], metricas: null } };
      },
    };

    await decide(spy, "m", input);

    expect(sent.temperature).toBe(0);
    expect(sent.response_format.type).toBe("json_schema");
    expect(sent.max_tokens).toBe(4096);

    const user = JSON.parse(sent.messages[sent.messages.length - 1].content);
    expect(user.catalogo).toContain("sc-08");
    expect(user.estado_actual.afectados[0]).toMatchObject({ id: "sc-08", minutos_afectado: 167 });
    expect(user.estado_actual.metricas).toEqual({ deficit_mw: null, servido_mw: null });
    expect(user.mensajes[0]).toMatchObject({ id: 10 });
    expect(sent.messages[0].content).toContain("REGLA DE ORO");
    expect(sent.response_format.json_schema.required).toContain("confirmaciones");
  });

  test("limpia HTML y entidades antes de mandar los mensajes", async () => {
    let sent: any;
    const spy: AiBinding = {
      run: async (_model, body) => {
        sent = body;
        return { response: { cambios: [], confirmaciones: [], metricas: null } };
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
