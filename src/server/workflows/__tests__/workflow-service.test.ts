import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { createToolService } from "../../tools/tool-service.js";
import {
  InvalidWorkflowError,
  WorkflowRevisionConflictError,
  createWorkflowService,
} from "../workflow-service.js";

describe("WorkflowService", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-workflow-service-"));
    roots.push(dataRoot);
    const projects = createProjectService({ dataRoot });
    const projectId = projects.create("Scripts").id;
    const connectionId = "00000000-0000-4000-8000-000000000601";
    const connections = createConnectionService(projects, { createId: () => connectionId });
    connections.create(projectId, {
      name: "Scripts", url: "https://example.test/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 10_000,
    });
    const snapshotId = "00000000-0000-4000-8000-000000000602";
    const store = projects.open(projectId);
    store.database.prepare(`INSERT INTO tool_snapshots
      (id, project_id, connection_id, tool_name, content_hash, definition_json, created_at)
      VALUES (?, ?, ?, 'sum', ?, ?, ?)`).run(
        snapshotId, projectId, connectionId, "a".repeat(64),
        JSON.stringify({ name: "sum", inputSchema: { type: "object" } }),
        "2026-08-27T00:00:00.000Z",
      );
    store.database.prepare(`INSERT INTO tools
      (project_id, connection_id, name, current_snapshot_id, status, updated_at)
      VALUES (?, ?, 'sum', ?, 'current', ?)`).run(
        projectId, connectionId, snapshotId, "2026-08-27T00:00:00.000Z",
      );
    const tools = createToolService(projects, connections);
    let tick = 0;
    const service = createWorkflowService(projects, tools, {
      now: () => new Date(`2026-08-27T00:00:0${tick++}.000Z`),
    });
    return { projects, projectId, connectionId, service };
  }

  it("creates one disabled default and updates it with revision compare-and-swap", () => {
    const { projects, projectId, connectionId, service } = fixture();
    try {
      const first = service.get(projectId, connectionId, "sum");
      expect(first).toMatchObject({
        projectId, connectionId, toolName: "sum", revision: 1,
        before: { enabled: false, source: "" },
        after: { enabled: false, source: "" }, timeoutMs: 5_000,
      });
      expect(service.get(projectId, connectionId, "sum")).toEqual(first);
      const updated = service.update(projectId, connectionId, "sum", {
        revision: 1,
        before: { enabled: true, source: "export default async function before(ctx) {}" },
        after: { enabled: false, source: "" },
        timeoutMs: 8_000,
      });
      expect(updated).toMatchObject({ revision: 2, before: { enabled: true }, timeoutMs: 8_000 });
      expect(() => service.update(projectId, connectionId, "sum", {
        revision: 1, before: updated.before, after: updated.after, timeoutMs: 8_000,
      })).toThrow(WorkflowRevisionConflictError);
    } finally { projects.close(); }
  });

  it("rejects malformed, oversized, and foreign Tool updates without partial writes", () => {
    const { projects, projectId, connectionId, service } = fixture();
    try {
      const initial = service.get(projectId, connectionId, "sum");
      for (const input of [
        { revision: 1, before: { enabled: true, source: "" }, after: { enabled: false, source: "" }, timeoutMs: 99 },
        { revision: 1, before: { enabled: true, source: "x".repeat(2_097_153) }, after: { enabled: false, source: "" }, timeoutMs: 5_000 },
        { revision: 1, before: { enabled: true, source: "" }, after: { enabled: false, source: "" }, timeoutMs: 5_000, extra: true },
      ]) expect(() => service.update(projectId, connectionId, "sum", input)).toThrow(InvalidWorkflowError);
      expect(service.get(projectId, connectionId, "sum")).toEqual(initial);
      expect(() => service.get(projectId, connectionId, "missing")).toThrow(/Tool not found/i);
    } finally { projects.close(); }
  });
});
