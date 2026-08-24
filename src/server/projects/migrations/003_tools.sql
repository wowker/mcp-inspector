CREATE TABLE tool_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(connection_id, tool_name, content_hash)
);
CREATE TABLE tools (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  current_snapshot_id TEXT NOT NULL REFERENCES tool_snapshots(id),
  status TEXT NOT NULL CHECK (status IN ('current', 'changed', 'removed')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(connection_id, name)
);
