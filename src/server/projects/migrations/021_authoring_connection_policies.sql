CREATE UNIQUE INDEX connections_project_identity_uq
ON connections(project_id, id);

CREATE TABLE authoring_connection_policies (
  project_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('DISABLED', 'READ_ONLY', 'CUSTOM', 'FULL_ACCESS')),
  allowed_tools_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(allowed_tools_json) AND json_type(allowed_tools_json) = 'array'),
  denied_tools_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(denied_tools_json) AND json_type(denied_tools_json) = 'array'),
  require_cleanup_for_draft_mutations INTEGER NOT NULL DEFAULT 1
    CHECK (require_cleanup_for_draft_mutations IN (0, 1)),
  max_calls_per_minute INTEGER NOT NULL CHECK (max_calls_per_minute BETWEEN 1 AND 600),
  max_concurrent_calls INTEGER NOT NULL CHECK (max_concurrent_calls BETWEEN 1 AND 2),
  max_call_duration_ms INTEGER NOT NULL CHECK (max_call_duration_ms BETWEEN 100 AND 600000),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, connection_id),
  FOREIGN KEY (project_id, connection_id)
    REFERENCES connections(project_id, id) ON DELETE CASCADE
);

CREATE INDEX authoring_connection_policies_mode_idx
ON authoring_connection_policies(project_id, mode, connection_id);
