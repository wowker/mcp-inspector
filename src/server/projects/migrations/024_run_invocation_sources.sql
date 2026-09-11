ALTER TABLE runs ADD COLUMN invocation_source TEXT NOT NULL DEFAULT 'MANUAL_DEBUG'
  CHECK (invocation_source IN (
    'MANUAL_DEBUG',
    'AUTHORING_STANDALONE',
    'AUTHORING_DRAFT',
    'AUTOMATED_TEST',
    'TEST_SUITE',
    'SCRIPT_WORKFLOW',
    'PRESSURE_TEST'
  ));

UPDATE runs
SET invocation_source = CASE
  WHEN EXISTS (
    SELECT 1 FROM authoring_tool_calls call
    WHERE call.project_id = runs.project_id AND call.run_id = runs.id AND call.context_kind = 'DRAFT'
  ) THEN 'AUTHORING_DRAFT'
  WHEN EXISTS (
    SELECT 1 FROM authoring_tool_calls call
    WHERE call.project_id = runs.project_id AND call.run_id = runs.id AND call.context_kind = 'STANDALONE'
  ) THEN 'AUTHORING_STANDALONE'
  WHEN EXISTS (
    SELECT 1
    FROM test_execution_steps step
    JOIN pressure_test_samples sample
      ON sample.project_id = step.project_id AND sample.test_execution_id = step.execution_id
    LEFT JOIN workflow_execution_runs workflow_run
      ON workflow_run.project_id = step.project_id
      AND workflow_run.execution_id = step.workflow_execution_id
    WHERE step.project_id = runs.project_id
      AND (step.run_id = runs.id OR workflow_run.run_id = runs.id)
  ) THEN 'PRESSURE_TEST'
  WHEN EXISTS (
    SELECT 1
    FROM test_execution_steps step
    JOIN test_suite_execution_items item
      ON item.project_id = step.project_id AND item.test_execution_id = step.execution_id
    LEFT JOIN workflow_execution_runs workflow_run
      ON workflow_run.project_id = step.project_id
      AND workflow_run.execution_id = step.workflow_execution_id
    WHERE step.project_id = runs.project_id
      AND (step.run_id = runs.id OR workflow_run.run_id = runs.id)
  ) THEN 'TEST_SUITE'
  WHEN EXISTS (
    SELECT 1
    FROM test_execution_steps step
    LEFT JOIN workflow_execution_runs workflow_run
      ON workflow_run.project_id = step.project_id
      AND workflow_run.execution_id = step.workflow_execution_id
    WHERE step.project_id = runs.project_id
      AND (step.run_id = runs.id OR workflow_run.run_id = runs.id)
  ) THEN 'AUTOMATED_TEST'
  WHEN EXISTS (
    SELECT 1 FROM workflow_execution_runs workflow_run
    WHERE workflow_run.project_id = runs.project_id AND workflow_run.run_id = runs.id
  ) THEN 'SCRIPT_WORKFLOW'
  ELSE 'MANUAL_DEBUG'
END;

CREATE INDEX runs_project_source_created_idx
ON runs(project_id, invocation_source, created_at DESC, id DESC);
