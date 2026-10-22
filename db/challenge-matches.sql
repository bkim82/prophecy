-- `matches.invited_user_id` + `challenges.match_id` (db/schema.ts), additive
-- only: no DROP/RENAME, so tables other branches own survive (not `db:push`).
-- Idempotent; apply in one transaction with the direct (unpooled) connection,
-- e.g. `psql "$DATABASE_URL_UNPOOLED" -1 -f db/challenge-matches.sql`.

ALTER TABLE matches ADD COLUMN IF NOT EXISTS invited_user_id text;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS match_id text;
