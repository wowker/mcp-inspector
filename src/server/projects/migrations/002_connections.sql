CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  url TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('streamable-http', 'sse')),
  auth_mode TEXT NOT NULL CHECK (auth_mode IN ('none', 'bearer', 'oauth')),
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 100 AND 600000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_protocol_version TEXT,
  last_server_info_json TEXT,
  last_error_json TEXT
);
CREATE INDEX connections_project_id_idx ON connections(project_id);
