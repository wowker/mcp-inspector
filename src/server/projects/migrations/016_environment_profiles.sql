CREATE TABLE environment_profiles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  parent_profile_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, parent_profile_id)
    REFERENCES environment_profiles(project_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX environment_profiles_project_name_unique
ON environment_profiles(project_id, name COLLATE NOCASE);

CREATE INDEX environment_profiles_project_parent_index
ON environment_profiles(project_id, parent_profile_id);

CREATE TABLE environment_profile_variables (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  connection_id TEXT,
  name TEXT NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 128),
  mode TEXT NOT NULL CHECK (mode IN ('value', 'unset')),
  value_json TEXT,
  secret INTEGER NOT NULL DEFAULT 0 CHECK (secret IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (mode = 'value' AND value_json IS NOT NULL AND json_valid(value_json)) OR
    (mode = 'unset' AND value_json IS NULL AND secret = 0)
  ),
  FOREIGN KEY(project_id, profile_id)
    REFERENCES environment_profiles(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, connection_id)
    REFERENCES connections(project_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX environment_profile_variables_project_name_unique
ON environment_profile_variables(project_id, profile_id, name COLLATE NOCASE)
WHERE connection_id IS NULL;

CREATE UNIQUE INDEX environment_profile_variables_server_name_unique
ON environment_profile_variables(project_id, profile_id, connection_id, name COLLATE NOCASE)
WHERE connection_id IS NOT NULL;
