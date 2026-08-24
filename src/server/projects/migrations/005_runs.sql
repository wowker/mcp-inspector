CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  tab_id TEXT REFERENCES debug_tabs(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  tool_snapshot_id TEXT NOT NULL REFERENCES tool_snapshots(id),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'queued','connecting','authorizing','running','succeeded','failed','cancelled','interrupted'
  )),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  network_duration_ms INTEGER,
  protocol_version TEXT,
  server_info_json TEXT,
  client_info_json TEXT NOT NULL,
  UNIQUE(project_id, idempotency_key)
);
CREATE TABLE run_requests (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  arguments_json TEXT NOT NULL,
  jsonrpc_json TEXT NOT NULL,
  http_json TEXT
);
CREATE TABLE run_responses (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  result_json TEXT,
  error_json TEXT,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  original_bytes INTEGER
);
CREATE TABLE run_events (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(run_id, sequence)
);
CREATE INDEX runs_project_created_idx ON runs(project_id, created_at DESC);
