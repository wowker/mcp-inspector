CREATE TABLE authoring_drafts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'APPLIED', 'DISCARDED')),
  goal TEXT NOT NULL DEFAULT '' CHECK (length(goal) <= 2000),
  definition_json TEXT NOT NULL
    CHECK (json_valid(definition_json) AND json_type(definition_json) = 'object'
      AND length(CAST(definition_json AS BLOB)) <= 2097152),
  definition_digest TEXT NOT NULL CHECK (length(definition_digest) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, id)
);

CREATE INDEX authoring_drafts_project_updated_idx
ON authoring_drafts(project_id, updated_at DESC, id DESC);

CREATE TABLE authoring_draft_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  definition_json TEXT NOT NULL
    CHECK (json_valid(definition_json) AND json_type(definition_json) = 'object'
      AND length(CAST(definition_json AS BLOB)) <= 2097152),
  definition_digest TEXT NOT NULL CHECK (length(definition_digest) = 64),
  created_at TEXT NOT NULL,
  UNIQUE(draft_id, revision),
  UNIQUE(project_id, id),
  UNIQUE(project_id, draft_id, revision),
  FOREIGN KEY(project_id, draft_id)
    REFERENCES authoring_drafts(project_id, id) ON DELETE CASCADE
);

CREATE TABLE authoring_idempotency_records (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  operation TEXT NOT NULL CHECK (operation = trim(operation) AND length(operation) BETWEEN 1 AND 80),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  resource_id TEXT CHECK (resource_id IS NULL OR length(resource_id) BETWEEN 1 AND 200),
  result_json TEXT CHECK (result_json IS NULL OR
    (json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 1048576)),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY(project_id, idempotency_key)
);

CREATE TABLE authoring_draft_validations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL CHECK (draft_revision >= 1),
  definition_digest TEXT NOT NULL CHECK (length(definition_digest) = 64),
  tool_schema_hashes_json TEXT NOT NULL
    CHECK (json_valid(tool_schema_hashes_json) AND json_type(tool_schema_hashes_json) = 'object'
      AND length(CAST(tool_schema_hashes_json AS BLOB)) <= 1048576),
  validation_digest TEXT NOT NULL CHECK (length(validation_digest) = 64),
  status TEXT NOT NULL CHECK (status IN ('VALID', 'INVALID')),
  issues_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(issues_json) AND json_type(issues_json) = 'array'
      AND length(CAST(issues_json AS BLOB)) <= 1048576),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, draft_id, draft_revision, id),
  UNIQUE(draft_id, draft_revision, validation_digest),
  FOREIGN KEY(project_id, draft_id, draft_revision)
    REFERENCES authoring_draft_revisions(project_id, draft_id, revision) ON DELETE CASCADE
);

CREATE INDEX authoring_draft_validations_draft_created_idx
ON authoring_draft_validations(project_id, draft_id, created_at DESC, id DESC);

CREATE TABLE authoring_draft_executions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL CHECK (draft_revision >= 1),
  definition_digest TEXT NOT NULL CHECK (length(definition_digest) = 64),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  status TEXT NOT NULL CHECK (status IN (
    'QUEUED', 'VALIDATING', 'RUNNING_SETUP', 'RUNNING_STEPS', 'RUNNING_ASSERTIONS',
    'RUNNING_CLEANUP', 'PASSED', 'FAILED', 'ERROR', 'CANCELLED', 'INTERRUPTED'
  )),
  inputs_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(inputs_json) AND json_type(inputs_json) = 'object'
      AND length(CAST(inputs_json AS BLOB)) <= 2097152),
  result_json TEXT CHECK (result_json IS NULL OR
    (json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 1048576)),
  error_json TEXT CHECK (error_json IS NULL OR
    (json_valid(error_json) AND length(CAST(error_json AS BLOB)) <= 1048576)),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  UNIQUE(project_id, id),
  UNIQUE(project_id, idempotency_key),
  FOREIGN KEY(project_id, draft_id, draft_revision)
    REFERENCES authoring_draft_revisions(project_id, draft_id, revision) ON DELETE CASCADE
);

CREATE UNIQUE INDEX authoring_draft_executions_one_active_idx
ON authoring_draft_executions(project_id, draft_id)
WHERE status IN ('QUEUED', 'VALIDATING', 'RUNNING_SETUP', 'RUNNING_STEPS', 'RUNNING_ASSERTIONS', 'RUNNING_CLEANUP');

CREATE INDEX authoring_draft_executions_draft_created_idx
ON authoring_draft_executions(project_id, draft_id, created_at DESC, id DESC);

CREATE TABLE authoring_draft_apply_results (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL CHECK (draft_revision >= 1),
  validation_id TEXT NOT NULL,
  validation_digest TEXT NOT NULL CHECK (length(validation_digest) = 64),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('APPLYING', 'APPLIED', 'FAILED')),
  result_json TEXT CHECK (result_json IS NULL OR
    (json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 1048576)),
  error_json TEXT CHECK (error_json IS NULL OR
    (json_valid(error_json) AND length(CAST(error_json AS BLOB)) <= 1048576)),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(project_id, id),
  UNIQUE(project_id, draft_id, id),
  UNIQUE(project_id, idempotency_key),
  FOREIGN KEY(project_id, draft_id, draft_revision, validation_id)
    REFERENCES authoring_draft_validations(project_id, draft_id, draft_revision, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX authoring_draft_apply_one_success_idx
ON authoring_draft_apply_results(project_id, draft_id)
WHERE status = 'APPLIED';

CREATE TABLE authoring_draft_asset_mappings (
  project_id TEXT NOT NULL,
  apply_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  draft_local_id TEXT NOT NULL CHECK (draft_local_id = trim(draft_local_id) AND length(draft_local_id) BETWEEN 1 AND 128),
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('TEST_CASE', 'TEST_SUITE')),
  formal_asset_id TEXT NOT NULL,
  formal_revision INTEGER NOT NULL CHECK (formal_revision >= 1),
  PRIMARY KEY(apply_id, draft_local_id),
  UNIQUE(project_id, draft_id, draft_local_id),
  FOREIGN KEY(project_id, draft_id, apply_id)
    REFERENCES authoring_draft_apply_results(project_id, draft_id, id) ON DELETE CASCADE
);
