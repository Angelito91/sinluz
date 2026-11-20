import { describe, expect, test } from "bun:test";
import { applyChanges, emptyState, mergeOverrides } from "../src/state";
import type { LlmResult, Message } from "../src/llm";

const msg = (id: number, date: number, text = ""): Message => ({ id, date, text });

const result = (
  cambios: LlmResult["cambios"],
  metrics: LlmResult["metrics"] = null,
): LlmResult => ({ cambios, metrics });

const T = 1_700_000_000;

describe("applyChanges", () => {
  test("un out nuevo usa la fecha del mensaje", () => {
    const s = applyChanges(
      emptyState(),
      [msg(1, T)],
      result([{ circuit_id: "sc-08", status: "out", source_message_id: 1, duration_min: null }]),
      T + 10,
    );

    expect(s.circuits).toEqual([
      {
        id: "sc-08",
        status: "out",
        since: T,
        last_mention_at: T,
        source_message_id: 1,
      },
    ]);
    expect(s.source.last_message_id).toBe(1);
    expect(s.generated_at).toBe(T + 10);
  });

  test("la duración publicada manda sobre la fecha del mensaje", () => {
    const s = applyChanges(
      emptyState(),
      [msg(1, T)],
      result([{ circuit_id: "sc-08", status: "out", source_message_id: 1, duration_min: 90 }]),
      T,
    );

    expect(s.circuits[0]?.since).toBe(T - 90 * 60);
  });

  test("un circuito ya afectado conserva su since si no hay duración", () => {
    const first = applyChanges(
      emptyState(),
      [msg(1, T)],
      result([{ circuit_id: "sc-08", status: "out", source_message_id: 1, duration_min: null }]),
      T,
    );
    const second = applyChanges(
      first,
      [msg(2, T + 3600)],
      result([{ circuit_id: "sc-08", status: "out", source_message_id: 2, duration_min: null }]),
      T + 3600,
    );

    expect(second.circuits[0]?.since).toBe(T);
    expect(second.circuits[0]?.last_mention_at).toBe(T + 3600);
    expect(second.circuits[0]?.source_message_id).toBe(2);
  });

  test("una duración imposible se ignora y se usa la fecha del mensaje", () => {
    const s = applyChanges(
      emptyState(),
      [msg(1, T)],
      result([{ circuit_id: "sc-08", status: "out", source_message_id: 1, duration_min: 99_000 }]),
      T,
    );

    expect(s.circuits[0]?.since).toBe(T);
  });

  test("ok elimina el circuito del estado", () => {
    const first = applyChanges(
      emptyState(),
      [msg(1, T)],
      result([{ circuit_id: "sc-08", status: "out", source_message_id: 1, duration_min: null }]),
      T,
    );
    const second = applyChanges(
      first,
      [msg(2, T + 60)],
      result([{ circuit_id: "sc-08", status: "ok", source_message_id: 2, duration_min: null }]),
      T + 60,
    );

    expect(second.circuits).toEqual([]);
  });

  test("gana el cambio del mensaje más reciente", () => {
    const s = applyChanges(
      emptyState(),
      [msg(1, T), msg(2, T + 60), msg(3, T + 120)],
      result([
        { circuit_id: "sc-08", status: "out", source_message_id: 1, duration_min: null },
        { circuit_id: "sc-08", status: "ok", source_message_id: 2, duration_min: null },
        { circuit_id: "sc-08", status: "out", source_message_id: 3, duration_min: 30 },
      ]),
      T + 120,
    );

    expect(s.circuits[0]).toMatchObject({ id: "sc-08", status: "out", since: T + 120 - 1800 });
  });

  test("una confirmación posterior conserva la duración del mismo lote", () => {
    const s = applyChanges(
      emptyState(),
      [msg(1, T), msg(2, T + 3600)],
      result([
        { circuit_id: "sc-08", status: "out", source_message_id: 1, duration_min: 540 },
        { circuit_id: "sc-08", status: "out", source_message_id: 2, duration_min: null },
      ]),
      T + 3600,
    );

    expect(s.circuits[0]).toMatchObject({
      id: "sc-08",
      since: T - 540 * 60,
      last_mention_at: T + 3600,
      source_message_id: 2,
    });
  });

  test("ignora circuitos y mensajes que no están en el lote", () => {
    const s = applyChanges(
      emptyState(),
      [msg(1, T)],
      result([
        { circuit_id: "no-existe", status: "out", source_message_id: 1, duration_min: null },
        { circuit_id: "sc-08", status: "out", source_message_id: 99, duration_min: null },
      ]),
      T,
    );

    expect(s.circuits).toEqual([]);
    expect(s.source.last_message_id).toBe(1);
  });

  test("aplica métricas válidas e ignora las imposibles", () => {
    const first = applyChanges(
      emptyState(),
      [msg(1, T)],
      result([], { deficit_mw: 100, served_mw: 40 }),
      T,
    );
    expect(first.province).toEqual({ deficit_mw: 100, served_mw: 40 });

    const second = applyChanges(
      first,
      [msg(2, T + 60)],
      result([], { deficit_mw: 1245, served_mw: null }),
      T + 60,
    );
    expect(second.province).toEqual({ deficit_mw: 100, served_mw: 40 });

    const third = applyChanges(second, [msg(3, T + 120)], result([], null), T + 120);
    expect(third.province).toEqual({ deficit_mw: 100, served_mw: 40 });
  });

  test("advanceCursor=false no mueve el cursor del canal", () => {
    const s = applyChanges(
      emptyState(),
      [msg(999, T)],
      result([{ circuit_id: "sc-08", status: "out", source_message_id: 999, duration_min: null }]),
      T,
      false,
    );

    expect(s.source.last_message_id).toBe(null);
    expect(s.circuits).toHaveLength(1);
  });
});

describe("mergeOverrides", () => {
  const base = applyChanges(
    emptyState(),
    [msg(1, T)],
    result([{ circuit_id: "sc-08", status: "out", source_message_id: 1, duration_min: null }]),
    T,
  );

  test("un override ok quita el circuito", () => {
    const s = mergeOverrides(base, [
      { circuit_id: "sc-08", status: "ok", since: null, updated_at: T + 60 },
    ]);
    expect(s.circuits).toEqual([]);
  });

  test("un override out añade o actualiza el circuito", () => {
    const s = mergeOverrides(base, [
      { circuit_id: "sc-09", status: "out", since: T - 100, updated_at: T + 60 },
    ]);
    expect(s.circuits.find((c) => c.id === "sc-09")).toMatchObject({
      status: "out",
      since: T - 100,
      source_message_id: null,
    });
  });
});
