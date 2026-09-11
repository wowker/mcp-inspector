import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../project-service.js";
import { ProjectStore, resolveDefaultMigrationsUrl } from "../project-store.js";

describe("Human Review migration", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
  function copyMigrations(target: string, through: number): void {
    const source = resolveDefaultMigrationsUrl();
    for (const name of readdirSync(source).filter((entry) => Number.parseInt(entry.slice(0, 3), 10) <= through)) {
      cpSync(new URL(name, source), join(target, name));
    }
  }

  it("upgrades migration 025 and creates Human Review audit tables", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "human-review-upgrade-"));
    const baseline = mkdtempSync(join(tmpdir(), "human-review-025-"));
    roots.push(dataRoot, baseline);
    copyMigrations(baseline, 25);
    const legacy = createProjectService({ dataRoot, migrationsUrl: pathToFileURL(`${baseline}/`) });
    const project = legacy.create("Human review upgrade"); legacy.close();
    const upgraded = createProjectService({ dataRoot });
    try {
      const database = upgraded.open(project.id).database;
      expect(database.prepare("SELECT max(version) AS version FROM schema_migrations").get()).toEqual({ version: 26 });
      const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
        .map(({ name }) => name);
      expect(tables).toEqual(expect.arrayContaining(["validation_reviews", "validation_review_decisions",
        "validation_review_batches", "validation_review_batch_members", "validated_asset_links"]));
    } finally { upgraded.close(); }
  });

  it("rolls migration 026 back atomically", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "human-review-rollback-"));
    const baseline = mkdtempSync(join(tmpdir(), "human-review-baseline-"));
    const failing = mkdtempSync(join(tmpdir(), "human-review-failing-"));
    roots.push(dataRoot, baseline, failing); copyMigrations(baseline, 25);
    const legacy = createProjectService({ dataRoot, migrationsUrl: pathToFileURL(`${baseline}/`) });
    const project = legacy.create("Human review rollback"); legacy.close();
    copyMigrations(failing, 25);
    writeFileSync(join(failing, "026_injected_failure.sql"), "CREATE TABLE review_partial (id TEXT); THIS IS NOT SQL;");
    const databasePath = join(dataRoot, "projects", project.id, "project.sqlite");
    expect(() => new ProjectStore({ databasePath, project, migrationsUrl: pathToFileURL(`${failing}/`) })).toThrow();
    const database = new Database(databasePath);
    try {
      expect(database.prepare("SELECT max(version) AS version FROM schema_migrations").get()).toEqual({ version: 25 });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'review_partial'").get()).toBeUndefined();
    } finally { database.close(); }
  });
});
