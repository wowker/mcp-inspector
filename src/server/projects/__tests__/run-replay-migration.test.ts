import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../project-service.js";
import { resolveDefaultMigrationsUrl } from "../project-store.js";

describe("run replay migration", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-replay-migration-"));
    roots.push(dataRoot);
    const projects = createProjectService({ dataRoot });
    const project = projects.create("Replay migration");
    const store = projects.open(project.id);
    const now = "2026-09-01T00:00:00.000Z";
    const connectionId = "00000000-0000-4000-8000-000000000901";
    const snapshotId = "00000000-0000-4000-8000-000000000902";
    store.database.prepare(`INSERT INTO connections
      (id, project_id, name, url, transport, auth_mode, timeout_ms, created_at, updated_at)
      VALUES (?, ?, 'Replay server', 'https://example.test/mcp', 'streamable-http', 'none', 10000, ?, ?)`)
      .run(connectionId, project.id, now, now);
    store.database.prepare(`INSERT INTO tool_snapshots
      (id, project_id, connection_id, tool_name, content_hash, definition_json, created_at)
      VALUES (?, ?, ?, 'sum', ?, '{"name":"sum","inputSchema":{"type":"object"}}', ?)`)
      .run(snapshotId, project.id, connectionId, "a".repeat(64), now);
    const insertRun = (id: string, replayedFromRunId: string | null = null) => {
      store.database.prepare(`INSERT INTO runs
        (id, project_id, connection_id, tab_id, tool_name, tool_snapshot_id, idempotency_key,
         status, created_at, client_info_json, replayed_from_run_id)
        VALUES (?, ?, ?, NULL, 'sum', ?, ?, 'succeeded', ?, '{}', ?)`)
        .run(id, project.id, connectionId, snapshotId, `key-${id}`, now, replayedFromRunId);
    };
    return { projects, project, store, connectionId, insertRun };
  }

  it("adds safe defaults, indexes, and applies migration 014 once", () => {
    const { projects, store } = fixture();
    try {
      expect(store.database.prepare("SELECT version FROM schema_migrations ORDER BY version").all())
        .toEqual(Array.from({ length: 18 }, (_, index) => ({ version: index + 1 })));
      const columns = store.database.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
      expect(columns.map(({ name }) => name)).toEqual(expect.arrayContaining(["pinned", "replayed_from_run_id"]));
      const indexes = store.database.prepare("PRAGMA index_list(runs)").all() as Array<{ name: string }>;
      expect(indexes.map(({ name }) => name)).toEqual(expect.arrayContaining([
        "runs_project_pinned_created_idx",
        "runs_replayed_from_idx",
      ]));
    } finally { projects.close(); }
  });

  it("enforces same-project non-self lineage and clears lineage when a source is deleted", () => {
    const { projects, project, store, connectionId, insertRun } = fixture();
    const sourceId = "00000000-0000-4000-8000-000000000903";
    const replayId = "00000000-0000-4000-8000-000000000904";
    try {
      insertRun(sourceId);
      insertRun(replayId, sourceId);
      expect(() => store.database.prepare("UPDATE runs SET replayed_from_run_id = id WHERE id = ?")
        .run(replayId)).toThrow(/replay source/i);

      const foreignProjectId = "00000000-0000-4000-8000-000000000905";
      const foreignConnectionId = "00000000-0000-4000-8000-000000000906";
      const foreignSnapshotId = "00000000-0000-4000-8000-000000000907";
      const foreignRunId = "00000000-0000-4000-8000-000000000908";
      store.database.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, 'Foreign', ?, ?)")
        .run(foreignProjectId, "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
      store.database.prepare(`INSERT INTO connections
        (id, project_id, name, url, transport, auth_mode, timeout_ms, created_at, updated_at)
        VALUES (?, ?, 'Foreign', 'https://foreign.test/mcp', 'streamable-http', 'none', 10000, ?, ?)`)
        .run(foreignConnectionId, foreignProjectId, "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
      store.database.prepare(`INSERT INTO tool_snapshots
        (id, project_id, connection_id, tool_name, content_hash, definition_json, created_at)
        VALUES (?, ?, ?, 'sum', ?, '{}', ?)`)
        .run(foreignSnapshotId, foreignProjectId, foreignConnectionId, "b".repeat(64), "2026-09-01T00:00:00.000Z");
      store.database.prepare(`INSERT INTO runs
        (id, project_id, connection_id, tab_id, tool_name, tool_snapshot_id, idempotency_key,
         status, created_at, client_info_json)
        VALUES (?, ?, ?, NULL, 'sum', ?, 'foreign', 'succeeded', ?, '{}')`)
        .run(foreignRunId, foreignProjectId, foreignConnectionId, foreignSnapshotId, "2026-09-01T00:00:00.000Z");
      expect(() => store.database.prepare("UPDATE runs SET replayed_from_run_id = ? WHERE id = ?")
        .run(foreignRunId, replayId)).toThrow(/replay source/i);

      store.database.prepare("DELETE FROM runs WHERE id = ?").run(sourceId);
      expect(store.database.prepare("SELECT replayed_from_run_id FROM runs WHERE id = ?").get(replayId))
        .toEqual({ replayed_from_run_id: null });
      expect(store.database.prepare("SELECT project_id, connection_id FROM runs WHERE id = ?").get(replayId))
        .toEqual({ project_id: project.id, connection_id: connectionId });
    } finally { projects.close(); }
  });

  it("does not make a connection undeletable when its runs have replay lineage", () => {
    const { projects, store, connectionId, insertRun } = fixture();
    try {
      const sourceId = "00000000-0000-4000-8000-000000000909";
      const replayId = "00000000-0000-4000-8000-000000000910";
      insertRun(sourceId);
      insertRun(replayId, sourceId);
      store.database.prepare("DELETE FROM connections WHERE id = ?").run(connectionId);
      expect(store.database.prepare("SELECT count(*) AS count FROM runs WHERE id IN (?, ?)")
        .get(sourceId, replayId)).toEqual({ count: 0 });
    } finally { projects.close(); }
  });

  it("upgrades a 1-13 project without changing existing Run payloads", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-replay-upgrade-"));
    const migrationsRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-replay-old-migrations-"));
    roots.push(dataRoot, migrationsRoot);
    const sourceMigrations = new URL(resolveDefaultMigrationsUrl());
    for (const name of readdirSync(sourceMigrations).filter((entry) => /^(00[1-9]|01[0-3])_/.test(entry))) {
      cpSync(new URL(name, sourceMigrations), join(migrationsRoot, name));
    }
    const legacy = createProjectService({ dataRoot, migrationsUrl: new URL(`file://${migrationsRoot}/`) });
    const project = legacy.create("Legacy replay");
    const before = legacy.open(project.id).database.prepare("SELECT max(version) AS version FROM schema_migrations").get();
    expect(before).toEqual({ version: 13 });
    legacy.close();

    const upgraded = createProjectService({ dataRoot });
    try {
      const store = upgraded.open(project.id);
      expect(store.database.prepare("SELECT max(version) AS version FROM schema_migrations").get()).toEqual({ version: 18 });
      expect(store.database.prepare("SELECT count(*) AS count FROM runs WHERE pinned != 0 OR replayed_from_run_id IS NOT NULL").get())
        .toEqual({ count: 0 });
    } finally { upgraded.close(); }
  });
});
