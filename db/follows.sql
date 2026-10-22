-- `follows` + `challenges.target_user_id` (db/schema.ts), additive only: no
-- DROP/RENAME, so tables other branches own survive (not `db:push`).
-- Idempotent; apply in one transaction with the direct (unpooled) connection,
-- e.g. `psql "$DATABASE_URL_UNPOOLED" -1 -f db/follows.sql`.

CREATE TABLE IF NOT EXISTS follows (
  follower_id text NOT NULL,
  target text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT follows_follower_id_target_pk PRIMARY KEY (follower_id, target)
);
CREATE INDEX IF NOT EXISTS follows_target ON follows (target);

ALTER TABLE challenges ADD COLUMN IF NOT EXISTS target_user_id text;
