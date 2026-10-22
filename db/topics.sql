-- Per-account feed topics + engagement signals (db/schema.ts topic_prefs /
-- topic_signals), additive only: no DROP/RENAME, so tables other branches own
-- survive. Idempotent; apply in one transaction with the direct (unpooled)
-- connection, e.g. `psql "$DATABASE_URL_UNPOOLED" -1 -f db/topics.sql`.
-- Not `db:push`, which would drop tables this branch's schema doesn't list.

CREATE TABLE IF NOT EXISTS topic_prefs (
  user_id text PRIMARY KEY,
  followed jsonb NOT NULL DEFAULT '[]'::jsonb,
  muted jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS topic_signals (
  user_id text NOT NULL,
  topic text NOT NULL,
  signal text NOT NULL,
  post_id text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS topic_signals_user_created_idx ON topic_signals (user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS topic_signals_post_once ON topic_signals (user_id, signal, post_id, topic) WHERE post_id <> '';
