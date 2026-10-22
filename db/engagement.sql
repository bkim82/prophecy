-- Likes, reposts, replies and clash votes on omens (db/schema.ts post_likes
-- / post_reshares / post_replies / reply_likes / clash_votes), additive only:
-- no DROP/RENAME, so tables other branches own survive (not `db:push`).
-- Idempotent; apply in one transaction with the direct (unpooled)
-- connection, e.g. `psql "$DATABASE_URL_UNPOOLED" -1 -f db/engagement.sql`.

CREATE TABLE IF NOT EXISTS post_likes (
  post_id text NOT NULL,
  user_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_reshares (
  post_id text NOT NULL,
  user_id text NOT NULL,
  kind text NOT NULL,
  text text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id),
  CONSTRAINT post_reshares_kind CHECK (kind IN ('repost', 'vouch', 'defy')),
  CONSTRAINT post_reshares_text_length CHECK (char_length(text) <= 280)
);

CREATE TABLE IF NOT EXISTS post_replies (
  id text PRIMARY KEY,
  post_id text NOT NULL,
  author_id text NOT NULL,
  author_name text NOT NULL,
  author_handle text,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  edited_at timestamp with time zone,
  deleted_at timestamp with time zone,
  CONSTRAINT post_replies_content_length CHECK (char_length(content) BETWEEN 1 AND 280)
);
-- For databases that created post_replies before replies could be edited.
ALTER TABLE post_replies ADD COLUMN IF NOT EXISTS edited_at timestamp with time zone;
ALTER TABLE post_replies ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;
CREATE INDEX IF NOT EXISTS post_replies_post_created_at_idx ON post_replies (post_id, created_at);
CREATE INDEX IF NOT EXISTS post_replies_author_created_at_idx ON post_replies (author_id, created_at);

CREATE TABLE IF NOT EXISTS reply_likes (
  reply_id text NOT NULL,
  user_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (reply_id, user_id)
);

CREATE TABLE IF NOT EXISTS clash_votes (
  post_id text NOT NULL,
  user_id text NOT NULL,
  side integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id),
  CONSTRAINT clash_votes_side CHECK (side IN (0, 1))
);
