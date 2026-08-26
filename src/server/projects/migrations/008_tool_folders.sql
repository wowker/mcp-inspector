CREATE UNIQUE INDEX tools_project_connection_name_unique
ON tools(project_id, connection_id, name);

CREATE UNIQUE INDEX connections_project_id_unique
ON connections(project_id, id);

CREATE TABLE tool_folders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id, connection_id)
    REFERENCES connections(project_id, id) ON DELETE CASCADE,
  UNIQUE(connection_id, name COLLATE NOCASE),
  UNIQUE(project_id, connection_id, id)
);

CREATE TABLE tool_folder_assignments (
  project_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  PRIMARY KEY(connection_id, tool_name),
  FOREIGN KEY(project_id, connection_id, tool_name)
    REFERENCES tools(project_id, connection_id, name) ON DELETE CASCADE,
  FOREIGN KEY(project_id, connection_id, folder_id)
    REFERENCES tool_folders(project_id, connection_id, id) ON DELETE CASCADE
);

CREATE INDEX tool_folder_assignments_folder_index
ON tool_folder_assignments(project_id, connection_id, folder_id);
