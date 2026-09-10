CREATE TABLE IF NOT EXISTS project_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  database_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT
);
