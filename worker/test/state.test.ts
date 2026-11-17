import { describe, expect, test } from "bun:test";
import { classify, parseMetrics } from "../src/classify";
import { aliasIndex } from "../src/catalog";
import { applyMessage, emptyRuntime } from "../src/state";

describe("intención", () => {
  test("snapshot explícito", () => {
    expect(classify("Se afecta el servicio eléctrico en los siguientes circuitos:\n8\n9")).toBe("snapshot");
  });

  test("top-N nunca es snapshot", () => {
    expect(
      classify("📌 Circuitos con mayor tiempo de afectación:\nCircuito 1 ➡️ 9 horas"),
    ).toBe("top_n");
  });

  test("lista de afectados sin 'se afecta' se trata como parcial", () => {
    expect(
      classify(
        "Actualización de los circuitos que se encuentran afectados por déficit:\nLínea 4390-Contramaestre➡️ 16 horas",
      ),
    ).toBe("top_n");
  });

  test("altas incrementales", () => {
    expect(
      classify("se incorporan a la afectación la línea 4435-Contramaestre y línea 5390-San Luis"),
    ).toBe("add");
  });

  test("aviso de una línea que añade un circuito", () => {
    expect(
      classify("🚨 Estimados clientes se encuentra afectado por Déficit de Generación el circuito 3 de Santiago."),
    ).toBe("add");
    expect(
      classify("🚨 Se encuentran afectados por Déficit la línea 4390- Contramaestre y 5390- La Maya."),
    ).toBe("add");
    expect(classify("🚨 Se encuentra disparada la línea 5975- Baconao.")).toBe("add");
  });

  test("aviso de una línea que devuelve circuitos al servicio", () => {
    expect(
      classify("🔉 Se encuentran con servicio:<br>Circuito 21<br>Circuito 2<br>Línea 4385- Contramaestre"),
    ).toBe("restore");
    expect(classify("🔉 Con servicio el circuito 2 de Palma.")).toBe("restore");
  });

  test("'con servicio 40 MW' es cifra, no restablecimiento", () => {
    expect(classify("En estos momentos la provincia tiene 100 MW afectados. Con servicio 40 MW")).toBe(
      "metrics",
    );
  });

  test("restablecimiento", () => {
    expect(classify("Se restablece el servicio eléctrico a la siguiente Línea:\nLI 5395-San Luis")).toBe(
      "restore",
    );
    expect(classify("Se encuentran restablecidos los siguientes circuitos:")).toBe("restore");
  });

  test("aviso genérico de restablecimiento no cambia estado", () => {
    expect(
      classify(
        "el comportamiento de las afectaciones y el restablecimiento del servicio estará en dependencia del SEN",
      ),
    ).toBe("info");
  });

  test("métricas de la provincia", () => {
    expect(classify("En estos momentos la provincia tiene 100 MW afectados. Con servicio 40 MW")).toBe(
      "metrics",
    );
    expect(parseMetrics("MW Afectados- 91\nMW Servidos - 40")).toEqual({ deficit_mw: 91, served_mw: 40 });
  });

  test("teléfonos y avisos son info", () => {
    expect(classify("haga su reporte al Centro Telefónico mediante el 18888")).toBe("info");
  });
});

const msg = (id: number, date: number, text: string) => ({ id, date, text });

describe("máquina de estados", () => {
  test("un top-N no borra circuitos afectados", () => {
    const rt = emptyRuntime();
    applyMessage(rt, msg(1, 1000, "Se afecta el servicio eléctrico en los siguientes circuitos:\n8\n9"), aliasIndex);
    expect([...rt.circuits.keys()].sort()).toEqual(["sc-08", "sc-09"]);

    applyMessage(rt, msg(2, 2000, "Circuitos con mayor tiempo de afectación:\nCircuito 20 ➡️ 3 horas"), aliasIndex);

    expect(rt.circuits.get("sc-08")?.status).toBe("out");
    expect(rt.circuits.get("sc-09")?.status).toBe("out");
    expect(rt.circuits.get("sc-20")?.status).toBe("out");
  });

  test("un snapshot sí reemplaza el conjunto", () => {
    const rt = emptyRuntime();
    applyMessage(rt, msg(1, 1000, "Se afecta el servicio eléctrico en los siguientes circuitos:\n8\n9"), aliasIndex);
    applyMessage(rt, msg(2, 2000, "Se afecta el servicio eléctrico en los siguientes circuitos:\n12"), aliasIndex);

    expect(rt.circuits.get("sc-08")?.status).toBe("none_reported");
    expect(rt.circuits.get("sc-12")?.status).toBe("out");
    expect(rt.circuits.get("sc-12")?.since).toBe(2000);
  });

  test("conserva el inicio de la afectación si el circuito sigue en la lista", () => {
    const rt = emptyRuntime();
    applyMessage(rt, msg(1, 1000, "Se afecta el servicio eléctrico en los siguientes circuitos:\n12"), aliasIndex);
    applyMessage(rt, msg(2, 5000, "Se afecta el servicio eléctrico en los siguientes circuitos:\n12\n14"), aliasIndex);

    expect(rt.circuits.get("sc-12")?.since).toBe(1000);
    expect(rt.circuits.get("sc-14")?.since).toBe(5000);
  });

  test("un snapshot que no se entiende se ignora", () => {
    const rt = emptyRuntime();
    applyMessage(rt, msg(1, 1000, "Se afecta el servicio eléctrico en los siguientes circuitos:\n8"), aliasIndex);
    const r = applyMessage(
      rt,
      msg(2, 2000, "Se afecta el servicio eléctrico en los siguientes circuitos:\nzzz desconocido"),
      aliasIndex,
    );
    expect(r.intent).toBe("info");
    expect(rt.circuits.get("sc-08")?.status).toBe("out");
  });

  test("restablecer deja el circuito en none_reported, nunca en 'con luz'", () => {
    const rt = emptyRuntime();
    applyMessage(rt, msg(1, 1000, "Se afecta el servicio eléctrico en los siguientes circuitos:\n8"), aliasIndex);
    applyMessage(rt, msg(2, 2000, "Se restablece el servicio eléctrico a la siguiente Línea:\nLI 5395-San Luis"), aliasIndex);
    applyMessage(rt, msg(3, 3000, "Se restablece el servicio al circuito 8"), aliasIndex);

    expect(rt.circuits.get("sc-08")?.status).toBe("none_reported");
    expect(rt.circuits.get("sc-08")?.since).toBe(null);
  });

  test("un top-N sin historial deduce el inicio desde la duración publicada", () => {
    const rt = emptyRuntime();
    applyMessage(rt, msg(1, 10_000_000, "Circuitos con mayor tiempo de afectación:\nCircuito 20 ➡️ 10 horas"), aliasIndex);
    const c = rt.circuits.get("sc-20");
    expect(c?.since).toBe(10_000_000 - 600 * 60);
    expect(c?.confidence).toBeLessThanOrEqual(0.6);
  });

  test("las métricas actualizan la provincia", () => {
    const rt = emptyRuntime();
    applyMessage(rt, msg(1, 1000, "En estos momentos la provincia tiene 100 MW afectados. Con servicio 40 MW"), aliasIndex);
    expect(rt.deficit_mw).toBe(100);
    expect(rt.served_mw).toBe(40);
  });
});
