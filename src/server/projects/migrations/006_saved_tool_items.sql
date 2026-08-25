CREATE TABLE saved_tool_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('request', 'response')),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  payload_json TEXT NOT NULL,
  source_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connection_id, tool_name) REFERENCES tools(connection_id, name) ON DELETE CASCADE
);
CREATE INDEX saved_tool_items_tool_created_idx
  ON saved_tool_items(project_id, connection_id, tool_name, created_at DESC, id DESC);
