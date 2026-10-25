-- `rematches` (db/schema.ts), additive only: no DROP/RENAME, so tables other
-- branches own survive (not `db:push`). Idempotent; apply with the direct
-- (unpooled) connection, e.g. `psql "$DATABASE_URL_UNPOOLED" -1 -f db/rematches.sql`.

CREATE TABLE IF NOT EXISTS rematches (
  match_id text PRIMARY KEY,
  role integer NOT NULL,
  requested_at timestamp with time zone NOT NULL,
  next_match_id text
);
