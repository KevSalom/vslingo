CREATE TABLE usage_periods (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    source TEXT NOT NULL CHECK (source IN ('trial', 'monthly', 'manual')),
    plan_code TEXT NOT NULL,
    config_version INTEGER NOT NULL CHECK (config_version > 0),
    starts_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ends_at TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'replaced', 'ended')),
    limit_voice_seconds REAL NOT NULL CHECK (limit_voice_seconds >= 0),
    limit_voice_turns INTEGER NOT NULL CHECK (limit_voice_turns >= 0),
    limit_writings INTEGER NOT NULL CHECK (limit_writings >= 0),
    limit_videos INTEGER NOT NULL CHECK (limit_videos >= 0),
    used_voice_seconds REAL NOT NULL DEFAULT 0 CHECK (used_voice_seconds >= 0),
    reserved_voice_seconds REAL NOT NULL DEFAULT 0 CHECK (reserved_voice_seconds >= 0),
    used_voice_turns INTEGER NOT NULL DEFAULT 0 CHECK (used_voice_turns >= 0),
    reserved_voice_turns INTEGER NOT NULL DEFAULT 0 CHECK (reserved_voice_turns >= 0),
    used_writings INTEGER NOT NULL DEFAULT 0 CHECK (used_writings >= 0),
    reserved_writings INTEGER NOT NULL DEFAULT 0 CHECK (reserved_writings >= 0),
    used_videos INTEGER NOT NULL DEFAULT 0 CHECK (used_videos >= 0),
    reserved_videos INTEGER NOT NULL DEFAULT 0 CHECK (reserved_videos >= 0)
);
CREATE UNIQUE INDEX usage_periods_one_active_idx
    ON usage_periods(user_id) WHERE status = 'active';

CREATE TABLE usage_operations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    period_id TEXT NOT NULL REFERENCES usage_periods(id) ON DELETE RESTRICT,
    operation_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('writing', 'video', 'voice')),
    resource_key TEXT,
    status TEXT NOT NULL CHECK (
        status IN ('reserved', 'provider_started', 'result_persisted', 'succeeded', 'released', 'uncertain')
    ),
    reserved_primary REAL NOT NULL CHECK (reserved_primary >= 0),
    reserved_secondary REAL NOT NULL DEFAULT 0 CHECK (reserved_secondary >= 0),
    used_primary REAL NOT NULL DEFAULT 0 CHECK (used_primary >= 0),
    used_secondary REAL NOT NULL DEFAULT 0 CHECK (used_secondary >= 0),
    cost_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (cost_micro_usd >= 0),
    provider_started_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (user_id, operation_id)
);
CREATE INDEX usage_operations_period_idx ON usage_operations(period_id, status, created_at);

CREATE TABLE usage_operation_results (
    operation_id TEXT PRIMARY KEY REFERENCES usage_operations(id) ON DELETE RESTRICT,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE usage_resource_claims (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind = 'video'),
    resource_key TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'released', 'uncertain')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (user_id, kind, resource_key),
    UNIQUE (user_id, operation_id)
);
