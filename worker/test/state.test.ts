import { describe, expect, test } from "bun:test";
import { applyChanges, emptyState, mergeOverrides } from "../src/state";
import type { LlmResult, Message } from "../src/llm";

const msg = (id: number, date: number, text = ""): Message => ({ id, date, text });

const result = (
  cambios: LlmResult["cambios"],
  metricas: LlmResult["metricas"] = null,
): LlmResult => ({ cambios, metricas });

const T = 1_700_000_000;

describe("applyChanges", () => {
  test("un out nuevo usa la fecha del mensaje", () => {
    const s = applyChanges(
      emptyState(),
      [msg(1, T)],
      result([{ circuito: "sc-08", estado: "out", mensaje_id: 1, duracion_min: null }]),
      T + 10,
    );

    expect(s.circuits).toEqual([
      {
        id: "sc-08",
        status: "out",
        since: T,
        since_kind: "reported",
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
      result([{ circuito: "sc-08", estado: "out", mensaje_id: 1, duracion_min: 90 }]),
      T,
    );

    expect(s.circuits[0]?.since).toBe(T - 90 * 60);
  });

  test("un circuito ya afectado conserva su since si no hay duración", () => {
    const first = applyChanges(
      emptyState(),
      [msg(1, T)],
      result([{ circuito: "sc-08", estado: "out", mensaje_id: 1, duracion_min: null }]),
      T,
    );
    const second = applyChanges(
      first,
      [msg(2, T + 3600)],
      result([{ circuito: "sc-08", estado: "out", mensaje_id: 2, duracion_min: null }]),
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
      result([{ circuito: "sc-08", estado: "out", mensaje_id: 1, duracion_min: 99_000 }]),
      T,
    );

    expect(s.circuits[0]?.since).toBe(T);
  });

  test("ok elimina el circuito del estado", () => {
    const first = applyChanges(
      emptyState(),
      [msg(1, T)],
      result([{ circuito: "sc-08", estado: "out", mensaje_id: 1, duracion_min: null }]),
      T,
    );
    const second = applyChanges(
      first,
      [msg(2, T + 60)],
      result([{ circuito: "sc-08", estado: "ok", mensaje_id: 2, duracion_min: null }]),
      T + 60,
    );

    expect(second.circuits).toEqual([]);
  });

  test("aplica eventos en orden cronológico (restablece y vuelve a afectar)", () => {
    const s = applyChanges(
      emptyState(),
      [msg(1, T), msg(2, T + 60), msg(3, T + 120)],
      result([
        { circuito: "sc-08", estado: "out", mensaje_id: 1, duracion_min: null },
        { circuito: "sc-08", estado: "ok", mensaje_id: 2, duracion_min: null },
        { circuito: "sc-08", estado: "out", mensaje_id: 3, duracion_min: 30 },
      ]),
      T + 120,
    );

    expect(s.circuits[0]).toMatchObject({ id: "sc-08", status: "out", since: T + 120 - 1800 });
  });

  test("volver a listar un circuito afectado refresca la mención sin mover el inicio", () => {
    const first = applyChanges(
      emptyState(),
      [msg(1, T)],
      result([{ circuito: "sc-08", estado: "out", mensaje_id: 1, duracion_min: 540 }]),
      T,
    );
    const second = applyChanges(
      first,
      [msg(2, T + 3600)],
      result([{ circuito: "sc-08", estado: "out", mensaje_id: 2, duracion_min: null }]),
      T + 3600,
    );

    expect(second.circuits[0]).toMatchObject({
      id: "sc-08",
      since: T - 540 * 60,
      last_mention_at: T + 3600,
      source_message_id: 2,
    });
  });

  test("una duración explícita no rejuvenece un since mucho más antiguo", () => {
    const first = applyChanges(
      emptyState(),
      [msg(1, T)],
      result([{ circuito: "sc-08", estado: "out", mensaje_id: 1, duracion_min: 24 * 60 }]),
      T,
    );
    const prevSince = first.circuits[0]!.since;
    const second = applyChanges(
      first,
      [msg(2, T + 3600)],
      result([{ circuito: "sc-08", estado: "out", mensaje_id: 2, duracion_min: 60 }]),
      T + 3600,
    );

    expect(second.circuits[0]?.since).toBe(prevSince);
    expect(second.circuits[0]?.last_mention_at).toBe(T + 3600);
  });

  test("restablece y vuelve a afectar en el mismo lote reinicia el since", () => {
    const first = applyChanges(
      emptyState(),
      [msg(1, T - 7200)],
      result([{ circuito: "sc-08", estado: "out", mensaje_id: 1, duracion_min: null }]),
      T - 7200,
    );
    const second = applyChanges(
      first,
      [msg(2, T), msg(3, T + 600)],
      result([
        { circuito: "sc-08", estado: "ok", mensaje_id: 2, duracion_min: null },
        { circuito: "sc-08", estado: "out", mensaje_id: 3, duracion_min: null },
      ]),
      T + 600,
    );

    expect(second.circuits[0]).toMatchObject({
      id: "sc-08",
      status: "out",
      since: T + 600,
      since_kind: "reported",
    });
  });

  test("ignora circuitos y mensajes que no están en el lote", () => {
    const s = applyChanges(
      emptyState(),
      [msg(1, T)],
      result([
        { circuito: "no-existe", estado: "out", mensaje_id: 1, duracion_min: null },
        { circuito: "sc-08", estado: "out", mensaje_id: 99, duracion_min: null },
      ]),
      T,
    );

    expect(s.circuits).toEqual([]);
    expect(s.source.last_message_id).toBe(1);
  });

  test("aplica métricas válidas e ignora las imposibles", () => {
    const first = applyChanges(
      emptyState(),
      [msg(1, T, "La provincia tiene 100 MW afectados y 40 MW con servicio")],
      result([], { deficit_mw: 100, servido_mw: 40, mensaje_id: 1 }),
      T,
    );
    expect(first.province).toEqual({ deficit_mw: 100, served_mw: 40 });

    const second = applyChanges(
      first,
      [msg(2, T + 60, "Actualización: 1245 MW afectados")],
      result([], { deficit_mw: 1245, servido_mw: null, mensaje_id: 2 }),
      T + 60,
    );
    expect(second.province).toEqual({ deficit_mw: 100, served_mw: 40 });

    const third = applyChanges(second, [msg(3, T + 120)], result([], null), T + 120);
    expect(third.province).toEqual({ deficit_mw: 100, served_mw: 40 });
  });

  test("ignora métricas si el mensaje citado no habla de MW", () => {
    const s = applyChanges(
      emptyState(),
      [msg(1, T, "Tenemos 333 quejas y 42 transformadores dañados")],
      result([], { deficit_mw: 333, servido_mw: 42, mensaje_id: 1 }),
      T,
    );

    expect(s.province).toEqual({ deficit_mw: null, served_mw: null });
  });

  test("ignora métricas sin mensaje_id o con un id ajeno al lote", () => {
    const batch = [msg(1, T, "100 MW afectados")];
    const withoutId = applyChanges(
      emptyState(),
      batch,
      result([], { deficit_mw: 100, servido_mw: null, mensaje_id: null }),
      T,
    );
    const otherId = applyChanges(
      emptyState(),
      batch,
      result([], { deficit_mw: 100, servido_mw: null, mensaje_id: 99 }),
      T,
    );

    expect(withoutId.province.deficit_mw).toBeNull();
    expect(otherId.province.deficit_mw).toBeNull();
  });

  test("advanceCursor=false no mueve el cursor del canal", () => {
    const s = applyChanges(
      emptyState(),
      [msg(999, T)],
      result([{ circuito: "sc-08", estado: "out", mensaje_id: 999, duracion_min: null }]),
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
    result([{ circuito: "sc-08", estado: "out", mensaje_id: 1, duracion_min: null }]),
    T,
  );

  test("un override ok quita el circuito", () => {
    const s = mergeOverrides(base, [
      { circuit_id: "sc-08", status: "ok", since: null, updated_at: T + 60 },
    ]);
    expect(s.circuits).toEqual([]);
  });

  test("un override ok no se aplica si el out es más reciente", () => {
    const s = mergeOverrides(
      base,
      [{ circuit_id: "sc-08", status: "ok", since: null, updated_at: T - 60 }],
      T,
    );
    expect(s.circuits.map((c) => c.id)).toEqual(["sc-08"]);
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

  test("un override out caduca pasadas las horas configuradas", () => {
    const overrides = [
      { circuit_id: "sc-09", status: "out", since: T - 100, updated_at: T },
    ];
    expect(mergeOverrides(base, overrides, T + 3600, 2 * 3600).circuits).toHaveLength(2);
    expect(mergeOverrides(base, overrides, T + 3 * 3600, 2 * 3600).circuits).toHaveLength(1);
  });

  test("un override ok no caduca por TTL", () => {
    const s = mergeOverrides(
      base,
      [{ circuit_id: "sc-08", status: "ok", since: null, updated_at: T + 60 }],
      T + 100_000,
      3600,
    );
    expect(s.circuits).toEqual([]);
  });
});
