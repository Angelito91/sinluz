-- SinLuz · reset de la base para el intérprete LLM
--
-- Borra todo el estado y las tablas del diseño anterior. Se acepta perder los
-- datos: tras aplicar `schema.sql`, la siguiente ingesta arranca desde los
-- mensajes recientes del canal.
--
-- Uso local:
--   bunx wrangler d1 execute sinluz --local --file=reset.sql
--   bunx wrangler d1 execute sinluz --local --file=schema.sql
--
-- Uso remoto (producción):
--   bunx wrangler d1 execute sinluz --remote --file=reset.sql
--   bunx wrangler d1 execute sinluz --remote --file=schema.sql

DROP TABLE IF EXISTS raw_messages;
DROP TABLE IF EXISTS llm_decisions;
DROP TABLE IF EXISTS state_snapshot;
DROP TABLE IF EXISTS circuit_overrides;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS ingest_log;
