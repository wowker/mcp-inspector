CREATE TABLE validation_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('DRAFT', 'TEST_CASE', 'TEST_SUITE')),
  source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  source_digest TEXT NOT NULL CHECK (length(source_digest) = 64),
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('MANUAL_EXECUTION', 'AGENT_DRIVEN')),
  phase TEXT NOT NULL CHECK (phase IN (
    'DRAFT', 'VALIDATED', 'READY', 'RUNNING', 'EVALUATING',
    'COMPLETED', 'CANCELLED', 'INTERRUPTED', 'ERROR'
  )),
  machine_verdict TEXT CHECK (machine_verdict IS NULL OR machine_verdict IN ('PASS', 'FAIL', 'INCONCLUSIVE', 'ERROR')),
  review_state TEXT NOT NULL DEFAULT 'NOT_READY'
    CHECK (review_state IN ('NOT_READY', 'PENDING', 'APPROVED', 'NEEDS_CHANGE', 'REJECTED')),
  source_snapshot_json TEXT NOT NULL
    CHECK (json_valid(source_snapshot_json) AND json_type(source_snapshot_json) = 'object'
      AND length(CAST(source_snapshot_json AS BLOB)) <= 2097152),
  tool_schema_hashes_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(tool_schema_hashes_json) AND json_type(tool_schema_hashes_json) = 'object'
      AND length(CAST(tool_schema_hashes_json AS BLOB)) <= 1048576),
  draft_execution_id TEXT,
  test_execution_id TEXT,
  suite_execution_id TEXT,
  evidence_version INTEGER CHECK (evidence_version IS NULL OR evidence_version >= 1),
  evidence_digest TEXT CHECK (evidence_digest IS NULL OR length(evidence_digest) = 64),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, idempotency_key),
  FOREIGN KEY(project_id, draft_execution_id)
    REFERENCES authoring_draft_executions(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, test_execution_id)
    REFERENCES test_executions(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, suite_execution_id)
    REFERENCES test_suite_executions(project_id, id) ON DELETE RESTRICT,
  CHECK ((evidence_version IS NULL) = (evidence_digest IS NULL))
);

CREATE UNIQUE INDEX validation_sessions_one_active_source_idx
ON validation_sessions(project_id, source_kind, source_id)
WHERE phase IN ('READY', 'RUNNING', 'EVALUATING');

CREATE INDEX validation_sessions_project_created_idx
ON validation_sessions(project_id, created_at DESC, id DESC);

CREATE TRIGGER validation_sessions_source_immutable
BEFORE UPDATE OF project_id, source_kind, source_id, source_revision, source_digest,
  execution_mode, source_snapshot_json, tool_schema_hashes_json, idempotency_key, request_hash
ON validation_sessions
BEGIN
  SELECT RAISE(ABORT, 'Validation Session source snapshot is immutable');
END;

CREATE TABLE validation_evidence_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  evidence_digest TEXT NOT NULL CHECK (length(evidence_digest) = 64),
  machine_verdict TEXT NOT NULL CHECK (machine_verdict IN ('PASS', 'FAIL', 'INCONCLUSIVE', 'ERROR')),
  redaction_count INTEGER NOT NULL DEFAULT 0 CHECK (redaction_count >= 0),
  truncation_count INTEGER NOT NULL DEFAULT 0 CHECK (truncation_count >= 0),
  created_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, session_id, version),
  UNIQUE(project_id, session_id, evidence_digest),
  FOREIGN KEY(project_id, session_id)
    REFERENCES validation_sessions(project_id, id) ON DELETE CASCADE
);

