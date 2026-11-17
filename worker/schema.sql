-- SinLuz · esquema D1
-- Un solo almacén: mensajes crudos (replay) + snapshot servido por la API.

CREATE TABLE IF NOT EXISTS raw_messages (
  id          INTEGER PRIMARY KEY,
  posted_at   INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  text_hash   TEXT    NOT NULL,
  intent      TEXT,
  parsed_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_raw_posted ON raw_messages (posted_at, id);

-- Documento único que sirve la API (1 fila).
CREATE TABLE IF NOT EXISTS state_snapshot (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  payload      TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);

-- Correcciones manuales. Sobreviven al rebuild: se aplican al final.
CREATE TABLE IF NOT EXISTS circuit_overrides (
  circuit_id TEXT PRIMARY KEY,
  status     TEXT NOT NULL,
  since      INTEGER,
  updated_at INTEGER NOT NULL
);

-- Backoff, alertas y otros interruptores persistentes.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     INTEGER NOT NULL,
  source TEXT    NOT NULL,
  ok     INTEGER NOT NULL,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingest_at ON ingest_log (at);
