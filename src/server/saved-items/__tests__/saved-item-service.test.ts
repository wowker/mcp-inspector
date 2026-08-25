import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { ToolRepository } from "../../tools/tool-repository.js";
import { createSavedItemService } from "../saved-item-service.js";

const projectId = "00000000-0000-4000-8000-000000000901";
const connectionId = "00000000-0000-4000-8000-000000000902";

describe("SavedItemService", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-saved-items-")); roots.push(dataRoot);
    let next = 910;
    const ids = () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
    const projects = createProjectService({ dataRoot, createId: () => projectId }); projects.create("Saved items");
    const connections = createConnectionService(projects, { createId: () => connectionId });
    connections.create(projectId, { name: "Server", url: "https://example.test/mcp", transport: "streamable-http", authMode: "none", timeoutMs: 10_000 });
    new ToolRepository(projects.open(projectId)).replaceCatalog(projectId, connectionId, [{
      id: ids(), name: "sum", contentHash: "a".repeat(64),
      definitionJson: JSON.stringify({ name: "sum", inputSchema: { type: "object" } }),
    }], "2026-08-25T00:00:00.000Z");
    return { projects, service: createSavedItemService(projects, { createId: ids,
      now: () => new Date("2026-08-25T00:00:00.000Z") }) };
  }

  it("stores request and response payloads independently for one Tool", () => {
    const { projects, service } = fixture();
    try {
      const request = service.create({ projectId, connectionId, toolName: "sum", kind: "request",
        name: "正常求和", description: "回归用参数", payload: { a: 1, b: 2 }, sourceRunId: null });
      const response = service.create({ projectId, connectionId, toolName: "sum", kind: "response",
        name: "成功结果", description: "预期返回 3", payload: { result: { content: [{ type: "text", text: "3" }] } }, sourceRunId: null });
      expect(service.list(projectId, connectionId, "sum").items).toEqual([
        expect.objectContaining({ id: response.id, kind: "response", name: "成功结果", description: "预期返回 3" }),
        expect.objectContaining({ id: request.id, kind: "request", name: "正常求和", description: "回归用参数" }),
      ]);
      expect(service.get(projectId, response.id).payload).toEqual({ result: { content: [{ type: "text", text: "3" }] } });
      service.remove(projectId, request.id);
      expect(service.list(projectId, connectionId, "sum").items).toHaveLength(1);
    } finally { projects.close(); }
  });

  it("rejects invalid metadata, non-object requests, and foreign Tool ownership", () => {
    const { projects, service } = fixture();
    try {
      expect(() => service.create({ projectId, connectionId, toolName: "sum", kind: "request",
        name: " ", description: "", payload: {}, sourceRunId: null })).toThrow(/invalid/i);
      expect(() => service.create({ projectId, connectionId, toolName: "sum", kind: "request",
        name: "bad", description: "", payload: [], sourceRunId: null })).toThrow(/object/i);
      expect(() => service.create({ projectId, connectionId, toolName: "missing", kind: "response",
        name: "bad", description: "", payload: null, sourceRunId: null })).toThrow(/Tool not found/i);
    } finally { projects.close(); }
  });

  it("paginates summaries with an opaque Tool-scoped cursor", () => {
    const { projects, service } = fixture();
    try {
      for (let index = 0; index < 101; index += 1) service.create({ projectId, connectionId, toolName: "sum",
        kind: "request", name: `case ${index}`, description: "", payload: { index }, sourceRunId: null });
      const first = service.list(projectId, connectionId, "sum");
      expect(first.items).toHaveLength(100); expect(first.nextCursor).not.toBeNull();
      const second = service.list(projectId, connectionId, "sum", first.nextCursor!);
      expect(second.items).toHaveLength(1); expect(second.nextCursor).toBeNull();
      expect(new Set([...first.items, ...second.items].map(({ id }) => id)).size).toBe(101);
      const decoded = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString("utf8")) as Record<string, unknown>;
      decoded.toolName = "other";
      expect(() => service.list(projectId, connectionId, "sum", Buffer.from(JSON.stringify(decoded)).toString("base64url"))).toThrow(/cursor/i);
    } finally { projects.close(); }
  });
});
