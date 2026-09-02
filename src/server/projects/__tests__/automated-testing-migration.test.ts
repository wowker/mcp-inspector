import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../project-service.js";
import { resolveDefaultMigrationsUrl } from "../project-store.js";

describe("automated testing migration", () => {
  const dataRoots: string[] = [];

  afterEach(() => {
    for (const dataRoot of dataRoots.splice(0)) {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it("applies automated-testing migrations once and creates project-scoped testing storage", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-testing-"));
    dataRoots.push(dataRoot);
    const projects = createProjectService({ dataRoot });
    const project = projects.create("Automated tests");
    const store = projects.open(project.id);

    expect(store.database.prepare(
      "SELECT version FROM schema_migrations ORDER BY version",
    ).all()).toEqual(
      Array.from({ length: 18 }, (_, index) => ({ version: index + 1 })),
    );
    expect(store.database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND (name LIKE 'test_%')
      ORDER BY name
    `).all()).toEqual([
      { name: "test_assertion_results" },
      { name: "test_case_revisions" },
      { name: "test_case_targets" },
      { name: "test_cases" },
      { name: "test_execution_steps" },
      { name: "test_execution_variables" },
      { name: "test_executions" },
      { name: "test_suite_execution_items" },
      { name: "test_suite_executions" },
      { name: "test_suite_members" },
      { name: "test_suites" },
    ]);

    projects.close();
    const reopened = createProjectService({ dataRoot });
    try {
      expect(reopened.open(project.id).database.prepare(
        "SELECT count(*) AS count FROM schema_migrations WHERE version = 12",
      ).get()).toEqual({ count: 1 });
    } finally {
      reopened.close();
    }
  });

  it("enforces same-project targets and blocks deleting a referenced connection", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-testing-fk-"));
    dataRoots.push(dataRoot);
    const projects = createProjectService({ dataRoot });
    const project = projects.create("Automated tests");
    const store = projects.open(project.id);
    const connectionId = "00000000-0000-4000-8000-000000000811";
    const caseId = "00000000-0000-4000-8000-000000000812";
    const now = "2026-08-31T00:00:00.000Z";
    store.database.prepare(`
      INSERT INTO connections
        (id, project_id, name, url, transport, auth_mode, timeout_ms, created_at, updated_at)
      VALUES (?, ?, 'Testing server', 'https://example.test/mcp', 'streamable-http', 'none',
              10000, ?, ?)
    `).run(connectionId, project.id, now, now);
    store.database.prepare(`
      INSERT INTO test_cases
        (id, project_id, kind, name, description, tags_json, revision, enabled,
         definition_json, created_at, updated_at)
      VALUES (?, ?, 'tool', 'Smoke', '', '[]', 1, 1, '{}', ?, ?)
    `).run(caseId, project.id, now, now);
    store.database.prepare(`
      INSERT INTO test_case_targets (project_id, test_case_id, connection_id, tool_name)
      VALUES (?, ?, ?, 'list_stores')
    `).run(project.id, caseId, connectionId);

    expect(() => store.database.prepare("DELETE FROM connections WHERE id = ?")
      .run(connectionId)).toThrow(/foreign key/i);
    expect(() => store.database.prepare(`
      INSERT INTO test_case_targets (project_id, test_case_id, connection_id, tool_name)
      VALUES (?, ?, ?, 'bad')
    `).run(
      "00000000-0000-4000-8000-000000000899",
      caseId,
      connectionId,
    )).toThrow(/foreign key/i);
    expect(() => store.database.prepare(`
      INSERT INTO test_cases
        (id, project_id, kind, name, description, tags_json, revision, enabled,
         definition_json, created_at, updated_at)
      VALUES (?, ?, 'tool', 'Bad JSON', '', '[]', 1, 1, 'not-json', ?, ?)
    `).run(
      "00000000-0000-4000-8000-000000000813",
      project.id,
      now,
      now,
    )).toThrow();
    projects.close();
  });

  it("upgrades an existing 1-11 project through the testing migrations without rewriting history", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-testing-upgrade-"));
    const migrationsRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-testing-migrations-"));
    dataRoots.push(dataRoot, migrationsRoot);
    const sourceMigrations = new URL(resolveDefaultMigrationsUrl());
    for (const name of readdirSync(sourceMigrations).filter((entry) => /^0(0[1-9]|10|11)_/.test(entry))) {
      cpSync(new URL(name, sourceMigrations), join(migrationsRoot, name));
    }

    const legacy = createProjectService({
      dataRoot,
      migrationsUrl: new URL(`file://${migrationsRoot}/`),
    });
    const project = legacy.create("Legacy automated tests");
    expect(legacy.open(project.id).database.prepare(
      "SELECT max(version) AS version FROM schema_migrations",
    ).get()).toEqual({ version: 11 });
    legacy.close();

    const upgraded = createProjectService({ dataRoot });
    try {
      const store = upgraded.open(project.id);
      expect(store.database.prepare(
        "SELECT version FROM schema_migrations ORDER BY version",
      ).all()).toEqual(Array.from({ length: 18 }, (_, index) => ({ version: index + 1 })));
      expect(store.getProject().id).toBe(project.id);
    } finally {
      upgraded.close();
    }
  });
});
