CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days >= 0),
  retention_count INTEGER NOT NULL DEFAULT 10000 CHECK (retention_count >= 0)
);
