import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../project-service.js";
import { ProjectStore, resolveDefaultMigrationsUrl } from "../project-store.js";

describe("Validation Session migration", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function copyMigrations(target: string, through: number): void {
    const source = resolveDefaultMigrationsUrl();
    for (const name of readdirSync(source).filter((entry) => Number.parseInt(entry.slice(0, 3), 10) <= through)) {
      cpSync(new URL(name, source), join(target, name));
    }
  }

  it("upgrades a migration-024 project and creates bounded Validation Session tables", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "validation-session-upgrade-"));
    const baseline = mkdtempSync(join(tmpdir(), "validation-session-024-"));
    roots.push(dataRoot, baseline);
    copyMigrations(baseline, 24);
    const legacy = createProjectService({ dataRoot, migrationsUrl: pathToFileURL(`${baseline}/`) });
    const project = legacy.create("Validation upgrade");
    legacy.close();

    const upgraded = createProjectService({ dataRoot });
    try {
      const database = upgraded.open(project.id).database;
      expect(database.prepare("SELECT max(version) AS version FROM schema_migrations").get()).toEqual({ version: 25 });
      const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
        .map(({ name }) => name);
      expect(tables).toEqual(expect.arrayContaining(["validation_sessions", "validation_evidence_versions",
        "validation_expectation_evidence", "validation_ai_assessments", "validation_ai_assessment_findings"]));
    } finally { upgraded.close(); }
  });

  it("rolls migration 025 back atomically when its SQL fails", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "validation-session-rollback-"));
    const baseline = mkdtempSync(join(tmpdir(), "validation-session-baseline-"));
    const failing = mkdtempSync(join(tmpdir(), "validation-session-failing-"));
    roots.push(dataRoot, baseline, failing);
    copyMigrations(baseline, 24);
    const legacy = createProjectService({ dataRoot, migrationsUrl: pathToFileURL(`${baseline}/`) });
    const project = legacy.create("Validation rollback");
    legacy.close();
    copyMigrations(failing, 24);
    writeFileSync(join(failing, "025_injected_failure.sql"),
      "CREATE TABLE validation_partial (id TEXT); THIS IS NOT SQL;");

    const databasePath = join(dataRoot, "projects", project.id, "project.sqlite");
    expect(() => new ProjectStore({ databasePath, project,
      migrationsUrl: pathToFileURL(`${failing}/`) })).toThrow();
    const database = new Database(databasePath);
    try {
      expect(database.prepare("SELECT max(version) AS version FROM schema_migrations").get()).toEqual({ version: 24 });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'validation_partial'").get()).toBeUndefined();
    } finally { database.close(); }
  });
});
