import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { createConnectionService, type ConnectionService } from "../../connections/connection-service.js";
import type { McpSession } from "../../connections/connection-runtime.js";
import { createProjectService, type ProjectService } from "../../projects/project-service.js";

describe("Tool routes", () => {
  let dataRoot: string;
  let projects: ProjectService;
  let connections: ConnectionService;
  let projectId: string;
  const connectionId = "00000000-0000-4000-8000-000000000521";
  const listTools = vi.fn();
  const headers = {
    Origin: "http://127.0.0.1:5173",
    "X-DSers-Inspector-Session": "test-session",
  };

  beforeEach(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-tool-routes-"));
    projects = createProjectService({ dataRoot });
    projectId = projects.create("Catalog").id;
    listTools.mockReset().mockResolvedValue({ tools: [{
      name: "catalog/read item", description: "<script>alert(1)</script>",
      inputSchema: { type: "object" }, _meta: { retained: true },
    }] });
    const session = {
      protocolVersion: "2025-06-18", serverInfo: null, listTools,
      callTool: vi.fn(), close: vi.fn(),
    } as unknown as McpSession;
    connections = createConnectionService(projects, {
      createId: () => connectionId, sessionFactory: async () => session,
    });
    connections.create(projectId, {
      name: "Catalog", url: "http://127.0.0.1:1/mcp",
      transport: "streamable-http", authMode: "none", timeoutMs: 100,
    });
  });

  afterEach(() => {
    projects.close();
    rmSync(dataRoot, { recursive: true, force: true });
  });

  function app() {
    return createApp({
      sessionToken: "test-session", allowedOrigin: "http://127.0.0.1:5173",
      version: "0.1.0", projects, connections,
    });
  }

  it("inherits auth, requires a connected runtime, and normalizes refresh failures", async () => {
    const url = `/api/projects/${projectId}/connections/${connectionId}/tools/refresh`;
    expect((await app().request(url, { method: "POST" })).status).toBe(401);
    const disconnected = await app().request(url, { method: "POST", headers });
    expect(disconnected.status).toBe(409);
    expect(await disconnected.json()).toEqual({
      error: { code: "MCP_NOT_CONNECTED", message: "MCP connection is not active" },
    });

    await connections.connect(projectId, connectionId);
    listTools.mockRejectedValueOnce(new Error("Bearer secret remote stack"));
    const failed = await app().request(url, { method: "POST", headers });
    expect(failed.status).toBe(502);
    expect(JSON.stringify(await failed.json())).not.toContain("secret");
    expect(connections.runtime(projectId).get(connectionId)).toBeDefined();
  });

  it("refreshes, lists without network, and returns a URL-safe detail with immutable snapshots", async () => {
    await connections.connect(projectId, connectionId);
    const base = `/api/projects/${projectId}/connections/${connectionId}/tools`;
    const refreshed = await app().request(`${base}/refresh`, { method: "POST", headers });
    expect(refreshed.status).toBe(200);
    listTools.mockClear();

    const listed = await app().request(base, { headers });
    expect(listed.status).toBe(200);
    const listedBody = await listed.json() as { tools: Array<{ name: string; status: string }> };
    expect(listedBody.tools[0]).toEqual(expect.objectContaining({
      name: "catalog/read item", status: "current",
    }));
    const detail = await app().request(`${base}/${encodeURIComponent("catalog/read item")}`, { headers });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual({ detail: expect.objectContaining({
      snapshots: [expect.objectContaining({ definition: expect.objectContaining({
        description: "<script>alert(1)</script>", _meta: { retained: true },
      }) })],
    }) });
    expect(listTools).not.toHaveBeenCalled();
  });

  it("enforces project ownership and stable missing-resource errors", async () => {
    const other = projects.create("Other");
    const cross = await app().request(
      `/api/projects/${other.id}/connections/${connectionId}/tools`, { headers },
    );
    expect(cross.status).toBe(404);
    expect(await cross.json()).toEqual({
      error: { code: "CONNECTION_NOT_FOUND", message: "Connection not found" },
    });
  });

  it("returns a stable invalid-catalog error without leaking the definition", async () => {
    await connections.connect(projectId, connectionId);
    listTools.mockResolvedValueOnce({ tools: [
      { name: "duplicate", inputSchema: { type: "object" }, _meta: { secret: "first" } },
      { name: "duplicate", inputSchema: { type: "object" }, _meta: { secret: "second" } },
    ] });
    const response = await app().request(
      `/api/projects/${projectId}/connections/${connectionId}/tools/refresh`,
      { method: "POST", headers },
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { code: "MCP_TOOL_CATALOG_INVALID", message: "MCP Tool catalog is invalid" },
    });
  });
});
