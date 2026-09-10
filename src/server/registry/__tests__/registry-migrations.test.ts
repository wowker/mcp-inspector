import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { ProjectRegistry } from "../../projects/project-registry.js";
import { InstallationSettingsRepository } from "../installation-settings-repository.js";

describe("installation registry migrations", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  test("creates numbered registry history and safe default Authoring settings", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-registry-"));
    roots.push(dataRoot);
    const repository = new InstallationSettingsRepository({ dataRoot });
    try {
      expect(repository.getAuthoring()).toEqual({
        enabled: false,
        tokenDigest: null,
        tokenHint: null,
        tokenCreatedAt: null,
        tokenRotatedAt: null,
        updatedAt: null,
      });
      expect(repository.database.prepare(
        "SELECT version FROM registry_schema_migrations ORDER BY version",
      ).all()).toEqual([{ version: 1 }, { version: 2 }]);
      expect(repository.database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_registry'",
      ).get()).toEqual({ name: "project_registry" });
      expect(repository.database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'authoring_settings'",
      ).get()).toEqual({ name: "authoring_settings" });
    } finally {
      repository.close();
    }
  });

  test("adopts a legacy project registry without losing project rows", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-registry-legacy-"));
    roots.push(dataRoot);
    mkdirSync(dataRoot, { recursive: true });
    const database = new Database(join(dataRoot, "registry.sqlite"));
    database.exec(`
      CREATE TABLE project_registry (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        database_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT
      );
      INSERT INTO project_registry VALUES (
        '00000000-0000-4000-8000-000000000101',
        'Legacy project',
        '/safe/projects/00000000-0000-4000-8000-000000000101/project.sqlite',
        '2026-09-01T00:00:00.000Z',
        '2026-09-01T00:00:00.000Z',
        NULL
      );
    `);
    database.close();

    const repository = new InstallationSettingsRepository({ dataRoot });
    repository.close();
    const registry = new ProjectRegistry(dataRoot);
    try {
      expect(registry.list()).toEqual([expect.objectContaining({
        id: "00000000-0000-4000-8000-000000000101",
        name: "Legacy project",
      })]);
      expect(registry.database.prepare(
        "SELECT version FROM registry_schema_migrations ORDER BY version",
      ).all()).toEqual([{ version: 1 }, { version: 2 }]);
    } finally {
      registry.close();
    }
  });

  test("persists only Authoring digest metadata and rejects tampered migration history", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-registry-tamper-"));
    roots.push(dataRoot);
    const repository = new InstallationSettingsRepository({ dataRoot });
    repository.replaceAuthoring({
      enabled: true,
      tokenDigest: "scrypt:v1:stored-digest",
      tokenHint: "abcd…wxyz",
      tokenCreatedAt: "2026-09-10T00:00:00.000Z",
      tokenRotatedAt: null,
      updatedAt: "2026-09-10T00:00:00.000Z",
    });
    expect(repository.getAuthoring()).toEqual(expect.objectContaining({
      enabled: true,
      tokenDigest: "scrypt:v1:stored-digest",
      tokenHint: "abcd…wxyz",
    }));
    expect(repository.database.prepare("PRAGMA table_info(authoring_settings)").all())
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "token" })]));
    repository.database.prepare(
      "UPDATE registry_schema_migrations SET checksum = 'tampered' WHERE version = 2",
    ).run();
    repository.close();

    expect(() => new ProjectRegistry(dataRoot)).toThrow(/registry migration history is invalid/i);
  });
});
