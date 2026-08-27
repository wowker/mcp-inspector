import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService, type ProjectService } from "../../projects/project-service.js";

describe("Tool workflow routes", () => {
  let dataRoot: string;
  let projects: ProjectService;
  let projectId: string;
  const connectionId = "00000000-0000-4000-8000-000000000611";
  const headers = { Origin: "http://127.0.0.1:5173", "X-MCP-Inspector-Session": "session" };

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-workflow-routes-"));
    projects = createProjectService({ dataRoot });
    projectId = projects.create("Scripts").id;
    const connections = createConnectionService(projects, { createId: () => connectionId });
    connections.create(projectId, {
      name: "Scripts", url: "https://example.test/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 10_000,
    });
    const store = projects.open(projectId);
    const snapshotId = "00000000-0000-4000-8000-000000000612";
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
  });

  afterEach(() => {
    projects.close();
    rmSync(dataRoot, { recursive: true, force: true });
  });

  function app() {
    return createApp({
      sessionToken: "session", allowedOrigin: "http://127.0.0.1:5173",
      version: "1", projects,
    });
  }

  it("inherits authentication and updates one project-scoped Tool workflow", async () => {
    const url = `/api/projects/${projectId}/connections/${connectionId}/tools/sum/workflow`;
    expect((await app().request(url)).status).toBe(401);
    const initial = await app().request(url, { headers });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({ workflow: expect.objectContaining({
      projectId, connectionId, toolName: "sum", revision: 1,
      before: { enabled: false, source: "" }, after: { enabled: false, source: "" },
    }) });
    const updated = await app().request(url, {
      method: "PUT", headers, body: JSON.stringify({
        revision: 1,
        before: { enabled: true, source: "export default async function before(ctx) {}" },
        after: { enabled: false, source: "" }, timeoutMs: 5_000,
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({ workflow: expect.objectContaining({ revision: 2 }) });
    const stale = await app().request(url, {
      method: "PUT", headers, body: JSON.stringify({
        revision: 1, before: { enabled: false, source: "" },
        after: { enabled: false, source: "" }, timeoutMs: 5_000,
      }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: {
      code: "WORKFLOW_REVISION_CONFLICT", message: "Tool workflow revision is stale",
    } });
  });

  it("returns stable validation and resource errors without source disclosure", async () => {
    const url = `/api/projects/${projectId}/connections/${connectionId}/tools/sum/workflow`;
    const invalid = await app().request(url, {
      method: "PUT", headers, body: JSON.stringify({ source: "secret-script" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: {
      code: "INVALID_WORKFLOW", message: "Tool workflow configuration is invalid",
    } });
    expect(JSON.stringify(await (await app().request(
      `/api/projects/${projectId}/connections/${connectionId}/tools/missing/workflow`, { headers },
    )).json())).not.toContain("secret-script");
  });

  it("validates syntax in the isolated worker without executing the default export", async () => {
    const url = `/api/projects/${projectId}/connections/${connectionId}/tools/sum/workflow/validate`;
    const valid = await app().request(url, {
      method: "POST", headers, body: JSON.stringify({
        phase: "before",
        source: "export default function before() { while (true) {} }",
        timeoutMs: 100,
      }),
    });
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ validation: { valid: true, error: null } });

    const invalid = await app().request(url, {
      method: "POST", headers, body: JSON.stringify({
        phase: "after", source: "export default function after( {", timeoutMs: 100,
      }),
    });
    expect(invalid.status).toBe(200);
    expect(await invalid.json()).toEqual({ validation: {
      valid: false,
      error: expect.objectContaining({ code: "SYNTAX_ERROR", phase: "after" }),
    } });
  });
});
