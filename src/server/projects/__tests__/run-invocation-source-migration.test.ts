import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../project-service.js";

describe("Run invocation source migration", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it("backfills manual, Authoring, and nested automated-test Runs without losing existing history", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-run-source-data-"));
    const legacyMigrations = mkdtempSync(join(tmpdir(), "inspector-run-source-migrations-"));
    roots.push(dataRoot, legacyMigrations);
    const source = new URL("../migrations/", import.meta.url);
    for (const name of readdirSync(source).filter((entry) => /^(00[1-9]|01\d|02[0-3])_/.test(entry))) {
      cpSync(new URL(name, source), join(legacyMigrations, name));
    }
    const legacy = createProjectService({ dataRoot, migrationsUrl: pathToFileURL(`${legacyMigrations}/`) });
    const project = legacy.create("Run sources");
    const database = legacy.open(project.id).database;
    const connectionId = "00000000-0000-4000-8000-000000000931";
    const snapshotId = "00000000-0000-4000-8000-000000000932";
    const manualRunId = "00000000-0000-4000-8000-000000000933";
    const agentRunId = "00000000-0000-4000-8000-000000000934";
    const workflowMainRunId = "00000000-0000-4000-8000-000000000936";
    const workflowHelperRunId = "00000000-0000-4000-8000-000000000937";
    const now = "2026-09-10T00:00:00.000Z";
    database.prepare(`INSERT INTO connections
      (id, project_id, name, url, transport, auth_mode, timeout_ms, created_at, updated_at)
      VALUES (?, ?, 'Server', 'https://example.test/mcp', 'streamable-http', 'none', 10000, ?, ?)`)
      .run(connectionId, project.id, now, now);
    database.prepare(`INSERT INTO tool_snapshots
      (id, project_id, connection_id, tool_name, content_hash, definition_json, created_at)
      VALUES (?, ?, ?, 'sum', ?, '{"name":"sum","inputSchema":{"type":"object"}}', ?)`)
      .run(snapshotId, project.id, connectionId, "a".repeat(64), now);
    database.prepare(`INSERT INTO tools
      (project_id, connection_id, name, current_snapshot_id, status, updated_at)
      VALUES (?, ?, 'sum', ?, 'current', ?)`).run(project.id, connectionId, snapshotId, now);
    const insertRun = database.prepare(`INSERT INTO runs
      (id, project_id, connection_id, tab_id, tool_name, tool_snapshot_id, idempotency_key,
       status, created_at, client_info_json) VALUES (?, ?, ?, NULL, 'sum', ?, ?, 'succeeded', ?, '{}')`);
    insertRun.run(manualRunId, project.id, connectionId, snapshotId, "manual", now);
    insertRun.run(agentRunId, project.id, connectionId, snapshotId, "agent", now);
    insertRun.run(workflowMainRunId, project.id, connectionId, snapshotId, "workflow-main", now);
    insertRun.run(workflowHelperRunId, project.id, connectionId, snapshotId, "workflow-helper", now);
    database.prepare(`INSERT INTO authoring_tool_calls
      (id, project_id, context_kind, connection_id, tool_name, tool_snapshot_id, tool_schema_hash,
       purpose, run_id, idempotency_key, request_hash, arguments_json, status, created_at)
      VALUES ('00000000-0000-4000-8000-000000000935', ?, 'STANDALONE', ?, 'sum', ?, ?,
       'DIAGNOSTIC', ?, 'authoring', ?, '{}', 'SUCCEEDED', ?)`)
      .run(project.id, connectionId, snapshotId, "a".repeat(64), agentRunId, "b".repeat(64), now);
    const workflowExecutionId = "00000000-0000-4000-8000-000000000938";
    database.prepare(`INSERT INTO workflow_executions
      (id, project_id, connection_id, tab_id, tool_name, tool_snapshot_id, idempotency_key,
       status, initial_arguments_json, workflow_snapshot_json, created_at)
      VALUES (?, ?, ?, NULL, 'sum', ?, 'workflow', 'succeeded', '{}', '{}', ?)`)
      .run(workflowExecutionId, project.id, connectionId, snapshotId, now);
    const linkWorkflowRun = database.prepare(`INSERT INTO workflow_execution_runs
      (project_id, execution_id, run_id, phase, ordinal) VALUES (?, ?, ?, ?, ?)`);
    linkWorkflowRun.run(project.id, workflowExecutionId, workflowHelperRunId, "helper-before", 0);
    linkWorkflowRun.run(project.id, workflowExecutionId, workflowMainRunId, "main", 1);
    const testCaseId = "00000000-0000-4000-8000-000000000939";
    const testExecutionId = "00000000-0000-4000-8000-000000000940";
    database.prepare(`INSERT INTO test_cases
      (id, project_id, kind, name, definition_json, created_at, updated_at)
      VALUES (?, ?, 'tool', 'Workflow test', '{}', ?, ?)`).run(testCaseId, project.id, now, now);
    database.prepare(`INSERT INTO test_executions
      (id, project_id, test_case_id, test_case_revision, idempotency_key, request_hash,
       status, definition_snapshot_json, inputs_json, created_at)
      VALUES (?, ?, ?, 1, 'test', ?, 'PASSED', '{}', '{}', ?)`)
      .run(testExecutionId, project.id, testCaseId, "c".repeat(64), now);
    database.prepare(`INSERT INTO test_execution_steps
      (id, project_id, execution_id, step_id, position, status, run_id, workflow_execution_id)
      VALUES ('00000000-0000-4000-8000-000000000941', ?, ?, 'tool', 0, 'PASSED', ?, ?)`)
      .run(project.id, testExecutionId, workflowMainRunId, workflowExecutionId);
    legacy.close();

    const upgraded = createProjectService({ dataRoot });
    try {
      const current = upgraded.open(project.id).database;
      expect(current.prepare("SELECT max(version) AS version FROM schema_migrations").get()).toEqual({ version: 26 });
      expect(current.prepare("SELECT id, invocation_source FROM runs ORDER BY id").all()).toEqual([
        { id: manualRunId, invocation_source: "MANUAL_DEBUG" },
        { id: agentRunId, invocation_source: "AUTHORING_STANDALONE" },
        { id: workflowMainRunId, invocation_source: "AUTOMATED_TEST" },
        { id: workflowHelperRunId, invocation_source: "AUTOMATED_TEST" },
      ]);
      expect(() => current.prepare("UPDATE runs SET invocation_source = 'SPOOFED' WHERE id = ?").run(manualRunId))
        .toThrow(/check constraint/i);
    } finally { upgraded.close(); }
  });
});
