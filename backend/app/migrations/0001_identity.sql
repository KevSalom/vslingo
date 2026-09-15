CREATE TABLE users (
    id TEXT PRIMARY KEY,
    clerk_user_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (length(clerk_user_id) BETWEEN 1 AND 255)
);

CREATE TABLE preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark')),
    speech_voice TEXT NOT NULL DEFAULT 'en-US-AriaNeural',
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE trial_grants (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE ws_tickets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    created_at INTEGER NOT NULL,
    CHECK (length(token_hash) = 64),
    CHECK (expires_at > created_at)
);

CREATE INDEX ws_tickets_session_idx ON ws_tickets(session_id, consumed_at);
CREATE INDEX ws_tickets_expiry_idx ON ws_tickets(expires_at);
