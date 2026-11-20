import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { StatusPayload } from "@sinluz/shared";
import {
  clearCircuitOverride,
  getSetting,
  getSnapshot,
  getStoredState,
  lastIngest,
  logIngest,
  saveState,
  setCircuitOverride,
  setSetting,
  touchState,
  type Env,
} from "../src/store";
import { emptyState } from "../src/state";
import { makeEnv, schema } from "./helpers";

let db: Database;
let env: Env;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(schema);
  env = makeEnv(db);
});
afterEach(() => db.close());

const withOut = (since = 100): StatusPayload => ({
  ...emptyState(100),
  source: { channel: "@electricastgo", last_message_id: 10, last_message_at: 200 },
  circuits: [
    {
      id: "sc-08",
      status: "out",
      since,
      last_mention_at: 200,
      source_message_id: 10,
    },
  ],
});

describe("snapshot", () => {
  test("sin fila devuelve un estado vacío", async () => {
    expect(await getStoredState(env)).toEqual(emptyState(0));
  });

  test("guarda y recupera solo circuitos afectados", async () => {
    const state = withOut();
    state.circuits.push({
      id: "sc-09",
      status: "ok",
      since: null,
      last_mention_at: null,
      source_message_id: null,
    });

    await saveState(env, state);
    const stored = await getStoredState(env);

    expect(stored.source.last_message_id).toBe(10);
    expect(stored.circuits.map((c) => c.id)).toEqual(["sc-08"]);
  });

  test("una fila corrupta se ignora", async () => {
    db.query("INSERT INTO state_snapshot (id, payload, generated_at) VALUES (1, ?, 1)").run("{no json");
    expect(await getStoredState(env)).toEqual(emptyState(0));
  });

  test("touchState solo mueve generated_at", async () => {
    await saveState(env, withOut());
    await touchState(env, 500);
    const stored = await getStoredState(env);

    expect(stored.generated_at).toBe(500);
    expect(stored.circuits).toEqual(withOut().circuits);
  });
});

describe("overrides", () => {
  test("se aplican al leer y no tocan el snapshot", async () => {
    await saveState(env, withOut());

    const afterOk = await setCircuitOverride(env, "sc-08", "ok", null);
    expect(afterOk.circuits).toEqual([]);
    expect((await getStoredState(env)).circuits).toHaveLength(1);

    const afterOut = await setCircuitOverride(env, "sc-09", "out", 50);
    expect(afterOut.circuits.find((c) => c.id === "sc-09")).toMatchObject({
      status: "out",
      since: 50,
      source_message_id: null,
    });

    await clearCircuitOverride(env, "sc-09");
    const final = await getSnapshot(env);
    expect(final.circuits).toEqual([]);
  });
});

describe("settings e ingesta", () => {
  test("lee y escribe settings", async () => {
    expect(await getSetting(env, "backoff_until")).toBe(null);
    await setSetting(env, "backoff_until", "123");
    expect(await getSetting(env, "backoff_until")).toBe("123");
  });

  test("registra la última ingesta", async () => {
    await logIngest(env, "cron", true, "2 mensajes");
    const last = await lastIngest(env);
    expect(last).toMatchObject({ source: "cron", ok: 1, detail: "2 mensajes" });
    expect(last?.at).toBeGreaterThan(0);
  });
});
