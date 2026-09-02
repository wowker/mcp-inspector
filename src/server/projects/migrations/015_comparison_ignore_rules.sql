CREATE TABLE comparison_ignore_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  expression TEXT NOT NULL CHECK (
    length(expression) BETWEEN 1 AND 512
    AND substr(expression, 1, 1) = '$'
  ),
  position INTEGER NOT NULL CHECK (position >= 0 AND position < 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, expression),
  UNIQUE (project_id, position),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX comparison_ignore_rules_project_position_idx
  ON comparison_ignore_rules(project_id, position, id);
