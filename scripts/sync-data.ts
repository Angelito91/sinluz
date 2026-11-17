import { copyFile, mkdir } from "node:fs/promises";

/** Copia los datos generados al directorio público del frontend. */
await mkdir("web/public", { recursive: true });
await copyFile("worker/data/circuits.json", "web/public/circuits.json");
await copyFile("worker/data/municipios.geojson", "web/public/municipios.geojson");
console.log("OK · datos sincronizados en web/public (circuits.json, municipios.geojson)");
