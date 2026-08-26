import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../project-service.js";
import { resolveDefaultMigrationsUrl } from "../project-store.js";
import { ProjectStore } from "../project-store.js";

describe("ProjectService", () => {
  const dataRoots: string[] = [];

  afterEach(() => {
    for (const dataRoot of dataRoots.splice(0)) {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it("creates, lists, and opens a SQLite-backed project", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-projects-"));
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
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-projects-"));
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
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-projects-"));
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
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-projects-"));
    const migrationsRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-migrations-"));
    dataRoots.push(dataRoot, migrationsRoot);
    writeFileSync(
      join(migrationsRoot, "001_project.sql"),
      "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, retention_days INTEGER NOT NULL DEFAULT 30, retention_count INTEGER NOT NULL DEFAULT 10000);",
    );
    writeFileSync(
      join(migrationsRoot, "002_broken.sql"),
      "CREATE TABLE should_rollback (id TEXT); THIS IS NOT SQL;",
    );
    const projectId = "00000000-0000-4000-8000-000000000101";
    const databasePath = join(dataRoot, "projects", projectId, "project.sqlite");
    expect(() => new ProjectStore({
      databasePath,
      project: {
        id: projectId,
        name: "Broken migration project",
        createdAt: "2026-08-17T00:00:00.000Z",
        updatedAt: "2026-08-17T00:00:00.000Z",
        lastOpenedAt: null,
      },
      migrationsUrl: pathToFileURL(`${migrationsRoot}/`),
    })).toThrow();

    const database = new Database(databasePath);
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

  it("removes registry and canonical project artifacts when initialization fails", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-projects-"));
    const migrationsRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-migrations-"));
    dataRoots.push(dataRoot, migrationsRoot);
    writeFileSync(join(migrationsRoot, "001_broken.sql"), "THIS IS NOT SQL;");
    const projectId = "00000000-0000-4000-8000-000000000102";
    const service = createProjectService({
      dataRoot,
      createId: () => projectId,
      migrationsUrl: pathToFileURL(`${migrationsRoot}/`),
    });

    expect(() => service.create("Broken project")).toThrow();
    expect(service.list()).toEqual([]);
    expect(existsSync(join(dataRoot, "projects", projectId))).toBe(false);
    service.close();
  });

  it("does not claim or delete a pre-existing canonical project directory", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-projects-"));
    dataRoots.push(dataRoot);
    const projectId = "00000000-0000-4000-8000-000000000104";
    const projectDirectory = join(dataRoot, "projects", projectId);
    const marker = join(projectDirectory, "existing.txt");
    mkdirSync(projectDirectory, { recursive: true });
    writeFileSync(marker, "keep me");
    const service = createProjectService({ dataRoot, createId: () => projectId });

    expect(() => service.create("Collision")).toThrow(/storage already exists/i);
    expect(service.list()).toEqual([]);
    expect(existsSync(marker)).toBe(true);
    service.close();
  });

  it.each([
    { label: "gap", applied: [1, 3] },
    { label: "unknown", applied: [1, 99] },
    { label: "later migration with earlier pending", applied: [2, 3] },
  ])("rejects $label migration history before executing pending SQL", ({ applied }) => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-projects-"));
    const migrationsRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-migrations-"));
    dataRoots.push(dataRoot, migrationsRoot);
    for (const version of [1, 2, 3]) {
      writeFileSync(
        join(migrationsRoot, `00${version}_migration.sql`),
        `CREATE TABLE migration_${version} (id TEXT);`,
      );
    }
    const databasePath = join(dataRoot, "projects", "00000000-0000-4000-8000-000000000103", "project.sqlite");
    mkdirSync(join(dataRoot, "projects", "00000000-0000-4000-8000-000000000103"), { recursive: true });
    const database = new Database(databasePath);
    database.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    const insert = database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
    for (const version of applied) insert.run(version, "2026-08-17T00:00:00.000Z");
    database.close();

    expect(() => new ProjectStore({
      databasePath,
      project: {
        id: "00000000-0000-4000-8000-000000000103",
        name: "Invalid history",
        createdAt: "2026-08-17T00:00:00.000Z",
        updatedAt: "2026-08-17T00:00:00.000Z",
        lastOpenedAt: null,
      },
      migrationsUrl: pathToFileURL(`${migrationsRoot}/`),
    })).toThrow(/migration history is invalid/i);

    const inspection = new Database(databasePath);
    try {
      for (const version of [1, 2, 3]) {
        expect(inspection.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        ).get(`migration_${version}`)).toBeUndefined();
      }
    } finally {
      inspection.close();
    }
  });

  it("rejects a registry database path that is not canonical", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-projects-"));
    dataRoots.push(dataRoot);
    const service = createProjectService({ dataRoot });
    const created = service.create("Supplier Tools");
    const registry = new Database(join(dataRoot, "registry.sqlite"));
    registry.prepare("UPDATE project_registry SET database_path = ? WHERE id = ?").run(
      join(dataRoot, "outside.sqlite"),
      created.id,
    );
    registry.close();

    expect(() => service.open(created.id)).toThrow(/storage metadata is invalid/i);
    service.close();
  });

  it("rejects duplicate migration versions before applying them", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-projects-"));
    const migrationsRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-migrations-"));
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
    const root = mkdtempSync(join(tmpdir(), "mcp-inspector-layouts-"));
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
