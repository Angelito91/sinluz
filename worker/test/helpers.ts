import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import type { Env } from "../src/store";

export const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

/** Adaptador mínimo de D1 sobre SQLite real, para probar consultas y transacciones. */
export function d1(db: Database): D1Database {
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.query(sql).all(...(args as never[])) }),
    first: async () => db.query(sql).get(...(args as never[])) ?? null,
    run: async () => {
      const r = db.query(sql).run(...(args as never[]));
      return { meta: { changes: r.changes } };
    },
    _run: () => {
      const r = db.query(sql).run(...(args as never[]));
      return { meta: { changes: r.changes } };
    },
  });

  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: { _run: () => unknown }[]) => list.map((s) => s._run()),
  } as unknown as D1Database;
}

export function makeEnv(db: Database, extra: Partial<Env> = {}): Env {
  return {
    DB: d1(db),
    INGEST_URL: "https://bridge.test/json",
    INGEST_LIMIT: "30",
    ...extra,
  };
}
