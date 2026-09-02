import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import {
  TestCaseRevisionConflictError,
  createTestCaseService,
} from "../test-case-service.js";

const projectId = "00000000-0000-4000-8000-000000000821";
const connectionA = "00000000-0000-4000-8000-000000000822";
const connectionB = "00000000-0000-4000-8000-000000000823";

describe("TestCaseService", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-test-cases-")); roots.push(dataRoot);
    let nextId = 830;
    const createId = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
    let minute = 0;
    const now = () => new Date(`2026-08-31T00:${String(minute++).padStart(2, "0")}:00.000Z`);
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Test definitions");
    const connections = createConnectionService(projects, {
      createId: (() => { const ids = [connectionA, connectionB]; return () => ids.shift()!; })(),
    });
    for (const name of ["A", "B"]) connections.create(projectId, {
      name, url: `https://${name.toLowerCase()}.example.test/mcp`, transport: "streamable-http",
      authMode: "none", timeoutMs: 10_000,
    });
    return { projects, connections, service: createTestCaseService(projects, { createId, now }) };
  }

  const toolMutation = (connectionId = connectionA, name = "List stores") => ({
    kind: "tool" as const,
    name,
    description: "Regression definition",
    tags: ["smoke"],
    isEnabled: true,
    target: { connectionId, toolName: "list_stores" },
    arguments: {},
    assertions: [],
    timeoutMs: 10_000,
  });

  it("creates immutable revision one and projects connection targets", async () => {
    const { projects, connections, service } = fixture();
    try {
      const created = service.create(projectId, toolMutation());
      expect(created).toMatchObject({ projectId, revision: 1, target: { connectionId: connectionA } });
      expect(service.get(projectId, created.id)).toEqual(created);
      const database = projects.open(projectId).database;
      expect(database.prepare("SELECT revision FROM test_case_revisions WHERE test_case_id = ?").all(created.id))
        .toEqual([{ revision: 1 }]);
      expect(database.prepare("SELECT connection_id FROM test_case_targets WHERE test_case_id = ?").all(created.id))
        .toEqual([{ connection_id: connectionA }]);
    } finally { await connections.close(); projects.close(); }
  });

  it("updates with revision CAS and replaces target projection atomically", async () => {
    const { projects, connections, service } = fixture();
    try {
      const created = service.create(projectId, toolMutation());
      const updated = service.update(projectId, created.id, {
        revision: 1,
        definition: toolMutation(connectionB, "List stores on B"),
      });
      expect(updated).toMatchObject({ revision: 2, name: "List stores on B", target: { connectionId: connectionB } });
      expect(() => service.update(projectId, created.id, {
        revision: 1,
        definition: toolMutation(connectionA, "Stale"),
      })).toThrow(TestCaseRevisionConflictError);
      expect(service.get(projectId, created.id)).toEqual(updated);
      expect(projects.open(projectId).database.prepare(
        "SELECT revision FROM test_case_revisions WHERE test_case_id = ? ORDER BY revision",
      ).all(created.id)).toEqual([{ revision: 1 }, { revision: 2 }]);
    } finally { await connections.close(); projects.close(); }
  });

  it("paginates with filter-bound cursors and scopes connection filters", async () => {
    const { projects, connections, service } = fixture();
    try {
      const firstCreated = service.create(projectId, toolMutation(connectionA, "Alpha"));
      const secondCreated = service.create(projectId, toolMutation(connectionB, "Beta"));
      const first = service.list(projectId, { limit: 1 });
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      const second = service.list(projectId, { limit: 1, cursor: first.nextCursor! });
      expect(second.items).toHaveLength(1);
      expect(new Set([...first.items, ...second.items].map(({ id }) => id))).toEqual(new Set([
        firstCreated.id, secondCreated.id,
      ]));
      expect(service.list(projectId, { connectionId: connectionA }).items)
        .toEqual([expect.objectContaining({ id: firstCreated.id, targetConnectionIds: [connectionA] })]);
      expect(service.list(projectId, { kind: "tool", tag: "SMOKE", query: "alpha" }).items)
        .toEqual([expect.objectContaining({ id: firstCreated.id })]);
      expect(() => service.list(projectId, { connectionId: connectionA, cursor: first.nextCursor! }))
        .toThrow(/cursor/i);
    } finally { await connections.close(); projects.close(); }
  });

  it("soft deletes definitions, releases Server dependencies, and preserves revisions", async () => {
    const { projects, connections, service } = fixture();
    try {
      const created = service.create(projectId, toolMutation());
      service.remove(projectId, created.id);
      expect(() => service.get(projectId, created.id)).toThrow(/not found/i);
      expect(projects.open(projectId).database.prepare(
        "SELECT count(*) AS count FROM test_case_revisions WHERE test_case_id = ?",
      ).get(created.id)).toEqual({ count: 1 });
      await expect(connections.delete(projectId, connectionA)).resolves.toBeUndefined();
    } finally { await connections.close(); projects.close(); }
  });
});
