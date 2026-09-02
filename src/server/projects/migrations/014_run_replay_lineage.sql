ALTER TABLE runs ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));
ALTER TABLE runs ADD COLUMN replayed_from_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL;

CREATE INDEX runs_project_pinned_created_idx
  ON runs(project_id, pinned DESC, created_at DESC, id DESC);
CREATE INDEX runs_replayed_from_idx
  ON runs(replayed_from_run_id, created_at ASC, id ASC);

CREATE TRIGGER runs_replay_source_insert_guard
BEFORE INSERT ON runs
WHEN NEW.replayed_from_run_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.replayed_from_run_id = NEW.id
      OR NOT EXISTS (
        SELECT 1 FROM runs source
        WHERE source.id = NEW.replayed_from_run_id
          AND source.project_id = NEW.project_id
      )
    THEN RAISE(ABORT, 'replay source must be a different Run in the same project')
  END;
END;

CREATE TRIGGER runs_replay_source_update_guard
BEFORE UPDATE OF replayed_from_run_id, project_id ON runs
WHEN NEW.replayed_from_run_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.replayed_from_run_id = NEW.id
      OR NOT EXISTS (
        SELECT 1 FROM runs source
        WHERE source.id = NEW.replayed_from_run_id
          AND source.project_id = NEW.project_id
      )
    THEN RAISE(ABORT, 'replay source must be a different Run in the same project')
  END;
END;
