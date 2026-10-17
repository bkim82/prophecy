-- Embedded-wallet schema (db/schema.ts), additive only: no DROP/RENAME, so tables
-- and columns that other branches own (bots, onboarding, matches.bot_state) survive.
-- Idempotent; apply in one transaction with the direct (unpooled) connection, e.g. `psql "$DATABASE_URL_UNPOOLED" -1 -f db/embedded-wallet.sql`.

ALTER TABLE users ADD COLUMN IF NOT EXISTS smart_account_address text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_address text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_chain_id integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_status text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_created_at timestamp with time zone;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_updated_at timestamp with time zone;
CREATE UNIQUE INDEX IF NOT EXISTS users_smart_account_address_unique ON users (smart_account_address);
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_wallet_chain_id_base CHECK (wallet_chain_id IS NULL OR wallet_chain_id = 8453);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_wallet_status_valid CHECK (wallet_status IS NULL OR wallet_status IN ('active', 'locked', 'deleted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_image text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_mime text;

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL,
  issued_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  idle_expires_at timestamp with time zone NOT NULL,
  last_seen_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  ip_hash text,
  user_agent_hash text,
  CONSTRAINT app_sessions_expiry_order CHECK (expires_at > issued_at),
  CONSTRAINT app_sessions_idle_expiry_order CHECK (idle_expires_at > issued_at)
);
CREATE INDEX IF NOT EXISTS app_sessions_user_id_idx ON app_sessions (user_id);
CREATE INDEX IF NOT EXISTS app_sessions_expiry_idx ON app_sessions (expires_at);

CREATE TABLE IF NOT EXISTS request_rate_limits (
  scope_key text PRIMARY KEY,
  window_started_at timestamp with time zone NOT NULL,
  count integer NOT NULL,
  CONSTRAINT request_rate_limits_positive_count CHECK (count > 0)
);

CREATE TABLE IF NOT EXISTS transaction_intents (
  id text PRIMARY KEY,
  schema_version integer NOT NULL DEFAULT 1,
  user_id text NOT NULL,
  idempotency_key text NOT NULL,
  kind text NOT NULL,
  chain_id integer NOT NULL,
  smart_account_address text NOT NULL,
  token_in text NOT NULL,
  token_out text,
  recipient text NOT NULL,
  input_amount numeric(78, 0) NOT NULL,
  minimum_output_amount numeric(78, 0),
  quote_provider text,
  quote_id text,
  quote_expires_at timestamp with time zone,
  calls jsonb NOT NULL,
  normalized_call_hash text NOT NULL,
  user_operation_hash text,
  transaction_hash text,
  status text NOT NULL DEFAULT 'created',
  failure_code text,
  submission_claimed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT transaction_intents_chain_base CHECK (chain_id = 8453),
  CONSTRAINT transaction_intents_kind_valid CHECK (kind IN ('send', 'swap')),
  CONSTRAINT transaction_intents_status_valid CHECK (status IN ('created', 'confirmed_by_user', 'submitted', 'included', 'reverted', 'dropped', 'replaced', 'canceled')),
  CONSTRAINT transaction_intents_input_positive CHECK (input_amount > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS transaction_intents_user_idempotency_unique ON transaction_intents (user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS transaction_intents_user_created_idx ON transaction_intents (user_id, created_at);
CREATE INDEX IF NOT EXISTS transaction_intents_reconcile_idx ON transaction_intents (status, updated_at);

CREATE TABLE IF NOT EXISTS wallet_spend_counters (
  scope_key text PRIMARY KEY,
  user_id text NOT NULL,
  token_address text NOT NULL,
  day_started_at timestamp with time zone NOT NULL,
  raw_amount numeric(78, 0) NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT wallet_spend_counters_nonnegative CHECK (raw_amount >= 0)
);
CREATE INDEX IF NOT EXISTS wallet_spend_counters_user_day_idx ON wallet_spend_counters (user_id, day_started_at);

CREATE TABLE IF NOT EXISTS wallet_audit_events (
  id text PRIMARY KEY,
  user_id text,
  event text NOT NULL,
  target_id text,
  detail jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_audit_events_user_created_idx ON wallet_audit_events (user_id, created_at);

CREATE TABLE IF NOT EXISTS onramp_orders (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  smart_account_address text NOT NULL,
  asset text NOT NULL,
  provider_order_id text,
  status text NOT NULL DEFAULT 'created',
  provider_url text,
  expires_at timestamp with time zone,
  transaction_hash text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT onramp_orders_status_valid CHECK (status IN ('created', 'pending', 'completed', 'failed', 'abandoned', 'refunded'))
);
CREATE INDEX IF NOT EXISTS onramp_orders_user_created_idx ON onramp_orders (user_id, created_at);
