CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  balance_atomic BIGINT NOT NULL CHECK (balance_atomic >= 0),
  reserved_atomic BIGINT NOT NULL DEFAULT 0 CHECK (reserved_atomic >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallets_reserved_not_above_balance CHECK (reserved_atomic <= balance_atomic),
  CONSTRAINT wallets_user_asset_unique UNIQUE (user_id, asset)
);

CREATE TABLE IF NOT EXISTS wallet_reservations (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  withdrawal_id TEXT NOT NULL UNIQUE,
  amount_atomic BIGINT NOT NULL CHECK (amount_atomic > 0),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'FINALIZED', 'RELEASED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_reservations_wallet_id_idx
  ON wallet_reservations(wallet_id);

CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount_atomic BIGINT NOT NULL CHECK (amount_atomic > 0),
  destination_address TEXT NOT NULL CHECK (length(trim(destination_address)) > 0),
  reservation_id TEXT NOT NULL UNIQUE REFERENCES wallet_reservations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('FUNDS_RESERVED', 'PROCESSING', 'COMPLETED', 'FAILED')),
  transaction_reference TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT withdrawals_terminal_payload_check CHECK (
    (status = 'COMPLETED' AND transaction_reference IS NOT NULL AND failure_reason IS NULL)
    OR (status = 'FAILED' AND transaction_reference IS NULL AND failure_reason = 'PROVIDER_ERROR')
    OR (status IN ('FUNDS_RESERVED', 'PROCESSING') AND transaction_reference IS NULL AND failure_reason IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS withdrawals_user_created_idx
  ON withdrawals(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_records (
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  withdrawal_id TEXT REFERENCES withdrawals(id) ON DELETE RESTRICT,
  response_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (operation, idempotency_key),
  CONSTRAINT idempotency_completed_payload_check CHECK (
    (status = 'IN_PROGRESS' AND response_payload IS NULL AND completed_at IS NULL)
    OR (status = 'COMPLETED' AND response_payload IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  locked_by TEXT
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx
  ON outbox_events(available_at, occurred_at)
  WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fake_provider_executions (
  withdrawal_id TEXT PRIMARY KEY,
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
