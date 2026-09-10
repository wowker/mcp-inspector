CREATE TABLE authoring_tool_calls (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  context_kind TEXT NOT NULL CHECK (context_kind IN ('STANDALONE', 'DRAFT')),
  context_label TEXT CHECK (context_label IS NULL OR
    (context_label = trim(context_label) AND length(context_label) BETWEEN 1 AND 200)),
  draft_id TEXT,
  draft_revision INTEGER CHECK (draft_revision IS NULL OR draft_revision >= 1),
  connection_id TEXT NOT NULL,
  tool_name TEXT NOT NULL CHECK (tool_name = trim(tool_name) AND length(tool_name) BETWEEN 1 AND 512),
  tool_snapshot_id TEXT REFERENCES tool_snapshots(id) ON DELETE SET NULL,
  tool_schema_hash TEXT NOT NULL CHECK (length(tool_schema_hash) = 64),
  purpose TEXT NOT NULL CHECK (purpose IN ('DIAGNOSTIC', 'DISCOVERY', 'SETUP', 'ACTION', 'POLL', 'CLEANUP')),
  cleanup_for_call_id TEXT REFERENCES authoring_tool_calls(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  arguments_json TEXT NOT NULL
    CHECK (json_valid(arguments_json) AND json_type(arguments_json) = 'object'
      AND length(CAST(arguments_json AS BLOB)) <= 2097152),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'BLOCKED', 'CANCELLED')),
  may_have_side_effects INTEGER NOT NULL DEFAULT 0 CHECK (may_have_side_effects IN (0, 1)),
  summary_json TEXT CHECK (summary_json IS NULL OR
    (json_valid(summary_json) AND length(CAST(summary_json AS BLOB)) <= 1048576)),
  error_json TEXT CHECK (error_json IS NULL OR
    (json_valid(error_json) AND length(CAST(error_json AS BLOB)) <= 1048576)),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  UNIQUE(project_id, id),
  UNIQUE(project_id, idempotency_key),
  CHECK (
    (context_kind = 'STANDALONE' AND draft_id IS NULL AND draft_revision IS NULL)
    OR (context_kind = 'DRAFT' AND draft_id IS NOT NULL AND draft_revision IS NOT NULL)
  ),
  FOREIGN KEY(project_id, draft_id, draft_revision)
    REFERENCES authoring_draft_revisions(project_id, draft_id, revision) ON DELETE CASCADE
);

CREATE INDEX authoring_tool_calls_project_created_idx
ON authoring_tool_calls(project_id, created_at DESC, id DESC);

CREATE INDEX authoring_tool_calls_connection_created_idx
ON authoring_tool_calls(project_id, connection_id, created_at DESC, id DESC);

CREATE INDEX authoring_tool_calls_draft_created_idx
ON authoring_tool_calls(project_id, draft_id, created_at DESC, id DESC)
WHERE draft_id IS NOT NULL;

CREATE INDEX authoring_tool_calls_status_idx
ON authoring_tool_calls(project_id, status, created_at, id);

CREATE TRIGGER authoring_tool_calls_snapshot_identity_insert
BEFORE INSERT ON authoring_tool_calls
WHEN NEW.tool_snapshot_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM tool_snapshots
  WHERE id = NEW.tool_snapshot_id
    AND project_id = NEW.project_id
    AND connection_id = NEW.connection_id
    AND tool_name = NEW.tool_name
)
BEGIN
  SELECT RAISE(ABORT, 'Authoring call Tool snapshot identity is invalid');
END;

CREATE TRIGGER authoring_tool_calls_snapshot_identity_update
BEFORE UPDATE OF project_id, connection_id, tool_name, tool_snapshot_id ON authoring_tool_calls
WHEN NEW.tool_snapshot_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM tool_snapshots
  WHERE id = NEW.tool_snapshot_id
    AND project_id = NEW.project_id
    AND connection_id = NEW.connection_id
    AND tool_name = NEW.tool_name
)
BEGIN
  SELECT RAISE(ABORT, 'Authoring call Tool snapshot identity is invalid');
END;

CREATE TRIGGER authoring_tool_calls_run_project_insert
BEFORE INSERT ON authoring_tool_calls
WHEN NEW.run_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM runs WHERE id = NEW.run_id AND project_id = NEW.project_id)
BEGIN
  SELECT RAISE(ABORT, 'Authoring call Run must belong to the same project');
END;

CREATE TRIGGER authoring_tool_calls_run_project_update
BEFORE UPDATE OF project_id, run_id ON authoring_tool_calls
WHEN NEW.run_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM runs WHERE id = NEW.run_id AND project_id = NEW.project_id)
BEGIN
  SELECT RAISE(ABORT, 'Authoring call Run must belong to the same project');
END;

CREATE TRIGGER authoring_tool_calls_cleanup_project_insert
BEFORE INSERT ON authoring_tool_calls
WHEN NEW.cleanup_for_call_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM authoring_tool_calls
    WHERE id = NEW.cleanup_for_call_id AND project_id = NEW.project_id
  )
BEGIN
  SELECT RAISE(ABORT, 'Authoring cleanup call must belong to the same project');
END;

CREATE TRIGGER authoring_tool_calls_cleanup_project_update
BEFORE UPDATE OF project_id, cleanup_for_call_id ON authoring_tool_calls
WHEN NEW.cleanup_for_call_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM authoring_tool_calls
    WHERE id = NEW.cleanup_for_call_id AND project_id = NEW.project_id
  )
BEGIN
  SELECT RAISE(ABORT, 'Authoring cleanup call must belong to the same project');
END;
