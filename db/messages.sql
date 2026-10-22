-- Direct messages (db/schema.ts direct_messages / direct_message_media /
-- direct_threads), additive only: no DROP/RENAME of tables, so tables other
-- branches own survive. Idempotent; apply in one transaction with the direct
-- (unpooled) connection, e.g. `psql "$DATABASE_URL_UNPOOLED" -1 -f db/messages.sql`.
-- Not `db:push`, which would drop tables this branch's schema doesn't list.

CREATE TABLE IF NOT EXISTS direct_messages (
  id text PRIMARY KEY,
  sender_id text NOT NULL,
  recipient_id text NOT NULL,
  body text NOT NULL DEFAULT '',
  post_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT direct_messages_body_length CHECK (char_length(body) <= 1000),
  CONSTRAINT direct_messages_not_self CHECK (sender_id <> recipient_id)
);
-- For databases that created direct_messages before photos and shared posts,
-- when every message needed text.
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS post_id text;
ALTER TABLE direct_messages ALTER COLUMN body SET DEFAULT '';
ALTER TABLE direct_messages DROP CONSTRAINT IF EXISTS direct_messages_body_length;
ALTER TABLE direct_messages ADD CONSTRAINT direct_messages_body_length CHECK (char_length(body) <= 1000);
CREATE INDEX IF NOT EXISTS direct_messages_recipient_created_idx ON direct_messages (recipient_id, created_at);
CREATE INDEX IF NOT EXISTS direct_messages_sender_created_idx ON direct_messages (sender_id, created_at);

CREATE TABLE IF NOT EXISTS direct_message_media (
  message_id text NOT NULL,
  position integer NOT NULL,
  mime text NOT NULL,
  image text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  PRIMARY KEY (message_id, position),
  CONSTRAINT direct_message_media_position_range CHECK (position BETWEEN 0 AND 3)
);

CREATE TABLE IF NOT EXISTS direct_threads (
  user_id text NOT NULL,
  peer_id text NOT NULL,
  last_read_at timestamp with time zone,
  accepted_at timestamp with time zone,
  cleared_at timestamp with time zone,
  PRIMARY KEY (user_id, peer_id)
);
