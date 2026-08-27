CREATE UNIQUE INDEX debug_tabs_project_id_unique
ON debug_tabs(project_id, id);

CREATE UNIQUE INDEX tool_snapshots_project_connection_id_unique
ON tool_snapshots(project_id, connection_id, id);

CREATE UNIQUE INDEX runs_project_id_unique
ON runs(project_id, id);

CREATE TABLE tool_workflows (
  project_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  before_enabled INTEGER NOT NULL DEFAULT 0 CHECK (before_enabled IN (0, 1)),
  before_source TEXT NOT NULL DEFAULT '' CHECK (length(before_source) <= 2097152),
  after_enabled INTEGER NOT NULL DEFAULT 0 CHECK (after_enabled IN (0, 1)),
  after_source TEXT NOT NULL DEFAULT '' CHECK (length(after_source) <= 2097152),
  timeout_ms INTEGER NOT NULL DEFAULT 5000 CHECK (timeout_ms BETWEEN 100 AND 60000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, connection_id, tool_name),
  FOREIGN KEY(project_id, connection_id, tool_name)
    REFERENCES tools(project_id, connection_id, name) ON DELETE CASCADE
);

CREATE TABLE environment_variables (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id TEXT,
  name TEXT NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 128),
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  secret INTEGER NOT NULL DEFAULT 0 CHECK (secret IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id, connection_id)
    REFERENCES connections(project_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX environment_variables_project_name_unique
ON environment_variables(project_id, name COLLATE NOCASE)
WHERE connection_id IS NULL;

CREATE UNIQUE INDEX environment_variables_server_name_unique
ON environment_variables(project_id, connection_id, name COLLATE NOCASE)
WHERE connection_id IS NOT NULL;

CREATE TABLE workflow_executions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  tab_id TEXT,
  tool_name TEXT NOT NULL,
  tool_snapshot_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'queued','before','main','after','succeeded','failed','cancelled','interrupted'
  )),
  initial_arguments_json TEXT NOT NULL
    CHECK (json_valid(initial_arguments_json) AND json_type(initial_arguments_json) = 'object'),
  final_arguments_json TEXT
    CHECK (final_arguments_json IS NULL OR (json_valid(final_arguments_json) AND json_type(final_arguments_json) = 'object')),
  workflow_snapshot_json TEXT NOT NULL
    CHECK (json_valid(workflow_snapshot_json) AND json_type(workflow_snapshot_json) = 'object'),
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  UNIQUE(project_id, idempotency_key),
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, connection_id)
    REFERENCES connections(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, tab_id)
    REFERENCES debug_tabs(project_id, id) ON DELETE SET NULL,
  FOREIGN KEY(project_id, connection_id, tool_name)
    REFERENCES tools(project_id, connection_id, name),
  FOREIGN KEY(project_id, connection_id, tool_snapshot_id)
    REFERENCES tool_snapshots(project_id, connection_id, id)
);

CREATE INDEX workflow_executions_project_created_index
ON workflow_executions(project_id, created_at DESC, id DESC);

CREATE TABLE workflow_execution_runs (
  project_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('helper-before', 'main', 'helper-after')),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  source_line INTEGER CHECK (source_line IS NULL OR source_line >= 1),
  PRIMARY KEY(execution_id, ordinal),
  UNIQUE(run_id),
  FOREIGN KEY(project_id, execution_id)
    REFERENCES workflow_executions(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, run_id)
    REFERENCES runs(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE workflow_events (
  project_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  kind TEXT NOT NULL CHECK (kind = trim(kind) AND length(kind) BETWEEN 1 AND 80),
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  PRIMARY KEY(execution_id, sequence),
  FOREIGN KEY(project_id, execution_id)
    REFERENCES workflow_executions(project_id, id) ON DELETE CASCADE
);
