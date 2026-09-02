CREATE TABLE tool_catalog_preferences (
  project_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  last_used_at TEXT,
  PRIMARY KEY(project_id, connection_id, tool_name),
  FOREIGN KEY(project_id, connection_id, tool_name)
    REFERENCES tools(project_id, connection_id, name) ON DELETE CASCADE
);

CREATE INDEX tool_catalog_preferences_scope_recent_idx
ON tool_catalog_preferences(project_id, connection_id, last_used_at DESC);
