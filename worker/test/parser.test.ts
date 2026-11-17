import { describe, expect, test } from "bun:test";
import { canonical, canonicalAlias, findHits, groupHits, parseDurationMinutes } from "../src/normalize";
import { aliasIndex } from "../src/catalog";

const ids = (text: string) => [...groupHits(findHits(text, aliasIndex)).keys()].sort();

describe("normalización", () => {
  test("quita tildes, paréntesis y separa números de letras", () => {
    expect(canonical("Línea 4395Contramaestre(5175)")).toBe("linea 4395 contramaestre 5175");
  });

  test("unifica romanos escritos en minúscula", () => {
    expect(canonical("ll Frente")).toBe("ii frente");
    expect(canonical("Baire-lll Frente")).toBe("baire iii frente");
  });

  test("normaliza el prefijo LI", () => {
    expect(canonicalAlias("LI 5395-San Luis")).toBe("linea 5395 san luis");
  });

  test("duración del propio canal", () => {
    expect(parseDurationMinutes("Línea 4390-Contramaestre➡️ 16 horas")).toBe(960);
    expect(parseDurationMinutes("24 ➡️ 11 horas y 46 minutos")).toBe(706);
    expect(parseDurationMinutes("sin tiempo")).toBe(null);
  });
});

describe("emparejamiento con el catálogo real", () => {
  test("circuito numerado suelto", () => {
    expect(ids("12\n24")).toEqual(["sc-12", "sc-24"]);
  });

  test("línea con formato irregular", () => {
    expect(ids("Línea 4395Contramaestre(5175)")).toEqual(["line-4395"]);
    expect(ids("LI 5395-San Luis")).toEqual(["line-5395"]);
    expect(ids("Línea 5335-Guamá seccionalizado( 5617)")).toEqual(["line-5335"]);
  });

  test("romanos con erratas del canal", () => {
    expect(ids("Baire-lll Frente")).toEqual(["tf-iii"]);
    expect(ids("ll Frente")).toEqual(["sf-ii"]);
  });

  test("circuitos coordinados de un municipio", () => {
    expect(ids("1 y 2 de Contramaestre")).toEqual(["cta-01", "cta-02"]);
    expect(ids("Circuito 1 y 2 Contramaestre")).toEqual(["cta-01", "cta-02"]);
  });

  test("lista separada por comas", () => {
    expect(ids("11,12,13")).toEqual(["sc-11", "sc-12", "sc-13"]);
  });

  test("seccionalizado asociado", () => {
    expect(ids("7 seccionalizado ( SD 3030)")).toEqual(["sc-07"]);
  });

  test("no inventa circuitos con texto de relleno", () => {
    expect(ids("⚠️El tiempo de afectación puede variar en dependencia de la demanda")).toEqual([]);
    expect(ids("haga su reporte al Centro Telefónico 18888")).toEqual([]);
  });
});
