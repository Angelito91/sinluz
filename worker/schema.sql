-- SinLuz · esquema D1
-- Estado incremental: una sola fila con el estado actual y el último mensaje procesado.
-- No se guardan mensajes crudos ni decisiones por mensaje.

CREATE TABLE IF NOT EXISTS state_snapshot (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  payload      TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);

-- Correcciones manuales. Se aplican al leer, no dentro del snapshot.
CREATE TABLE IF NOT EXISTS circuit_overrides (
  circuit_id TEXT PRIMARY KEY,
  status     TEXT NOT NULL,
  since      INTEGER,
  updated_at INTEGER NOT NULL
);

-- Backoff, alertas, último error y otros interruptores persistentes.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Registro corto de ingestas para /api/health. Se poda a 30 días.
CREATE TABLE IF NOT EXISTS ingest_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     INTEGER NOT NULL,
  source TEXT    NOT NULL,
  ok     INTEGER NOT NULL,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingest_at ON ingest_log (at);
