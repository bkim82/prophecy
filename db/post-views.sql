-- `post_views` (db/schema.ts): which omens each account has seen in a feed,
-- additive only: no DROP/RENAME, so tables other branches own survive (not
-- `db:push`). Idempotent; apply in one transaction with the direct (unpooled)
-- connection, e.g. `psql "$DATABASE_URL_UNPOOLED" -1 -f db/post-views.sql`.

CREATE TABLE IF NOT EXISTS post_views (
  user_id text NOT NULL,
  post_id text NOT NULL,
  seen_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT post_views_user_id_post_id_pk PRIMARY KEY (user_id, post_id)
);
