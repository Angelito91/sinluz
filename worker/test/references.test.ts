import { describe, expect, test } from "bun:test";
import {
  clusterPoints,
  mappedAnchor,
  normalizeMappedId,
  parseMappedGeoJSON,
  pickRepresentative,
  routeAnchor,
  type MappedRoute,
  type ReferencePoint,
} from "../scripts/lib/references";

describe("ids del mapa detallado", () => {
  test("normaliza los ids sin cero y los seccionalizados", () => {
    expect(normalizeMappedId("sc-1")).toEqual({ id: "sc-01" });
    expect(normalizeMappedId("sc-08")).toEqual({ id: "sc-08" });
    expect(normalizeMappedId("sc-09-si4074")).toEqual({ id: "sc-09-si4074" });
    expect(normalizeMappedId("sc-11")).toEqual({ id: "sc-11" });
    expect(normalizeMappedId("line-4385")).toEqual({ id: "line-4385" });
    expect(normalizeMappedId("desconocido")).toBeNull();
  });
});

describe("puntos colaborativos", () => {
  test("separa grupos que están a más de la tolerancia", () => {
    const points: ReferencePoint[] = [
      { lat: 20.0, lon: -75.83 },
      { lat: 20.001, lon: -75.831 },
      { lat: 20.1, lon: -75.9 },
    ];
    expect(clusterPoints(points).map((c) => c.length).sort()).toEqual([1, 2]);
  });

  test("un punto verificado pesa más que varios sin verificar", () => {
    const points: ReferencePoint[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        lat: 20.0 + i * 0.0001,
        lon: -75.83,
        state: "por_verificar",
        votes: 0,
      })),
      { lat: 20.1, lon: -75.9, state: "verificado", votes: 3 },
    ];
    const result = pickRepresentative(points)!;
    expect(result.confidence).toBe("reported");
    expect(result.anchor[0]).toBeCloseTo(20.1, 5);
    expect(result.anchor[1]).toBeCloseTo(-75.9, 5);
  });

  test("ignora el reporte perdido en otro municipio", () => {
    const points: ReferencePoint[] = [
      { lat: 20.0, lon: -75.83, votes: 2 },
      { lat: 20.002, lon: -75.832, votes: 2 },
      { lat: 20.3, lon: -76.2, votes: 1 },
    ];
    const result = pickRepresentative(points)!;
    expect(result.cluster).toHaveLength(2);
    expect(result.anchor[0]).toBeCloseTo(20.001, 5);
  });
});

describe("mapa detallado", () => {
  test("lee zonas, centros y recorridos, y une los seccionalizados", () => {
    const ring = (lon: number, lat: number) => [
      [lon - 0.001, lat - 0.001],
      [lon + 0.001, lat - 0.001],
      [lon + 0.001, lat + 0.001],
      [lon - 0.001, lat + 0.001],
      [lon - 0.001, lat - 0.001],
    ];
    const data = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: "sc-09-si4074_1", nombre: "sc-09-si4074", tipo: "zona", parte: 1, radio_m: 600 },
          geometry: { type: "Polygon", coordinates: [ring(-75.84, 20.0)] },
        },
        {
          type: "Feature",
          properties: { id: "sc-09-si4074_1_centro", nombre: "sc-09-si4074", tipo: "centro_zona", parte: 1 },
          geometry: { type: "Point", coordinates: [-75.84, 20.0] },
        },
        {
          type: "Feature",
          properties: { id: "sc-09-si4615_1", nombre: "sc-09-si4615", tipo: "zona", parte: 1, radio_m: 700 },
          geometry: { type: "Polygon", coordinates: [ring(-75.83, 20.01)] },
        },
        {
          type: "Feature",
          properties: { id: "sc-09-si4615_1_centro", nombre: "sc-09-si4615", tipo: "centro_zona", parte: 1 },
          geometry: { type: "Point", coordinates: [-75.83, 20.01] },
        },
        {
          type: "Feature",
          properties: { id: "sc-1", nombre: "sc-1", tipo: "recorrido" },
          geometry: { type: "LineString", coordinates: [[-75.84, 20.0], [-75.83, 20.01]] },
        },
        {
          type: "Feature",
          properties: { id: "xx-1", nombre: "xx-1", tipo: "recorrido" },
          geometry: { type: "LineString", coordinates: [[-75.84, 20.0], [-75.83, 20.01]] },
        },
      ],
    };

    const parsed = parseMappedGeoJSON(data);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.routes).toHaveLength(1);
    expect(parsed.routes[0]!.id).toBe("sc-01");
    expect(parsed.zones).toHaveLength(2);
    expect(parsed.zones.map((z) => z.id).sort()).toEqual(["sc-09-si4074", "sc-09-si4615"]);
    expect(parsed.zones.map((z) => z.center)).toEqual([
      [-75.84, 20.0],
      [-75.83, 20.01],
    ]);
  });

  test("el ancla del recorrido cae en la mitad de la línea más larga", () => {
    const route: MappedRoute = {
      id: "sc-01",
      lines: [
        [
          [-75.84, 20.0],
          [-75.83, 20.0],
          [-75.82, 20.0],
        ],
      ],
    };
    expect(routeAnchor(route)![0]).toBeCloseTo(20.0, 5);
    expect(routeAnchor(route)![1]).toBeCloseTo(-75.83, 5);
  });

  test("las zonas pesan por radio al cuadrado", () => {
    const anchor = mappedAnchor(
      [],
      [
        {
          id: "sc-21",
          ring: [],
          center: [-75.8, 20.0],
          radius_m: 100,
        },
        {
          id: "sc-21",
          ring: [],
          center: [-75.7, 20.1],
          radius_m: 300,
        },
      ],
    )!;
    expect(anchor[0]).toBeGreaterThan(20.05);
    expect(anchor[1]).toBeGreaterThan(-75.75);
  });
});
