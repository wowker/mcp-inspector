import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../project-service.js";
import { ProjectStore, resolveDefaultMigrationsUrl } from "../project-store.js";

const releasedHashes = [
  "b55fe8031b72e7013ee1de6d50edc38cdf956f187ab184c8b5233fca7dead976",
  "d31e07525d91f2b0da022a159adadb7e928385543c604ee39eeaf18bd3842244",
  "74203029af7e66cec2e70c22a2e39902375b959e0ba7485198da11e84b4b189f",
  "e121756fe99c63f1fd1a2fc0302ed57b67a7dd8cabe1654bc0d56ac45303958c",
  "80f73019775639b525b5028ff2727232e35ed94929d5efe989b3efd38f51afab",
  "fce0c65719cae8c8ec5100c92e49ae476881f53743468b0e8e4fbc21dcf25aa5",
  "6dbb05f1ba69866e4b32f856a2772e8bb3e2312a8a599e195d505336cd4b5aa0",
  "89c15932b2ffaf21cd71636ea520f005988f95fc97efb05f4159725f333ba966",
  "78952d20183454043b6f7e09456fcbc08ee95f533d9fc9ecb5d7922ef9d2a259",
  "46df4b121102387de628d65613aa3c6f1db8641d11c6b39ce60de0d68105fb73",
  "1963a0b9ce0490a34131aa1970ad623bd8ede9bcda9b86d141a93e00e94fc204",
  "95dce04477b75b7b09903e23fbb63601d71d9dc004181f8b851e0d198a117d77",
  "e041edbde3c426401c6d489dfc92de4b14c227a0594c25ec8fa5a9bbd958ac6b",
  "52c356434439aebe4e0a7c85b3ed1469aad03a5780490bf511199212064978b3",
  "208ca809f7b754a6b96ef656f28a541df2dde897ab97dbed0f219db3e5667581",
  "dfb4eb3e2f27045bae61235ff494637205213f9df159428e0c82759b67213504",
  "22218ca404cce8ec0f059bed7f1dca3d2377f0057b69afdcf0f4220031db688b",
  "f717beca49045e1f6b77670b52e2b89a6eb85cf29d29dfa23d1a31dbc8ef0633",
  "95040d192ece7f51853808274f82ffa601880a70abde1ee57d0e73046f76d7b2",
  "48ac9225abce1fc04073daa602b8e57e5625a6ae7bf30f9fbc98a0eb8d174958",
  "005e513d916d5d022d191a881fe1812519130495b0b0d9f9b35fe1af39c757b0",
  "a22babb072dc68361568158495deae419b9cbf20f3bb2511c8ee4d4f9ac6e4de",
  "dd9f831d11303e96b646f01282af7f6054f7635104e90c1e5a9336fc6cdafce9",
  "73c356dfda6c7ea89cd53c62c294dea422e7a194b0942075450ac60bd1777308",
] as const;

