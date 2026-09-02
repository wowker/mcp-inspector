ALTER TABLE test_suite_members ADD COLUMN deleted_at TEXT;

CREATE INDEX test_suite_members_active_index
ON test_suite_members(project_id, suite_id, position)
WHERE deleted_at IS NULL;
