CREATE TABLE test_cases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('tool', 'scenario')),
  name TEXT NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  tags_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  definition_json TEXT NOT NULL
    CHECK (json_valid(definition_json) AND json_type(definition_json) = 'object'
      AND length(CAST(definition_json AS BLOB)) <= 2097152),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, id)
);

CREATE INDEX test_cases_project_updated_index
ON test_cases(project_id, updated_at DESC, id DESC);

-- JSON cannot participate in foreign keys. This internal projection preserves
-- connection identity isolation for both single-Tool and multi-step scenarios.
CREATE TABLE test_case_targets (
  project_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  tool_name TEXT NOT NULL CHECK (tool_name = trim(tool_name) AND length(tool_name) BETWEEN 1 AND 512),
  PRIMARY KEY(test_case_id, connection_id, tool_name),
  FOREIGN KEY(project_id, test_case_id)
    REFERENCES test_cases(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, connection_id)
    REFERENCES connections(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX test_case_targets_connection_index
ON test_case_targets(project_id, connection_id, test_case_id);

CREATE TABLE test_case_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  definition_json TEXT NOT NULL
    CHECK (json_valid(definition_json) AND json_type(definition_json) = 'object'
      AND length(CAST(definition_json AS BLOB)) <= 2097152),
  created_at TEXT NOT NULL,
  UNIQUE(test_case_id, revision),
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, test_case_id)
    REFERENCES test_cases(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE test_suites (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  tags_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  concurrency INTEGER NOT NULL DEFAULT 1 CHECK (concurrency BETWEEN 1 AND 8),
  stop_on_failure INTEGER NOT NULL DEFAULT 0 CHECK (stop_on_failure IN (0, 1)),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, id)
);

CREATE INDEX test_suites_project_updated_index
ON test_suites(project_id, updated_at DESC, id DESC);

CREATE TABLE test_suite_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  suite_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  UNIQUE(suite_id, position),
  UNIQUE(suite_id, test_case_id),
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, suite_id)
    REFERENCES test_suites(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, test_case_id)
    REFERENCES test_cases(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE test_executions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  test_case_revision INTEGER NOT NULL CHECK (test_case_revision >= 1),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) BETWEEN 1 AND 256),
  status TEXT NOT NULL CHECK (status IN (
    'QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'CANCELLED', 'INTERRUPTED'
  )),
  definition_snapshot_json TEXT NOT NULL
    CHECK (json_valid(definition_snapshot_json) AND json_type(definition_snapshot_json) = 'object'
      AND length(CAST(definition_snapshot_json AS BLOB)) <= 2097152),
  inputs_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(inputs_json) AND json_type(inputs_json) = 'object'),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  UNIQUE(project_id, idempotency_key),
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, test_case_id)
    REFERENCES test_cases(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX test_executions_project_created_index
ON test_executions(project_id, created_at DESC, id DESC);

CREATE TABLE test_execution_steps (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  step_id TEXT NOT NULL CHECK (step_id = trim(step_id) AND length(step_id) BETWEEN 1 AND 128),
  position INTEGER NOT NULL CHECK (position >= 0),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  status TEXT NOT NULL CHECK (status IN (
    'PENDING', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'SKIPPED', 'CANCELLED'
  )),
  run_id TEXT,
  workflow_execution_id TEXT,
  resolved_arguments_json TEXT
    CHECK (resolved_arguments_json IS NULL OR
      (json_valid(resolved_arguments_json) AND json_type(resolved_arguments_json) = 'object')),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  UNIQUE(execution_id, step_id, attempt),
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, execution_id)
    REFERENCES test_executions(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, run_id)
    REFERENCES runs(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, workflow_execution_id)
    REFERENCES workflow_executions(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE test_assertion_results (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  step_record_id TEXT,
  assertion_id TEXT NOT NULL CHECK (assertion_id = trim(assertion_id) AND length(assertion_id) BETWEEN 1 AND 128),
  position INTEGER NOT NULL CHECK (position >= 0),
  status TEXT NOT NULL CHECK (status IN ('PASSED', 'FAILED', 'ERROR')),
  definition_json TEXT NOT NULL
    CHECK (json_valid(definition_json) AND json_type(definition_json) = 'object'),
  resolved_path TEXT,
  actual_summary_json TEXT CHECK (actual_summary_json IS NULL OR json_valid(actual_summary_json)),
  expected_summary_json TEXT CHECK (expected_summary_json IS NULL OR json_valid(expected_summary_json)),
  error_code TEXT,
  message TEXT CHECK (message IS NULL OR length(message) <= 2000),
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  redacted INTEGER NOT NULL DEFAULT 0 CHECK (redacted IN (0, 1)),
  UNIQUE(execution_id, step_record_id, assertion_id, position),
  FOREIGN KEY(project_id, execution_id)
    REFERENCES test_executions(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, step_record_id)
    REFERENCES test_execution_steps(project_id, id) ON DELETE CASCADE
);

CREATE TABLE test_execution_variables (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 128),
  value_json TEXT CHECK (value_json IS NULL OR json_valid(value_json)),
  redacted INTEGER NOT NULL DEFAULT 0 CHECK (redacted IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE(execution_id, name),
  FOREIGN KEY(project_id, execution_id)
    REFERENCES test_executions(project_id, id) ON DELETE CASCADE
);

CREATE TABLE test_suite_executions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  suite_id TEXT NOT NULL,
  suite_revision INTEGER NOT NULL CHECK (suite_revision >= 1),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) BETWEEN 1 AND 256),
  status TEXT NOT NULL CHECK (status IN (
    'QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'CANCELLED', 'INTERRUPTED'
  )),
  suite_snapshot_json TEXT NOT NULL
    CHECK (json_valid(suite_snapshot_json) AND json_type(suite_snapshot_json) = 'object'),
  summary_json TEXT CHECK (summary_json IS NULL OR json_valid(summary_json)),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  UNIQUE(project_id, idempotency_key),
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, suite_id)
    REFERENCES test_suites(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX test_suite_executions_project_created_index
ON test_suite_executions(project_id, created_at DESC, id DESC);

CREATE TABLE test_suite_execution_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  suite_execution_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  test_execution_id TEXT,
  position INTEGER NOT NULL CHECK (position >= 0),
  status TEXT NOT NULL CHECK (status IN (
    'QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'CANCELLED', 'INTERRUPTED'
  )),
  UNIQUE(suite_execution_id, member_id),
  UNIQUE(suite_execution_id, position),
  FOREIGN KEY(project_id, suite_execution_id)
    REFERENCES test_suite_executions(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, member_id)
    REFERENCES test_suite_members(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, test_execution_id)
    REFERENCES test_executions(project_id, id) ON DELETE RESTRICT
);
