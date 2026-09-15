CREATE TABLE writing_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    original_text TEXT NOT NULL,
    corrected_text TEXT NOT NULL,
    has_corrections INTEGER NOT NULL CHECK (has_corrections IN (0, 1)),
    corrections_json TEXT NOT NULL,
    general_feedback TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (user_id, operation_id)
);
CREATE INDEX writing_entries_owner_order_idx
    ON writing_entries(user_id, created_at DESC, id DESC);

CREATE TABLE saved_videos (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    video_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    segments_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (user_id, source, video_id),
    UNIQUE (id, user_id)
);
CREATE INDEX saved_videos_owner_order_idx
    ON saved_videos(user_id, updated_at DESC, id DESC);

CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id TEXT,
    title TEXT NOT NULL,
    text TEXT NOT NULL CHECK (length(text) <= 2000),
    timestamp REAL CHECK (timestamp IS NULL OR timestamp >= 0),
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (video_id, user_id) REFERENCES saved_videos(id, user_id) ON DELETE CASCADE
);
CREATE INDEX notes_owner_order_idx ON notes(user_id, updated_at DESC, id DESC);

CREATE TABLE note_conflicts (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    base_version INTEGER NOT NULL,
    submitted_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE voice_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scenario TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (id, user_id)
);
CREATE INDEX voice_conversations_owner_order_idx
    ON voice_conversations(user_id, updated_at DESC, id DESC);

CREATE TABLE voice_turns (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    operation_id TEXT NOT NULL,
    user_text TEXT NOT NULL,
    assistant_text TEXT NOT NULL,
    feedback_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (conversation_id, user_id)
        REFERENCES voice_conversations(id, user_id) ON DELETE CASCADE,
    UNIQUE (conversation_id, sequence),
    UNIQUE (user_id, operation_id)
);
