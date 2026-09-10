CREATE TABLE authoring_settings (
  installation_key INTEGER PRIMARY KEY CHECK (installation_key = 1),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  token_digest TEXT,
  token_hint TEXT,
  token_created_at TEXT,
  token_rotated_at TEXT,
  updated_at TEXT,
  CHECK (token_digest IS NULL OR length(token_digest) BETWEEN 1 AND 1024),
  CHECK (token_hint IS NULL OR length(token_hint) BETWEEN 1 AND 64)
);
