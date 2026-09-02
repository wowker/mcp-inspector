import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../project-service.js";
import { resolveDefaultMigrationsUrl } from "../project-store.js";

describe("comparison ignore rules migration", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("applies migration 015 once with project ownership, order, and expression constraints", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-comparison-rules-"));
    roots.push(dataRoot);
    const projects = createProjectService({ dataRoot });
    const project = projects.create("Comparison rules");
    const store = projects.open(project.id);
    const insert = store.database.prepare(`
      INSERT INTO comparison_ignore_rules
        (id, project_id, expression, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
    `);
    try {
      expect(store.database.prepare("SELECT max(version) AS version FROM schema_migrations").get())
        .toEqual({ version: 18 });
      insert.run("00000000-0000-4000-8000-000000001501", project.id, '$["requestId"]', 0);
      expect(() => insert.run(
        "00000000-0000-4000-8000-000000001502", project.id, '$["requestId"]', 1,
      )).toThrow();
      expect(() => insert.run(
        "00000000-0000-4000-8000-000000001503", project.id, '$["timestamp"]', 0,
      )).toThrow();
      expect(() => insert.run(
        "00000000-0000-4000-8000-000000001504", project.id, "not-a-path", 1,
      )).toThrow();
      store.database.prepare("DELETE FROM projects WHERE id = ?").run(project.id);
      expect(store.database.prepare("SELECT count(*) AS count FROM comparison_ignore_rules").get())
        .toEqual({ count: 0 });
    } finally { projects.close(); }
  });

  it("upgrades a 1-14 project without rewriting prior migration files", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-comparison-upgrade-"));
    const migrationsRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-comparison-migrations-"));
    roots.push(dataRoot, migrationsRoot);
    const source = new URL(resolveDefaultMigrationsUrl());
    for (const name of readdirSync(source).filter((entry) => /^(00[1-9]|01[0-4])_/.test(entry))) {
      cpSync(new URL(name, source), join(migrationsRoot, name));
    }
    const legacy = createProjectService({ dataRoot, migrationsUrl: new URL(`file://${migrationsRoot}/`) });
    const project = legacy.create("Legacy comparison");
    expect(legacy.open(project.id).database.prepare("SELECT max(version) AS version FROM schema_migrations").get())
      .toEqual({ version: 14 });
    legacy.close();

    const upgraded = createProjectService({ dataRoot });
    try {
      const store = upgraded.open(project.id);
      expect(store.database.prepare("SELECT max(version) AS version FROM schema_migrations").get())
        .toEqual({ version: 18 });
      expect(store.database.prepare("SELECT count(*) AS count FROM comparison_ignore_rules").get())
        .toEqual({ count: 0 });
    } finally { upgraded.close(); }
  });
});
