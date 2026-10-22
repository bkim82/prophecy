-- `blocks` (db/schema.ts), additive only: no DROP/RENAME, so tables other
-- branches own survive (not `db:push`). Idempotent; apply with the direct
-- (unpooled) connection, e.g. `psql "$DATABASE_URL_UNPOOLED" -1 -f db/blocks.sql`.

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id text NOT NULL,
  blocked_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks (blocked_id);
