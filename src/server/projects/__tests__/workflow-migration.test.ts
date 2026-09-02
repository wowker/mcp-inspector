import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../project-service.js";

describe("workflow migration", () => {
  const dataRoots: string[] = [];

  afterEach(() => {
    for (const dataRoot of dataRoots.splice(0)) {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it("applies migration 11 once with scoped workflow storage and constraints", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-workflows-"));
    dataRoots.push(dataRoot);
    const projects = createProjectService({ dataRoot });
    const project = projects.create("Workflow tests");
    const store = projects.open(project.id);

    expect(store.database.prepare(
      "SELECT version FROM schema_migrations ORDER BY version",
    ).all()).toEqual(
      Array.from({ length: 18 }, (_, index) => ({ version: index + 1 })),
    );
    expect(store.database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND (name LIKE 'workflow_%' OR name = 'tool_workflows' OR name = 'environment_variables')
      ORDER BY name
    `).all()).toEqual([
      { name: "environment_variables" },
      { name: "tool_workflows" },
      { name: "workflow_events" },
      { name: "workflow_execution_runs" },
      { name: "workflow_executions" },
    ]);

    const connectionId = "00000000-0000-4000-8000-000000000201";
    const snapshotId = "00000000-0000-4000-8000-000000000202";
    store.database.prepare(`
      INSERT INTO connections
        (id, project_id, name, url, transport, auth_mode, timeout_ms, created_at, updated_at)
      VALUES (?, ?, 'Workflow server', 'https://example.test/mcp', 'streamable-http', 'none',
              10000, '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z')
    `).run(connectionId, project.id);
    store.database.prepare(`
      INSERT INTO tool_snapshots
        (id, project_id, connection_id, tool_name, content_hash, definition_json, created_at)
      VALUES (?, ?, ?, 'main', 'hash', '{}', '2026-08-27T00:00:00.000Z')
    `).run(snapshotId, project.id, connectionId);
    store.database.prepare(`
      INSERT INTO tools
        (project_id, connection_id, name, current_snapshot_id, status, updated_at)
      VALUES (?, ?, 'main', ?, 'current', '2026-08-27T00:00:00.000Z')
    `).run(project.id, connectionId, snapshotId);

    const insertWorkflow = store.database.prepare(`
      INSERT INTO tool_workflows
        (project_id, connection_id, tool_name, revision, before_enabled, before_source,
         after_enabled, after_source, timeout_ms, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, '', 0, '', ?,
              '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z')
    `);
    insertWorkflow.run(project.id, connectionId, "main", 0, 5000);
    expect(() => insertWorkflow.run(project.id, connectionId, "main", 2, 5000))
      .toThrow();
    expect(() => insertWorkflow.run(
      project.id,
      "00000000-0000-4000-8000-000000000299",
      "main",
      0,
      5000,
    )).toThrow(/foreign key/i);

    const insertVariable = store.database.prepare(`
      INSERT INTO environment_variables
        (id, project_id, connection_id, name, value_json, secret, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z')
    `);
    insertVariable.run(
      "00000000-0000-4000-8000-000000000203",
      project.id,
      null,
      "region",
      '"us"',
      0,
    );
    expect(() => insertVariable.run(
      "00000000-0000-4000-8000-000000000204",
      project.id,
      null,
      "region",
      '"eu"',
      0,
    )).toThrow(/unique/i);
    insertVariable.run(
      "00000000-0000-4000-8000-000000000205",
      project.id,
      connectionId,
      "region",
      '"server-value"',
      1,
    );
    expect(() => insertVariable.run(
      "00000000-0000-4000-8000-000000000206",
      project.id,
      "00000000-0000-4000-8000-000000000299",
      "region",
      '"bad"',
      0,
    )).toThrow(/foreign key/i);

    projects.close();
    const reopened = createProjectService({ dataRoot });
    try {
      const reopenedStore = reopened.open(project.id);
      expect(reopenedStore.database.prepare(
        "SELECT count(*) AS count FROM schema_migrations WHERE version = 11",
      ).get()).toEqual({ count: 1 });
      expect(reopenedStore.database.prepare(
        "SELECT count(*) AS count FROM tool_workflows",
      ).get()).toEqual({ count: 1 });
    } finally {
      reopened.close();
    }
  });
});
