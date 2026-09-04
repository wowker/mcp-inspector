CREATE TABLE pressure_tests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  test_case_id TEXT NOT NULL,
  inputs_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(inputs_json) AND json_type(inputs_json) = 'object'
      AND length(CAST(inputs_json AS BLOB)) <= 2097152),
  load_json TEXT NOT NULL
    CHECK (json_valid(load_json) AND json_type(load_json) = 'object'),
  thresholds_json TEXT NOT NULL
    CHECK (json_valid(thresholds_json) AND json_type(thresholds_json) = 'object'),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, test_case_id)
    REFERENCES test_cases(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX pressure_tests_project_updated_index
ON pressure_tests(project_id, updated_at DESC, id DESC);

CREATE TABLE pressure_test_executions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  pressure_test_id TEXT NOT NULL,
  pressure_test_revision INTEGER NOT NULL CHECK (pressure_test_revision >= 1),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) BETWEEN 1 AND 256),
  status TEXT NOT NULL CHECK (status IN (
    'QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'CANCELLED', 'INTERRUPTED'
  )),
  definition_snapshot_json TEXT NOT NULL
    CHECK (json_valid(definition_snapshot_json) AND json_type(definition_snapshot_json) = 'object'
      AND length(CAST(definition_snapshot_json AS BLOB)) <= 2097152),
  target_snapshot_json TEXT NOT NULL
    CHECK (json_valid(target_snapshot_json) AND json_type(target_snapshot_json) = 'object'),
  summary_json TEXT CHECK (summary_json IS NULL OR
    (json_valid(summary_json) AND json_type(summary_json) = 'object')),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  UNIQUE(project_id, id),
  UNIQUE(project_id, idempotency_key),
  FOREIGN KEY(project_id, pressure_test_id)
    REFERENCES pressure_tests(project_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX pressure_test_executions_one_active_per_project
ON pressure_test_executions(project_id)
WHERE status IN ('QUEUED', 'RUNNING');

CREATE INDEX pressure_test_executions_project_created_index
ON pressure_test_executions(project_id, created_at DESC, id DESC);

CREATE TABLE pressure_test_samples (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  pressure_test_execution_id TEXT NOT NULL,
  test_execution_id TEXT NOT NULL,
  virtual_user INTEGER NOT NULL CHECK (virtual_user BETWEEN 1 AND 20),
  iteration INTEGER NOT NULL CHECK (iteration BETWEEN 1 AND 1000),
  status TEXT NOT NULL CHECK (status IN ('PASSED', 'FAILED', 'ERROR', 'CANCELLED')),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  UNIQUE(project_id, id),
  UNIQUE(pressure_test_execution_id, iteration),
  FOREIGN KEY(project_id, pressure_test_execution_id)
    REFERENCES pressure_test_executions(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, test_execution_id)
    REFERENCES test_executions(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX pressure_test_samples_execution_index
ON pressure_test_samples(project_id, pressure_test_execution_id, iteration);

CREATE INDEX pressure_test_samples_execution_duration_index
ON pressure_test_samples(project_id, pressure_test_execution_id, duration_ms DESC, id DESC);
