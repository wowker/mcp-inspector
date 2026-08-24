CREATE TABLE debug_tabs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  input_mode TEXT NOT NULL CHECK (input_mode IN ('form', 'raw')),
  arguments_json TEXT NOT NULL DEFAULT '{}',
  raw_text TEXT NOT NULL DEFAULT '{}',
  view_state_json TEXT NOT NULL DEFAULT '{}',
  last_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX debug_tabs_project_position_idx
  ON debug_tabs(project_id, position);
