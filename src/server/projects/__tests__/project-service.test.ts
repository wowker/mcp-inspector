import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../project-service.js";
import { resolveDefaultMigrationsUrl } from "../project-store.js";

describe("ProjectService", () => {
  const dataRoots: string[] = [];

  afterEach(() => {
    for (const dataRoot of dataRoots.splice(0)) {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it("creates, lists, and opens a SQLite-backed project", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-projects-"));
    dataRoots.push(dataRoot);
    const service = createProjectService({ dataRoot });

    try {
      const created = service.create("Supplier Tools");

      expect(service.list()).toEqual([
        expect.objectContaining({ id: created.id, name: "Supplier Tools" }),
      ]);

      const store = service.open(created.id);
      expect(store.database.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(store.getProject().id).toBe(created.id);
    } finally {
      service.close();
    }
  });

  it("normalizes names, caches one handle, and closes it deterministically", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-projects-"));
    dataRoots.push(dataRoot);
    const service = createProjectService({ dataRoot });
    const created = service.create("  Supplier Tools  ");

    const first = service.open(created.id);
    const second = service.open(created.id);

    expect(created.name).toBe("Supplier Tools");
    expect(second).toBe(first);
    service.close();
    expect(() => first.database.pragma("journal_mode", { simple: true })).toThrow();
    expect(() => service.list()).toThrow(/closed/i);
  });

  it("rejects invalid names and unknown or malformed project IDs", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-projects-"));
    dataRoots.push(dataRoot);
    const service = createProjectService({ dataRoot });

    try {
      expect(() => service.create("   ")).toThrow();
      expect(() => service.create("x".repeat(121))).toThrow();
      expect(() => service.open("../project.sqlite")).toThrow(/not found/i);
      expect(() => service.open("00000000-0000-4000-8000-000000000000")).toThrow(
        /not found/i,
      );
    } finally {
      service.close();
    }
  });

  it("applies each migration and its version row atomically", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-projects-"));
    const migrationsRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-migrations-"));
    dataRoots.push(dataRoot, migrationsRoot);
    writeFileSync(
      join(migrationsRoot, "001_project.sql"),
      "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, retention_days INTEGER NOT NULL DEFAULT 30, retention_count INTEGER NOT NULL DEFAULT 10000);",
    );
    writeFileSync(
      join(migrationsRoot, "002_broken.sql"),
      "CREATE TABLE should_rollback (id TEXT); THIS IS NOT SQL;",
    );
    const service = createProjectService({
      dataRoot,
      migrationsUrl: pathToFileURL(`${migrationsRoot}/`),
    });

    expect(() => service.create("Broken migration project")).toThrow();
    service.close();

    const projectsRoot = join(dataRoot, "projects");
    const [projectId] = readdirSync(projectsRoot);
    const database = new Database(join(projectsRoot, projectId, "project.sqlite"));
    try {
      expect(
        database.prepare("SELECT version FROM schema_migrations ORDER BY version").all(),
      ).toEqual([{ version: 1 }]);
      expect(
        database.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'",
        ).get(),
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("rejects duplicate migration versions before applying them", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-projects-"));
    const migrationsRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-migrations-"));
    dataRoots.push(dataRoot, migrationsRoot);
    mkdirSync(join(dataRoot, "projects"), { recursive: true });
    writeFileSync(join(migrationsRoot, "001_first.sql"), "CREATE TABLE first (id TEXT);");
    writeFileSync(join(migrationsRoot, "001_second.sql"), "CREATE TABLE second (id TEXT);");
    const service = createProjectService({
      dataRoot,
      migrationsUrl: pathToFileURL(`${migrationsRoot}/`),
    });

    expect(() => service.create("Duplicate migrations")).toThrow(/duplicate/i);
    service.close();
  });

  it("resolves migrations in both source and bundled server layouts", () => {
    const root = mkdtempSync(join(tmpdir(), "dsers-inspector-layouts-"));
    dataRoots.push(root);
    const sourceModule = join(root, "src", "server", "projects", "project-store.js");
    const sourceMigrations = join(root, "src", "server", "projects", "migrations");
    mkdirSync(sourceMigrations, { recursive: true });
    expect(resolveDefaultMigrationsUrl(pathToFileURL(sourceModule))).toEqual(
      pathToFileURL(`${sourceMigrations}/`),
    );

    const bundledModule = join(root, "dist", "server", "main.js");
    const bundledMigrations = join(root, "dist", "server", "projects", "migrations");
    mkdirSync(bundledMigrations, { recursive: true });
    expect(resolveDefaultMigrationsUrl(pathToFileURL(bundledModule))).toEqual(
      pathToFileURL(`${bundledMigrations}/`),
    );
  });
});