describe("Authoring project migrations", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function copyMigrations(target: string, through: number): void {
    const source = resolveDefaultMigrationsUrl();
    for (const name of readdirSync(source).filter((entry) => Number.parseInt(entry.slice(0, 3), 10) <= through)) {
      cpSync(new URL(name, source), join(target, name));
    }
  }

  it("upgrades a migration-020 project through Draft and Tool-call storage without changing released bytes", () => {
    const source = resolveDefaultMigrationsUrl();
    const currentHashes = readdirSync(source).filter((name) => Number.parseInt(name.slice(0, 3), 10) <= 24)
      .sort().map((name) => createHash("sha256").update(readFileSync(new URL(name, source))).digest("hex"));
    expect(currentHashes).toEqual(releasedHashes);

    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-authoring-migrations-"));
    const oldMigrations = mkdtempSync(join(tmpdir(), "mcp-inspector-migrations-020-"));
    roots.push(dataRoot, oldMigrations);
    copyMigrations(oldMigrations, 20);
    const legacy = createProjectService({ dataRoot, migrationsUrl: pathToFileURL(`${oldMigrations}/`) });
    const project = legacy.create("Authoring migration fixture");
    const createdAt = "2026-09-10T00:00:00.000Z";
    legacy.open(project.id).database.prepare(`INSERT INTO connections
      (id, project_id, name, url, transport, auth_mode, timeout_ms, created_at, updated_at)
      VALUES ('00000000-0000-4000-8000-000000003001', ?, 'Preserved', 'https://example.test/mcp',
        'streamable-http', 'none', 10000, ?, ?)`)
      .run(project.id, createdAt, createdAt);
    legacy.close();

    const upgraded = createProjectService({ dataRoot });
    try {
      const database = upgraded.open(project.id).database;
      expect(database.prepare("SELECT max(version) AS version FROM schema_migrations").get()).toEqual({ version: 25 });
      expect(database.prepare("SELECT name FROM connections WHERE project_id = ?").get(project.id)).toEqual({ name: "Preserved" });
      const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
        .map(({ name }) => name);
      expect(tables).toEqual(expect.arrayContaining([
        "authoring_drafts", "authoring_draft_revisions", "authoring_draft_validations",
        "authoring_draft_executions", "authoring_draft_apply_results", "authoring_draft_asset_mappings",
        "authoring_idempotency_records", "authoring_tool_calls",
      ]));

      const draftId = "00000000-0000-4000-8000-000000003010";
      const snapshotId = "00000000-0000-4000-8000-000000003011";
      const connectionId = "00000000-0000-4000-8000-000000003001";
      const digest = "a".repeat(64);
      database.prepare(`INSERT INTO tool_snapshots
        (id, project_id, connection_id, tool_name, content_hash, definition_json, created_at)
        VALUES (?, ?, ?, 'catalog/read', ?, '{"name":"catalog/read","inputSchema":{"type":"object"}}', ?)`)
        .run(snapshotId, project.id, connectionId, digest, createdAt);
      database.prepare(`INSERT INTO authoring_drafts
        (id, project_id, revision, state, goal, definition_json, definition_digest, created_at, updated_at)
        VALUES (?, ?, 1, 'ACTIVE', 'Diagnose catalog', '{}', ?, ?, ?)`)
        .run(draftId, project.id, digest, createdAt, createdAt);
      database.prepare(`INSERT INTO authoring_draft_revisions
        (id, project_id, draft_id, revision, definition_json, definition_digest, created_at)
        VALUES ('00000000-0000-4000-8000-000000003012', ?, ?, 1, '{}', ?, ?)`)
        .run(project.id, draftId, digest, createdAt);
      database.prepare(`INSERT INTO authoring_idempotency_records
        (project_id, idempotency_key, operation, request_hash, created_at)
        VALUES (?, 'create-draft', 'CREATE_DRAFT', ?, ?)`)
        .run(project.id, digest, createdAt);
      expect(() => database.prepare(`INSERT INTO authoring_idempotency_records
        (project_id, idempotency_key, operation, request_hash, created_at)
        VALUES (?, 'create-draft', 'REPLACE_DRAFT', ?, ?)`)
        .run(project.id, "b".repeat(64), createdAt)).toThrow();
      expect(() => database.prepare(`INSERT INTO authoring_drafts
        (id, project_id, revision, state, goal, definition_json, definition_digest, created_at, updated_at)
        VALUES ('00000000-0000-4000-8000-000000003013', ?, 1, 'ACTIVE', '', ?, ?, ?, ?)`)
        .run(project.id, JSON.stringify({ value: "x".repeat(2_097_152) }), digest, createdAt, createdAt)).toThrow();

      const insertExecution = database.prepare(`INSERT INTO authoring_draft_executions
        (id, project_id, draft_id, draft_revision, definition_digest, idempotency_key, request_hash,
         status, inputs_json, created_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, 'QUEUED', '{}', ?)`);
      insertExecution.run("00000000-0000-4000-8000-000000003014", project.id, draftId, digest,
        "execute-1", digest, createdAt);
      expect(() => insertExecution.run("00000000-0000-4000-8000-000000003015", project.id, draftId,
        digest, "execute-2", "b".repeat(64), createdAt)).toThrow();

      database.prepare(`INSERT INTO authoring_tool_calls
        (id, project_id, context_kind, draft_id, draft_revision, connection_id, tool_name,
         tool_snapshot_id, tool_schema_hash, purpose, idempotency_key, request_hash,
         arguments_json, status, created_at)
        VALUES ('00000000-0000-4000-8000-000000003016', ?, 'STANDALONE', NULL, NULL, ?,
          'catalog/read', ?, ?, 'DIAGNOSTIC', 'call-1', ?, '{}', 'PENDING', ?)`)
        .run(project.id, connectionId, snapshotId, digest, digest, createdAt);
      expect(() => database.prepare(`INSERT INTO authoring_tool_calls
        (id, project_id, context_kind, draft_id, draft_revision, connection_id, tool_name,
         tool_snapshot_id, tool_schema_hash, purpose, idempotency_key, request_hash,
         arguments_json, status, created_at)
        VALUES ('00000000-0000-4000-8000-000000003017', ?, 'STANDALONE', ?, 1, ?,
          'catalog/read', ?, ?, 'ACTION', 'call-2', ?, '{}', 'PENDING', ?)`)
        .run(project.id, draftId, connectionId, snapshotId, digest, digest, createdAt)).toThrow();

      database.prepare("DELETE FROM connections WHERE project_id = ? AND id = ?").run(project.id, connectionId);
      expect(database.prepare(`SELECT connection_id, tool_name, tool_snapshot_id
        FROM authoring_tool_calls WHERE id = '00000000-0000-4000-8000-000000003016'`).get()).toEqual({
        connection_id: connectionId, tool_name: "catalog/read", tool_snapshot_id: null,
      });
    } finally { upgraded.close(); }
  });

  it.each([22, 23])("rolls back migration %s completely when its SQL fails", (failingVersion) => {
    const dataRoot = mkdtempSync(join(tmpdir(), `mcp-inspector-authoring-rollback-${failingVersion}-`));
    const baselineMigrations = mkdtempSync(join(tmpdir(), `mcp-inspector-authoring-baseline-${failingVersion}-`));
    const failingMigrations = mkdtempSync(join(tmpdir(), `mcp-inspector-authoring-failing-${failingVersion}-`));
    roots.push(dataRoot, baselineMigrations, failingMigrations);
    copyMigrations(baselineMigrations, failingVersion - 1);
    const legacy = createProjectService({ dataRoot, migrationsUrl: pathToFileURL(`${baselineMigrations}/`) });
    const project = legacy.create("Rollback fixture");
    const databasePath = join(dataRoot, "projects", project.id, "project.sqlite");
    legacy.close();

    copyMigrations(failingMigrations, failingVersion - 1);
    writeFileSync(join(failingMigrations, `${String(failingVersion).padStart(3, "0")}_injected_failure.sql`),
      `CREATE TABLE authoring_injected_failure_${failingVersion} (id TEXT);\nTHIS IS NOT SQL;\n`);
    expect(() => new ProjectStore({
      databasePath, project, migrationsUrl: pathToFileURL(`${failingMigrations}/`),
    })).toThrow();

    const database = new Database(databasePath);
    try {
      expect(database.prepare("SELECT max(version) AS version FROM schema_migrations").get())
        .toEqual({ version: failingVersion - 1 });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name = ?")
        .get(`authoring_injected_failure_${failingVersion}`)).toBeUndefined();
    } finally { database.close(); }
  });

  it("rejects a migration set with a missing release-order version", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-authoring-gap-data-"));
    const migrationsRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-authoring-gap-migrations-"));
    roots.push(dataRoot, migrationsRoot);
    copyMigrations(migrationsRoot, 23);
    unlinkSync(join(migrationsRoot, "022_authoring_drafts.sql"));
    const project = {
      id: "00000000-0000-4000-8000-000000003099", name: "Gap fixture",
      databasePath: join(dataRoot, "gap.sqlite"),
      createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z", lastOpenedAt: null,
    };

    expect(() => new ProjectStore({
      databasePath: project.databasePath, project, migrationsUrl: pathToFileURL(`${migrationsRoot}/`),
    })).toThrow(/contiguous/i);
  });
});