CREATE TABLE validation_expectation_evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  evidence_version INTEGER NOT NULL CHECK (evidence_version >= 1),
  expectation_local_id TEXT NOT NULL
    CHECK (expectation_local_id = trim(expectation_local_id) AND length(expectation_local_id) BETWEEN 1 AND 128),
  machine_verdict TEXT NOT NULL CHECK (machine_verdict IN ('PASS', 'FAIL', 'INCONCLUSIVE', 'ERROR')),
  evidence_json TEXT NOT NULL
    CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'object'
      AND length(CAST(evidence_json AS BLOB)) <= 1048576),
  run_id TEXT,
  redaction_count INTEGER NOT NULL DEFAULT 0 CHECK (redaction_count >= 0),
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, session_id, evidence_version, expectation_local_id),
  FOREIGN KEY(project_id, session_id, evidence_version)
    REFERENCES validation_evidence_versions(project_id, session_id, version) ON DELETE CASCADE,
  FOREIGN KEY(project_id, run_id)
    REFERENCES runs(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE validation_ai_assessments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  evidence_digest TEXT NOT NULL CHECK (length(evidence_digest) = 64),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, session_id, version),
  UNIQUE(project_id, session_id, idempotency_key),
  FOREIGN KEY(project_id, session_id, evidence_digest)
    REFERENCES validation_evidence_versions(project_id, session_id, evidence_digest) ON DELETE CASCADE
);

CREATE TABLE validation_ai_assessment_findings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  assessment_version INTEGER NOT NULL CHECK (assessment_version >= 1),
  expectation_local_id TEXT NOT NULL
    CHECK (expectation_local_id = trim(expectation_local_id) AND length(expectation_local_id) BETWEEN 1 AND 128),
  verdict TEXT NOT NULL CHECK (verdict IN ('PASS', 'FAIL', 'INCONCLUSIVE')),
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  explanation TEXT NOT NULL CHECK (length(explanation) BETWEEN 1 AND 4000),
  suggested_classification TEXT CHECK (suggested_classification IS NULL OR suggested_classification IN (
    'IMPLEMENTATION_DEFECT', 'EXPECTATION_DEFECT', 'REQUIREMENT_CONFLICT',
    'ENVIRONMENT_ISSUE', 'MORE_EVIDENCE_REQUIRED'
  )),
  UNIQUE(project_id, id),
  UNIQUE(project_id, session_id, assessment_version, expectation_local_id),
  FOREIGN KEY(project_id, session_id, assessment_version)
    REFERENCES validation_ai_assessments(project_id, session_id, version) ON DELETE CASCADE
);

CREATE TRIGGER validation_sessions_evidence_binding
BEFORE UPDATE OF evidence_version, evidence_digest ON validation_sessions
WHEN NEW.evidence_version IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM validation_evidence_versions evidence
  WHERE evidence.project_id = NEW.project_id
    AND evidence.session_id = NEW.id
    AND evidence.version = NEW.evidence_version
    AND evidence.evidence_digest = NEW.evidence_digest
)
BEGIN
  SELECT RAISE(ABORT, 'Validation Session evidence binding is invalid');
END;

CREATE TRIGGER validation_evidence_versions_immutable
BEFORE UPDATE ON validation_evidence_versions
BEGIN
  SELECT RAISE(ABORT, 'Validation evidence is immutable');
END;

CREATE TRIGGER validation_evidence_versions_append_only
BEFORE DELETE ON validation_evidence_versions
BEGIN
  SELECT RAISE(ABORT, 'Validation evidence is append-only');
END;

CREATE TRIGGER validation_expectation_evidence_immutable
BEFORE UPDATE ON validation_expectation_evidence
BEGIN
  SELECT RAISE(ABORT, 'Validation expectation evidence is immutable');
END;

CREATE TRIGGER validation_expectation_evidence_append_only
BEFORE DELETE ON validation_expectation_evidence
BEGIN
  SELECT RAISE(ABORT, 'Validation expectation evidence is append-only');
END;

CREATE TRIGGER validation_ai_assessments_immutable
BEFORE UPDATE ON validation_ai_assessments
BEGIN
  SELECT RAISE(ABORT, 'Validation AI assessment is immutable');
END;

CREATE TRIGGER validation_ai_assessments_append_only
BEFORE DELETE ON validation_ai_assessments
BEGIN
  SELECT RAISE(ABORT, 'Validation AI assessment is append-only');
END;

CREATE TRIGGER validation_ai_assessment_findings_immutable
BEFORE UPDATE ON validation_ai_assessment_findings
BEGIN
  SELECT RAISE(ABORT, 'Validation AI assessment finding is immutable');
END;

CREATE TRIGGER validation_ai_assessment_findings_append_only
BEFORE DELETE ON validation_ai_assessment_findings
BEGIN
  SELECT RAISE(ABORT, 'Validation AI assessment finding is append-only');
END;
