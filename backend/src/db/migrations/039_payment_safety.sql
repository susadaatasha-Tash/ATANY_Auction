-- PREPARED LOCALLY ONLY. Requires direct PostgreSQL. Do not auto-apply at startup.
-- Order cancellation fields from 037 remain a separate deployment prerequisite.
CREATE TABLE IF NOT EXISTS payment_operations (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id),
  actor_id UUID NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('checkout','cancel')),
  state TEXT NOT NULL CHECK (state IN ('running','unknown','completed','failed')),
  context JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_operations_one_active ON payment_operations(order_id)
  WHERE state IN ('running','unknown');

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'paymongo',
  provider_event_id TEXT NOT NULL,
  livemode BOOLEAN NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  raw_body TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'received' CHECK (state IN ('received','processed','review')),
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, livemode, provider_event_id)
);

-- Financial evidence is separate from order allocation. The existing one-paid-
-- payment-per-order constraint must never discard a second external collection.
CREATE TABLE IF NOT EXISTS provider_collections (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'paymongo',
  livemode BOOLEAN NOT NULL,
  provider_payment_id TEXT NOT NULL,
  checkout_session_id TEXT,
  payment_intent_id TEXT,
  order_id UUID REFERENCES orders(id),
  payment_id UUID REFERENCES payments(id),
  amount_centavos BIGINT NOT NULL,
  currency TEXT NOT NULL,
  provider_paid_at TIMESTAMPTZ,
  evidence JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, livemode, provider_payment_id)
);
CREATE TABLE IF NOT EXISTS payment_reconciliations (
  id UUID PRIMARY KEY,
  event_id UUID REFERENCES payment_webhook_events(id),
  collection_id UUID UNIQUE REFERENCES provider_collections(id),
  order_id UUID REFERENCES orders(id),
  reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','reviewed','resolved')),
  evidence JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_reconciliations_event_reason ON payment_reconciliations(event_id, reason)
  WHERE collection_id IS NULL;
CREATE INDEX IF NOT EXISTS payment_webhook_events_pending ON payment_webhook_events(received_at) WHERE state='received';
CREATE INDEX IF NOT EXISTS payment_reconciliations_open ON payment_reconciliations(created_at) WHERE state='open';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_checked_at TIMESTAMPTZ;

-- No client-side writes or reads. Authenticated backend role controls access;
-- Admin receives a read-only, role-protected API projection.
ALTER TABLE payment_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reconciliations ENABLE ROW LEVEL SECURITY;
