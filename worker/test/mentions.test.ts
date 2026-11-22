import { describe, expect, test } from "bun:test";
import { filterLlmResult, hasUniversalReset, mentionsCircuit } from "../src/mentions";
import type { LlmResult, Message } from "../src/llm";

const msg = (id: number, text: string): Message => ({ id, date: 100 + id, text });

const result = (cambios: LlmResult["cambios"]): LlmResult => ({ cambios, metricas: null });

describe("mentionsCircuit", () => {
  test("reconoce el número y el alias del circuito", () => {
    expect(mentionsCircuit("Se afecta el circuito 8", "sc-08")).toBe(true);
    expect(mentionsCircuit("Se afecta el 9 seccionalizado", "sc-09-si4615")).toBe(true);
    expect(mentionsCircuit("Circuito 9 - SI 4074", "sc-09-si4074")).toBe(true);
  });

  test("no confunde un circuito con otro", () => {
    expect(mentionsCircuit("Se afecta el circuito 8", "sc-09-si4615")).toBe(false);
    expect(mentionsCircuit("Se restablece el circuito 25", "sc-08")).toBe(false);
  });

  test("las duraciones y otras cifras no cuentan como mención", () => {
    expect(mentionsCircuit("Circuito 8 ➡️ 16 horas y 20 minutos", "sc-16")).toBe(false);
    expect(mentionsCircuit("333 quejas y 42 transformadores", "sc-02")).toBe(false);
  });
});

describe("hasUniversalReset", () => {
  test("exige verbo de restablecimiento y frase universal", () => {
    expect(hasUniversalReset("Se restablece el servicio en toda la provincia")).toBe(true);
    expect(hasUniversalReset("Afectaciones en toda la provincia")).toBe(false);
    expect(hasUniversalReset("Se restablece el circuito 8")).toBe(false);
  });
});

describe("filterLlmResult", () => {
  const batch = [
    msg(1, "Se afecta el circuito 8"),
    msg(2, "Se restablecen los circuitos afectados"),
  ];
  const bulk = result([
    { circuito: "sc-25", estado: "ok", mensaje_id: 2, duracion_min: null },
    { circuito: "sc-26", estado: "ok", mensaje_id: 2, duracion_min: null },
  ]);

  test("en modo off no valida nada", () => {
    const out = filterLlmResult(batch, bulk, "off");
    expect(out.dropped).toEqual([]);
    expect(out.result.cambios).toHaveLength(2);
  });

  test("el ok masivo se descarta siempre, también en modo log", () => {
    const out = filterLlmResult(batch, bulk, "log");
    expect(out.result.cambios).toEqual([]);
    expect(out.dropped.map((e) => e.circuito)).toEqual(["sc-25", "sc-26"]);
  });

  test("en modo log una mención dudosa pasa pero queda registrada", () => {
    const out = filterLlmResult(
      batch,
      result([{ circuito: "sc-08", estado: "ok", mensaje_id: 2, duracion_min: null }]),
      "log",
    );
    expect(out.result.cambios).toHaveLength(1);
    expect(out.logged).toEqual([{ circuito: "sc-08", mensaje_id: 2, reason: "no_mention" }]);
  });

  test("enforce descarta un cambio cuyo mensaje no menciona el circuito", () => {
    const out = filterLlmResult(
      batch,
      result([{ circuito: "sc-08", estado: "ok", mensaje_id: 2, duracion_min: null }]),
      "enforce",
    );
    expect(out.result.cambios).toEqual([]);
    expect(out.dropped).toEqual([{ circuito: "sc-08", mensaje_id: 2, reason: "no_mention" }]);
  });

  test("acepta un ok masivo si el mensaje restablece toda la provincia", () => {
    const out = filterLlmResult(
      [msg(3, "Se restablece el servicio en toda la provincia")],
      result([
        { circuito: "sc-08", estado: "ok", mensaje_id: 3, duracion_min: null },
        { circuito: "sc-25", estado: "ok", mensaje_id: 3, duracion_min: null },
      ]),
      "enforce",
    );
    expect(out.result.cambios).toHaveLength(2);
    expect(out.dropped).toEqual([]);
  });
});
