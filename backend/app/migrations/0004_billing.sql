CREATE TABLE billing_attempts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    plan_code TEXT NOT NULL,
    provider_environment TEXT NOT NULL CHECK (
        provider_environment IN ('fake', 'sandbox', 'live')
    ),
    provider_request_id TEXT NOT NULL UNIQUE,
    provider_subscription_id TEXT UNIQUE,
    approval_url TEXT,
    status TEXT NOT NULL CHECK (
        status IN (
            'creating', 'approval_pending', 'uncertain', 'completed',
            'failed', 'expired', 'cancelled'
        )
    ),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX billing_attempts_one_open_idx ON billing_attempts(user_id)
    WHERE status IN ('creating', 'approval_pending', 'uncertain');
CREATE INDEX billing_attempts_reconcile_idx
    ON billing_attempts(status, updated_at, id);

CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    billing_attempt_id TEXT NOT NULL REFERENCES billing_attempts(id) ON DELETE RESTRICT,
    provider_environment TEXT NOT NULL CHECK (
        provider_environment IN ('fake', 'sandbox', 'live')
    ),
    provider_subscription_id TEXT NOT NULL UNIQUE,
    plan_code TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN (
            'approval_pending', 'approved', 'active', 'suspended',
            'cancelled', 'expired'
        )
    ),
    auto_renew INTEGER NOT NULL DEFAULT 1 CHECK (auto_renew IN (0, 1)),
    access_ends_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (id, user_id)
);
CREATE UNIQUE INDEX subscriptions_one_renewable_idx ON subscriptions(user_id)
    WHERE status IN ('approval_pending', 'approved', 'active', 'suspended');
CREATE INDEX subscriptions_owner_idx ON subscriptions(user_id, updated_at DESC, id DESC);

CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    provider_transaction_id TEXT NOT NULL UNIQUE,
    gross_minor INTEGER NOT NULL CHECK (gross_minor > 0),
    refunded_minor INTEGER NOT NULL DEFAULT 0 CHECK (
        refunded_minor >= 0 AND refunded_minor <= gross_minor
    ),
    currency TEXT NOT NULL CHECK (length(currency) = 3),
    status TEXT NOT NULL CHECK (
        status IN ('completed', 'partially_refunded', 'refunded', 'reversed')
    ),
    paid_at TEXT NOT NULL,
    usage_period_id TEXT UNIQUE REFERENCES usage_periods(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX payments_subscription_idx ON payments(subscription_id, paid_at DESC, id DESC);

CREATE TABLE paypal_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    provider_environment TEXT NOT NULL CHECK (
        provider_environment IN ('fake', 'sandbox', 'live')
    ),
    status TEXT NOT NULL CHECK (
        status IN ('received', 'processed', 'ignored', 'rejected', 'uncertain')
    ),
    normalized_json TEXT NOT NULL,
    error_code TEXT,
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    processed_at TEXT
);
CREATE INDEX paypal_events_status_idx ON paypal_events(status, received_at, event_id);

CREATE TABLE billing_adjustments (
    id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    provider_event_id TEXT NOT NULL REFERENCES paypal_events(event_id) ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind = 'partial_refund'),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    status TEXT NOT NULL DEFAULT 'needs_manual_review' CHECK (
        status IN ('needs_manual_review', 'applied', 'dismissed')
    ),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    resolved_at TEXT,
    UNIQUE (provider_event_id)
);
