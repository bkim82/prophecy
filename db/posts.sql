-- Saved omens (db/schema.ts posts / post_media / poll_votes), additive only:
-- no DROP/RENAME, so tables other branches own survive. Idempotent; apply in
-- one transaction with the direct (unpooled) connection, on a non-production
-- branch first, e.g. `psql "$DATABASE_URL_UNPOOLED" -1 -f db/posts.sql`.
-- Not `db:push`, which would drop tables this branch's schema doesn't list.

CREATE TABLE IF NOT EXISTS posts (
  id text PRIMARY KEY,
  author_id text NOT NULL,
  author_name text NOT NULL,
  author_handle text,
  content text NOT NULL DEFAULT '',
  topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  trade_ref text,
  trade_roi_at_post double precision,
  gif text,
  poll_choices jsonb,
  poll_ends_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  CONSTRAINT posts_content_length CHECK (char_length(content) <= 280),
  CONSTRAINT posts_topics_count CHECK (jsonb_array_length(topics) <= 3),
  CONSTRAINT posts_poll_shape CHECK ((poll_choices IS NULL) = (poll_ends_at IS NULL))
);
CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts (created_at);
CREATE INDEX IF NOT EXISTS posts_author_created_at_idx ON posts (author_id, created_at);

CREATE TABLE IF NOT EXISTS post_media (
  post_id text NOT NULL,
  position integer NOT NULL,
  mime text NOT NULL,
  image text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  PRIMARY KEY (post_id, position),
  CONSTRAINT post_media_position_range CHECK (position BETWEEN 0 AND 3)
);

CREATE TABLE IF NOT EXISTS poll_votes (
  post_id text NOT NULL,
  user_id text NOT NULL,
  choice integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id),
  CONSTRAINT poll_votes_choice_range CHECK (choice BETWEEN 0 AND 3)
);
