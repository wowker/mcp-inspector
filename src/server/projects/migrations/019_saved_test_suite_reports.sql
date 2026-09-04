CREATE UNIQUE INDEX test_suite_executions_project_suite_identity
ON test_suite_executions(project_id, suite_id, id);

CREATE TABLE saved_test_suite_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  suite_id TEXT NOT NULL,
  suite_execution_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 120),
  version_label TEXT NOT NULL
    CHECK (version_label = trim(version_label) AND length(version_label) BETWEEN 1 AND 40),
  version_label_normalized TEXT NOT NULL
    CHECK (version_label_normalized = trim(version_label_normalized)
      AND length(version_label_normalized) BETWEEN 1 AND 40),
  note TEXT CHECK (note IS NULL OR (note = trim(note) AND length(note) <= 500)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) BETWEEN 1 AND 256),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, idempotency_key),
  UNIQUE(project_id, suite_id, version_label_normalized),
  FOREIGN KEY(project_id, suite_id)
    REFERENCES test_suites(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, suite_id, suite_execution_id)
    REFERENCES test_suite_executions(project_id, suite_id, id) ON DELETE RESTRICT
);

CREATE INDEX saved_test_suite_reports_project_created_index
ON saved_test_suite_reports(project_id, created_at DESC, id DESC);

CREATE INDEX saved_test_suite_reports_suite_created_index
ON saved_test_suite_reports(project_id, suite_id, created_at DESC, id DESC);
