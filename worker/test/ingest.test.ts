import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AiBinding } from "../src/llm";
import { ingest } from "../src/ingest";
import { getStoredState, type Env } from "../src/store";
import { makeEnv, schema } from "./helpers";

let db: Database;
let env: Env;
const realFetch = globalThis.fetch;

const telegram = (messages: { id: number; date: number; message: string }[]) => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ messages }), {
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
};

const twoMessages = [
  {
    id: 2,
    date: 200,
    message: "Se restablece el servicio al circuito 8. 100 MW afectados y 40 MW con servicio",
  },
  { id: 1, date: 100, message: "Se afecta el servicio al circuito 8" },
];

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(schema);
  env = makeEnv(db);
  telegram(twoMessages);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  db.close();
});

const ai = (response: unknown): AiBinding => ({ run: async () => ({ response }) });

describe("ingest", () => {
  test("si el modelo falla de forma transitoria no guarda estado ni avanza el cursor", async () => {
    env.AI = {
      run: async () => {
        throw new Error("cuota diaria");
      },
    };

    const result = await ingest(env, "test");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("cuota diaria");
    const state = await getStoredState(env);
    expect(state.source.last_message_id).toBe(null);
    expect(state.circuits).toEqual([]);
  });

  test("una respuesta inválida se descarta mensaje a mensaje y el cursor avanza", async () => {
    env.AI = ai({ cambios: "nada" });

    const result = await ingest(env, "test");

    expect(result).toMatchObject({ ok: true, processed: 2, changes: 0, discarded: [1, 2] });
    const state = await getStoredState(env);
    expect(state.source.last_message_id).toBe(2);
    expect(state.circuits).toEqual([]);
  });

  test("aplica el lote y avanza el cursor al último mensaje", async () => {
    env.AI = ai({
      cambios: [{ circuito: "sc-08", estado: "out", mensaje_id: 1, duracion_min: null }],
      metricas: { deficit_mw: 100, servido_mw: 40, mensaje_id: 2 },
    });

    const result = await ingest(env, "test");

    expect(result).toMatchObject({ ok: true, processed: 2, changes: 1 });
    const state = await getStoredState(env);
    expect(state.source.last_message_id).toBe(2);
    expect(state.province).toEqual({ deficit_mw: 100, served_mw: 40 });
    expect(state.circuits).toHaveLength(1);
    expect(state.circuits[0]?.id).toBe("sc-08");
  });

  test("un id inventado no cambia el estado pero el cursor sí avanza", async () => {
    env.AI = ai({
      cambios: [{ circuito: "no-existe", estado: "out", mensaje_id: 1, duracion_min: null }],
      metricas: null,
    });

    await ingest(env, "test");

    const state = await getStoredState(env);
    expect(state.circuits).toEqual([]);
    expect(state.source.last_message_id).toBe(2);
  });

  test("un lote válido se guarda aunque el siguiente falle", async () => {
    let calls = 0;
    env.AI = {
      run: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            response: {
              cambios: [
                { circuito: "sc-08", estado: "out", mensaje_id: 1, duracion_min: null },
              ],
              metricas: null,
            },
          };
        }
        throw new Error("timeout");
      },
    };
    telegram(
      Array.from({ length: 16 }, (_, i) => ({
        id: i + 1,
        date: 100 + i,
        message: "Se afecta el servicio al circuito 8",
      })),
    );

    const result = await ingest(env, "test");

    expect(result.ok).toBe(false);
    expect(result.processed).toBe(12);
    expect(result.detail).toContain("12 guardados");
    expect(result.detail).toContain("4 pendientes");
    const state = await getStoredState(env);
    expect(state.source.last_message_id).toBe(12);
    expect(state.circuits).toHaveLength(1);
  });

  test("aísla el mensaje inválido y procesa los demás", async () => {
    env.AI = {
      run: async (_model, body) => {
        const content = JSON.stringify(body);
        if (content.includes("mensaje roto")) return { response: { cambios: "nada" } };
        return { response: { cambios: [], metricas: null } };
      },
    };
    telegram([
      { id: 1, date: 100, message: "Se afecta el circuito 8" },
      { id: 2, date: 200, message: "mensaje roto" },
      { id: 3, date: 300, message: "Se restablece el circuito 8" },
    ]);

    const result = await ingest(env, "test");

    expect(result).toMatchObject({ ok: true, processed: 3, discarded: [2] });
    expect((await getStoredState(env)).source.last_message_id).toBe(3);
  });

  test("sin mensajes nuevos solo actualiza generated_at", async () => {
    env.AI = ai({ cambios: [], metricas: null });
    telegram([]);

    const before = await getStoredState(env);
    const result = await ingest(env, "test");
    const after = await getStoredState(env);

    expect(result).toMatchObject({ ok: true, processed: 0 });
    expect(after.generated_at).toBeGreaterThanOrEqual(before.generated_at);
    expect(after.source.last_message_id).toBe(null);
  });
});
