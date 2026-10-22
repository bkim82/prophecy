-- `presence` (db/schema.ts), additive only: no DROP/RENAME, so tables other
-- branches own survive (not `db:push`). Idempotent; apply with the direct
-- (unpooled) connection, e.g. `psql "$DATABASE_URL_UNPOOLED" -1 -f db/presence.sql`.

CREATE TABLE IF NOT EXISTS presence (
  user_id text PRIMARY KEY,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now()
);
