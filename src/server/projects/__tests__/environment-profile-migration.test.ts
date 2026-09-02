import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../project-service.js";

describe("environment profile migrations", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("upgrades an existing 001-015 project without changing existing variables", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-profile-data-"));
    const migrationsRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-profile-migrations-"));
    roots.push(dataRoot, migrationsRoot);
    const source = new URL("../migrations/", import.meta.url);
    const sourceNames = readdirSync(source);
    for (let version = 1; version <= 15; version += 1) {
      const prefix = String(version).padStart(3, "0");
      const name = sourceNames.find((candidate) => candidate.startsWith(`${prefix}_`));
      if (name === undefined) throw new Error(`Missing migration ${prefix}`);
      cpSync(new URL(name, source), join(migrationsRoot, name));
    }

    const legacy = createProjectService({
      dataRoot, migrationsUrl: new URL(`file://${migrationsRoot}/`),
    });
    const project = legacy.create("Legacy profile");
    const store = legacy.open(project.id);
    store.database.prepare(`
      INSERT INTO environment_variables
        (id, project_id, connection_id, name, value_json, secret, created_at, updated_at)
      VALUES (?, ?, NULL, 'REGION', '"legacy"', 0, ?, ?)
    `).run("00000000-0000-4000-8000-000000000201", project.id,
      "2026-09-02T00:00:00.000Z", "2026-09-02T00:00:00.000Z");
    legacy.close();

    for (const name of ["016_environment_profiles.sql", "017_connection_environment_profiles.sql"]) {
      cpSync(new URL(name, source), join(migrationsRoot, name));
    }
    const upgraded = createProjectService({
      dataRoot, migrationsUrl: new URL(`file://${migrationsRoot}/`),
    });
    try {
      const upgradedStore = upgraded.open(project.id);
      expect(upgradedStore.database.prepare(
        "SELECT max(version) AS version FROM schema_migrations",
      ).get()).toEqual({ version: 17 });
      expect(upgradedStore.database.prepare(
        "SELECT name, value_json FROM environment_variables",
      ).all()).toEqual([{ name: "REGION", value_json: '"legacy"' }]);
      expect(upgradedStore.database.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'connection_environment_profiles'
      `).get()).toEqual({ name: "connection_environment_profiles" });
    } finally { upgraded.close(); }
  });
});
