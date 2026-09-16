CREATE TABLE marketing_consents (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    analytics_allowed INTEGER NOT NULL CHECK (analytics_allowed IN (0, 1)),
    policy_version TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE marketing_visitors (
    visitor_id TEXT PRIMARY KEY,
    analytics_allowed INTEGER NOT NULL CHECK (analytics_allowed IN (0, 1)),
    policy_version TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (length(visitor_id) = 36)
);

CREATE TABLE marketing_outbox (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    visitor_id TEXT REFERENCES marketing_visitors(visitor_id) ON DELETE CASCADE,
    event_name TEXT NOT NULL CHECK (event_name IN ('PageView', 'Lead', 'Purchase')),
    event_id TEXT NOT NULL UNIQUE,
    action_source TEXT NOT NULL CHECK (
        action_source IN ('website', 'system_generated')
    ),
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'retry', 'sent')
    ),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    sent_at TEXT,
    CHECK ((user_id IS NOT NULL) != (visitor_id IS NOT NULL))
);
CREATE INDEX marketing_outbox_dispatch_idx
    ON marketing_outbox(status, next_attempt_at, created_at, id);
