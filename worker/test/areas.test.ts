import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { areaAt, summarizeAreas, type AreaFeature } from "@sinluz/shared/areas";

const geo = JSON.parse(readFileSync(new URL("../../web/public/municipios.geojson", import.meta.url), "utf8"));
const features = geo.features as AreaFeature[];

describe("resumen por área", () => {
  const items = [
    { municipio: "A", status: "out" as const },
    { municipio: "A", status: "ok" as const },
    { municipio: "A", status: "stale" as const },
    { municipio: "A", status: "ok" as const },
    { municipio: "B", status: "stale" as const },
    { municipio: "C", status: "ok" as const },
  ];
  const a = summarizeAreas(items);

  test("cuenta y calcula la proporción de afectados", () => {
    expect(a.get("A")).toMatchObject({ total: 4, out: 1, stale: 1, share: 0.25, tone: "out" });
  });
  test("solo sin confirmar → ámbar; todo con servicio → verde", () => {
    expect(a.get("B")?.tone).toBe("stale");
    expect(a.get("C")?.tone).toBe("ok");
  });
});

describe("¿en qué municipio estoy?", () => {
  // Puntos de referencia conocidos (no salen de los polígonos)
  const cases: [string, number, number, string][] = [
    ["Parque Céspedes, Santiago", 20.0213, -75.8294, "Santiago de Cuba"],
    ["Palma Soriano", 20.2135, -75.9990, "Palma Soriano"],
    ["Contramaestre", 20.3167, -76.2500, "Contramaestre"],
  ];
  for (const [name, lat, lon, want] of cases) {
    test(name, () => expect(areaAt(features, lat, lon)).toBe(want));
  }

  test("fuera de la provincia devuelve null", () => {
    expect(areaAt(features, 23.1136, -82.3666)).toBe(null); // La Habana
    expect(areaAt(features, 19.0, -75.8)).toBe(null); // mar
  });

  test("los 9 municipios tienen área y ninguno se solapa en su centro", () => {
    expect(features).toHaveLength(9);
    for (const f of features) {
      const ring = (f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates[0])[0];
      const [lon, lat] = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
      const hit = areaAt(features, lat, lon);
      // el centroide de un contorno cóncavo puede caer fuera: si cae dentro, debe ser el suyo
      if (hit) expect(hit).toBe(f.properties.name);
    }
  });

  test("respeta los huecos de un polígono", () => {
    const donut: AreaFeature = {
      properties: { name: "X" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
          [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
        ],
      },
    };
    expect(areaAt([donut], 1, 1)).toBe("X");
    expect(areaAt([donut], 5, 5)).toBe(null);
  });
});
