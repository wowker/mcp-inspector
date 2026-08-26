import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { createProjectService, type ProjectService } from "../../projects/project-service.js";
import { createConnectionService } from "../connection-service.js";
import { FakeMcpSession } from "../../../../test-support/fake-mcp-session.js";

describe("connection routes", () => {
  let dataRoot: string;
  let projects: ProjectService;

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connection-routes-"));
    projects = createProjectService({ dataRoot });
  });

  afterEach(() => {
    projects.close();
    rmSync(dataRoot, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  const headers = {
    Origin: "http://127.0.0.1:5173",
    "X-MCP-Inspector-Session": "test-session",
    "Content-Type": "application/json",
  };

  function app() {
    return createApp({
      sessionToken: "test-session",
      allowedOrigin: "http://127.0.0.1:5173",
      version: "0.1.0",
      projects,
      connections: createConnectionService(projects, {
        createId: () => "00000000-0000-4000-8000-000000000301",
      }),
    });
  }

  it("creates and lists a disconnected configuration without network access", async () => {
    const project = projects.create("Supplier Tools");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const createdResponse = await app().request(`/api/projects/${project.id}/connections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: " Catalog MCP ",
        url: "https://mcp.example.test/mcp?region=eu",
        transport: "streamable-http",
        authMode: "none",
        timeoutMs: 10_000,
        headers: { "X-API-Key": "local-secret" },
      }),
    });

    expect(createdResponse.status).toBe(201);
    expect(await createdResponse.json()).toEqual({
      connection: expect.objectContaining({
        name: "Catalog MCP",
        status: "disconnected",
        url: "https://mcp.example.test/mcp?region=eu",
        headers: { "X-API-Key": "local-secret" },
      }),
    });
    const listResponse = await app().request(`/api/projects/${project.id}/connections`, { headers });
    expect(await listResponse.json()).toEqual({
      connections: [expect.objectContaining({ status: "disconnected", headers: { "X-API-Key": "local-secret" } })],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exports one Server with all connection-scoped datasets and redacts credentials", async () => {
    const project = projects.create("Supplier Tools");
    const inspector = app();
    const connectionId = "00000000-0000-4000-8000-000000000301";
    await inspector.request(`/api/projects/${project.id}/connections`, {
      method: "POST", headers,
      body: JSON.stringify({ name: "Catalog MCP", url: "https://mcp.example.test/mcp",
        transport: "streamable-http", authMode: "none", timeoutMs: 10_000,
        headers: { "X-API-Key": "local-secret" } }),
    });
    const store = projects.open(project.id);
    const snapshotId = "00000000-0000-4000-8000-000000000302";
    const tabId = "00000000-0000-4000-8000-000000000303";
    const runId = "00000000-0000-4000-8000-000000000304";
    const savedId = "00000000-0000-4000-8000-000000000305";
    const folderId = "00000000-0000-4000-8000-000000000306";
    const timestamp = "2026-08-26T10:00:00.000Z";
    store.database.prepare(`INSERT INTO tool_snapshots
      (id, project_id, connection_id, tool_name, content_hash, definition_json, created_at)
      VALUES (?, ?, ?, 'sum', ?, ?, ?)`).run(snapshotId, project.id, connectionId, "a".repeat(64),
        JSON.stringify({ name: "sum", inputSchema: { type: "object" } }), timestamp);
    store.database.prepare(`INSERT INTO tools
      (project_id, connection_id, name, current_snapshot_id, status, updated_at)
      VALUES (?, ?, 'sum', ?, 'current', ?)`).run(project.id, connectionId, snapshotId, timestamp);
    store.database.prepare(`INSERT INTO tool_folders
      (id, project_id, connection_id, name, created_at, updated_at)
      VALUES (?, ?, ?, 'Smoke tests', ?, ?)`).run(folderId, project.id, connectionId, timestamp, timestamp);
    store.database.prepare(`INSERT INTO tool_folder_assignments
      (project_id, connection_id, tool_name, folder_id)
      VALUES (?, ?, 'sum', ?)`).run(project.id, connectionId, folderId);
    store.database.prepare(`INSERT INTO debug_tabs
      (id, project_id, connection_id, tool_name, title, position, input_mode, arguments_json, raw_text,
       view_state_json, created_at, updated_at)
      VALUES (?, ?, ?, 'sum', 'sum', 0, 'form', '{}', '{}', '{}', ?, ?)`)
      .run(tabId, project.id, connectionId, timestamp, timestamp);
    store.database.prepare(`INSERT INTO runs
      (id, project_id, connection_id, tab_id, tool_name, tool_snapshot_id, idempotency_key, status,
       created_at, completed_at, duration_ms, client_info_json)
      VALUES (?, ?, ?, ?, 'sum', ?, 'export-run', 'succeeded', ?, ?, 12, '{}')`)
      .run(runId, project.id, connectionId, tabId, snapshotId, timestamp, timestamp);
    store.database.prepare(`INSERT INTO run_requests (run_id, arguments_json, jsonrpc_json)
      VALUES (?, '{"a":1}', '{"jsonrpc":"2.0"}')`).run(runId);
    store.database.prepare(`INSERT INTO run_responses (run_id, result_json)
      VALUES (?, '{"content":[{"type":"text","text":"3"}]}')`).run(runId);
    store.database.prepare(`INSERT INTO run_events (run_id, sequence, kind, occurred_at, payload_json)
      VALUES (?, 1, 'run-status', ?, '{"status":"succeeded"}')`).run(runId, timestamp);
    store.database.prepare(`INSERT INTO saved_tool_items
      (id, project_id, connection_id, tool_name, kind, name, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, 'sum', 'request', 'Smoke request', '{"a":1}', ?, ?)`)
      .run(savedId, project.id, connectionId, timestamp, timestamp);

    const response = await inspector.request(
      `/api/projects/${project.id}/connections/${connectionId}/export`, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    const bundle: unknown = await response.json();
    expect(bundle).toMatchObject({
      format: "mcp-inspector-server-export", version: 1,
      project: { id: project.id, name: "Supplier Tools" },
      server: { id: connectionId, name: "Catalog MCP",
        headers: [{ name: "X-API-Key", value: null, redacted: true }] },
      data: {
        toolSnapshots: [{ id: snapshotId, toolName: "sum" }], tools: [{ name: "sum" }],
        folders: [{ id: folderId, name: "Smoke tests" }],
        folderAssignments: [{ folderId, toolName: "sum" }],
        tabs: [{ id: tabId }], runs: [{ id: runId }],
        runRequests: [{ runId, arguments: { a: 1 } }],
        runResponses: [{ runId, result: { content: [{ type: "text", text: "3" }] } }],
        runEvents: [{ runId, sequence: 1 }],
        savedItems: [{ id: savedId, name: "Smoke request", payload: { a: 1 } }],
      },
    });
    expect(JSON.stringify(bundle)).not.toContain("local-secret");
  });

  it("inherits API authentication and returns stable validation errors", async () => {
    const project = projects.create("Supplier Tools");
    expect((await app().request(`/api/projects/${project.id}/connections`)).status).toBe(401);

    const invalid = await app().request(`/api/projects/${project.id}/connections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Catalog MCP",
        url: "file:///tmp/server",
        transport: "streamable-http",
        authMode: "none",
        timeoutMs: 10_000,
      }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: { code: "INVALID_CONNECTION", message: "Connection configuration is invalid" },
    });

    const withSecret = await app().request(`/api/projects/${project.id}/connections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Catalog MCP",
        url: "https://mcp.example.test/mcp",
        transport: "streamable-http",
        authMode: "none",
        timeoutMs: 10_000,
        authorization: "Bearer secret",
      }),
    });
    expect(withSecret.status).toBe(400);
  });

  it("returns not found for unknown projects and project-scoped connection IDs", async () => {
    const firstProject = projects.create("First");
    const secondProject = projects.create("Second");
    const connectionId = "00000000-0000-4000-8000-000000000301";
    await app().request(`/api/projects/${firstProject.id}/connections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Catalog MCP",
        url: "https://mcp.example.test/mcp",
        transport: "streamable-http",
        authMode: "none",
        timeoutMs: 10_000,
      }),
    });

    const crossProject = await app().request(
      `/api/projects/${secondProject.id}/connections/${connectionId}`,
      { method: "DELETE", headers },
    );
    expect(crossProject.status).toBe(404);
    expect(await crossProject.json()).toEqual({
      error: { code: "CONNECTION_NOT_FOUND", message: "Connection not found" },
    });

    const missingProject = await app().request(
      "/api/projects/00000000-0000-4000-8000-000000000099/connections",
      { headers },
    );
    expect(missingProject.status).toBe(404);
    expect(await missingProject.json()).toEqual({
      error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
    });
  });

  it("deletes a connection only after an explicit DELETE request", async () => {
    const project = projects.create("Supplier Tools");
    await app().request(`/api/projects/${project.id}/connections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Catalog MCP",
        url: "https://mcp.example.test/mcp",
        transport: "streamable-http",
        authMode: "none",
        timeoutMs: 10_000,
      }),
    });
    const deleted = await app().request(
      `/api/projects/${project.id}/connections/00000000-0000-4000-8000-000000000301`,
      { method: "DELETE", headers },
    );
    expect(deleted.status).toBe(204);
    await expect((await app().request(`/api/projects/${project.id}/connections`, { headers })).json())
      .resolves.toEqual({ connections: [] });
  });

  it("updates only editable fields through an authenticated project-scoped PATCH", async () => {
    const project = projects.create("Supplier Tools");
    const runtimeApp = app();
    await runtimeApp.request(`/api/projects/${project.id}/connections`, {
      method: "POST", headers, body: JSON.stringify({
        name: "Broken MCP", url: "http://127.0.0.1:1/mcp",
        transport: "streamable-http", authMode: "none", timeoutMs: 100,
      }),
    });

    const updated = await runtimeApp.request(
      `/api/projects/${project.id}/connections/00000000-0000-4000-8000-000000000301`,
      { method: "PATCH", headers, body: JSON.stringify({
        name: " Fixed MCP ", url: "https://mcp.example.test/mcp", authMode: "oauth", timeoutMs: 20_000,
      }) },
    );

    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({ connection: expect.objectContaining({
      name: "Fixed MCP", url: "https://mcp.example.test/mcp", timeoutMs: 20_000,
      transport: "streamable-http", authMode: "oauth", status: "disconnected",
    }) });
    const invalid = await runtimeApp.request(
      `/api/projects/${project.id}/connections/00000000-0000-4000-8000-000000000301`,
      { method: "PATCH", headers, body: JSON.stringify({ transport: "sse" }) },
    );
    expect(invalid.status).toBe(400);
    expect((await runtimeApp.request(
      `/api/projects/00000000-0000-4000-8000-000000000099/connections/00000000-0000-4000-8000-000000000301`,
      { method: "PATCH", headers, body: JSON.stringify({ name: "Foreign" }) },
    )).status).toBe(404);
  });

  it("keeps an active connection configuration when delete cannot close its session", async () => {
    const project = projects.create("Supplier Tools");
    const connectionId = "00000000-0000-4000-8000-000000000301";
    const session = new FakeMcpSession();
    session.close = async () => { throw new Error("remote close detail"); };
    const connections = createConnectionService(projects, {
      createId: () => connectionId,
      sessionFactory: async () => session,
    });
    connections.create(project.id, {
      name: "MCP", url: "http://127.0.0.1:1/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 100,
    });
    await connections.connect(project.id, connectionId);
    const runtimeApp = createApp({
      sessionToken: "test-session", allowedOrigin: "http://127.0.0.1:5173",
      version: "0.1.0", projects, connections,
    });

    const response = await runtimeApp.request(
      `/api/projects/${project.id}/connections/${connectionId}`,
      { method: "DELETE", headers },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { code: "MCP_DISCONNECT_FAILED", message: "Unable to disconnect MCP server" },
    });
    expect(connections.list(project.id)).toHaveLength(1);
  });

  it("preserves the stable project-storage error when database ownership is corrupted", async () => {
    const project = projects.create("Supplier Tools");
    projects.open(project.id).database
      .prepare("UPDATE projects SET id = ? WHERE id = ?")
      .run("00000000-0000-4000-8000-000000000399", project.id);

    const response = await app().request(`/api/projects/${project.id}/connections`, { headers });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_PROJECT_STORAGE",
        message: "Project storage metadata is invalid",
      },
    });
  });

  it("connects and disconnects only through authenticated project-scoped actions", async () => {
    const project = projects.create("Supplier Tools");
    const other = projects.create("Other");
    const connectionId = "00000000-0000-4000-8000-000000000301";
    const session = new FakeMcpSession();
    const connections = createConnectionService(projects, {
      createId: () => connectionId,
      sessionFactory: async () => session,
    });
    connections.create(project.id, {
      name: "Catalog MCP",
      url: "http://127.0.0.1:1/mcp",
      transport: "streamable-http",
      authMode: "none",
      timeoutMs: 100,
    });
    const runtimeApp = createApp({
      sessionToken: "test-session",
      allowedOrigin: "http://127.0.0.1:5173",
      version: "0.1.0",
      projects,
      connections,
    });

    expect((await runtimeApp.request(
      `/api/projects/${project.id}/connections/${connectionId}/connect`,
      { method: "POST" },
    )).status).toBe(401);
    expect((await runtimeApp.request(
      `/api/projects/${other.id}/connections/${connectionId}/connect`,
      { method: "POST", headers },
    )).status).toBe(404);
    const connected = await runtimeApp.request(
      `/api/projects/${project.id}/connections/${connectionId}/connect`,
      { method: "POST", headers },
    );
    expect(connected.status).toBe(200);
    expect(await connected.json()).toEqual({ connection: expect.objectContaining({ status: "connected" }) });
    const disconnected = await runtimeApp.request(
      `/api/projects/${project.id}/connections/${connectionId}/disconnect`,
      { method: "POST", headers },
    );
    expect(disconnected.status).toBe(200);
    expect(session.closeCount).toBe(1);
  });

  it("normalizes connection failures without returning remote details", async () => {
    const project = projects.create("Supplier Tools");
    const connectionId = "00000000-0000-4000-8000-000000000301";
    const connections = createConnectionService(projects, {
      createId: () => connectionId,
      sessionFactory: async () => { throw new Error("Bearer remote-secret stack"); },
    });
    connections.create(project.id, {
      name: "Catalog MCP",
      url: "http://127.0.0.1:1/mcp",
      transport: "streamable-http",
      authMode: "none",
      timeoutMs: 100,
    });
    const runtimeApp = createApp({
      sessionToken: "test-session",
      allowedOrigin: "http://127.0.0.1:5173",
      version: "0.1.0",
      projects,
      connections,
    });

    const response = await runtimeApp.request(
      `/api/projects/${project.id}/connections/${connectionId}/connect`,
      { method: "POST", headers },
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { code: "MCP_CONNECT_FAILED", message: "Unable to connect to MCP server" },
    });
    expect(connections.list(project.id)[0]).toEqual(expect.objectContaining({
      status: "failed",
      lastError: { code: "MCP_CONNECT_FAILED", message: "Unable to connect to MCP server" },
    }));
  });
});
