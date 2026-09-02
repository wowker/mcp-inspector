CREATE TABLE connection_environment_profiles (
  project_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, connection_id),
  FOREIGN KEY(project_id, connection_id)
    REFERENCES connections(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, profile_id)
    REFERENCES environment_profiles(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX connection_environment_profiles_project_profile_index
ON connection_environment_profiles(project_id, profile_id);
