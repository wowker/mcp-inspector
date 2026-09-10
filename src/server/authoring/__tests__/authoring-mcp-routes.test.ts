import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, test } from "vitest";
import { createApp } from "../../app.js";
import { startInspector } from "../../main.js";
import { InstallationSettingsRepository } from "../../registry/installation-settings-repository.js";
import { createAuthoringAuthService } from "../authoring-auth-service.js";
import type { AuthoringCatalogService } from "../authoring-catalog-service.js";
import { createAuthoringMcpServer } from "../authoring-mcp-server.js";

const endpoint = new URL("http://127.0.0.1:8500/mcp/authoring");

describe("Authoring MCP Streamable HTTP route", () => {
  const cleanups: Array<() => void | Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function fixture(options: { maxSessions?: number; catalog?: AuthoringCatalogService } = {}) {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-authoring-mcp-"));
    const repository = new InstallationSettingsRepository({ dataRoot });
    const authoringAuth = createAuthoringAuthService({ repository });
    const enabled = await authoringAuth.enable();
    if (enabled.token === null) throw new Error("Expected a newly issued Authoring Token");
    const authoringMcp = createAuthoringMcpServer({
      appVersion: "3.0.0-test",
      endpoint: endpoint.toString(),
      maxSessions: options.maxSessions,
      catalog: options.catalog,
    });
    const app = createApp({
      sessionToken: "browser-session",
      allowedOrigin: endpoint.origin,
      version: "3.0.0-test",
      authoringAuth,
      authoringMcp,
    });
    cleanups.push(async () => {
      await authoringMcp.close();
      repository.close();
      rmSync(dataRoot, { recursive: true, force: true });
    });
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return await app.fetch(request);
    };
    const client = (token = enabled.token!) => {
      const transport = new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
        fetch,
      });
      const instance = new Client({ name: "authoring-test", version: "1.0.0" });
      cleanups.push(() => instance.close().catch(() => undefined));
      return { instance, transport };
    };
    return { app, authoringAuth, authoringMcp, token: enabled.token, client };
  }

  test("initializes a bounded stateful session and exposes stable capabilities", async () => {
    const { client } = await fixture();
    const { instance, transport } = client();
    await instance.connect(transport);

    expect(transport.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await instance.listTools()).tools.map((tool) => tool.name)).toEqual([
      "inspector_get_capabilities",
    ]);
    const result = await instance.callTool({ name: "inspector_get_capabilities", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        appVersion: "3.0.0-test",
        endpoint: endpoint.toString(),
        limits: { maxSessions: 8, maxRequestBytes: 2 * 1024 * 1024 },
      },
      meta: { protocolVersion: "1", warnings: [] },
    });
  });

  test("authenticates every request and distinguishes disabled from invalid credentials", async () => {
    const { app, authoringAuth, token } = await fixture();
    const request = () => app.request("/mcp/authoring", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      }),
    });

    const missing = await request();
    expect(missing.status).toBe(401);
    expect(missing.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(missing.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await missing.json()).toMatchObject({ error: { code: "AUTHORING_UNAUTHORIZED" } });

    const invalid = await app.request("/mcp/authoring", {
      method: "POST",
      headers: {
        Authorization: "Bearer definitely-not-the-token",
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(invalid.status).toBe(401);

    authoringAuth.disable();
    const disabled = await app.request("/mcp/authoring", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(disabled.status).toBe(403);
    expect(await disabled.json()).toMatchObject({ error: { code: "AUTHORING_DISABLED" } });
  });

  test("exposes the fixed bounded discovery Tool set when a catalog is configured", async () => {
    const catalog: AuthoringCatalogService = {
      listProjects: () => ({ items: [{ id: "20000000-0000-4000-8000-000000000001", name: "Project", updatedAt: "2026-09-10T00:00:00.000Z" }], nextCursor: null }),
      listConnections: () => ({ items: [], nextCursor: null }),
      listTools: () => ({ items: [], nextCursor: null }),
      describeTool: () => { throw new Error("not used"); },
    };
    const { client } = await fixture({ catalog });
    const { instance, transport } = client();
    await instance.connect(transport);
    expect((await instance.listTools()).tools.map((tool) => tool.name)).toEqual([
      "inspector_get_capabilities",
      "inspector_list_projects",
      "inspector_list_connections",
      "inspector_list_tools",
      "inspector_describe_tool",
    ]);
    const result = await instance.callTool({ name: "inspector_list_projects", arguments: { limit: 1 } });
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: { items: [{ name: "Project" }], nextCursor: null },
      meta: { protocolVersion: "1" },
    });
  });

  test("rejects hostile origins, unsupported media, oversized bodies, and excess sessions", async () => {
    const { app, client, token } = await fixture({ maxSessions: 1 });
    const baseHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
    };
    const hostile = await app.request("/mcp/authoring", {
      method: "POST",
      headers: { ...baseHeaders, Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(hostile.status).toBe(403);
    expect(await hostile.json()).toMatchObject({ error: { code: "AUTHORING_ORIGIN_REJECTED" } });

    const rebound = await app.request("http://attacker.example/mcp/authoring", {
      method: "POST",
      headers: { ...baseHeaders, Origin: "http://attacker.example", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(rebound.status).toBe(403);

    const unsupported = await app.request("/mcp/authoring", {
      method: "POST", headers: { ...baseHeaders, "Content-Type": "text/plain" }, body: "{}",
    });
    expect(unsupported.status).toBe(415);

    const oversized = await app.request("/mcp/authoring", {
      method: "POST",
      headers: { ...baseHeaders, "Content-Type": "application/json" },
      body: "x".repeat(2 * 1024 * 1024 + 1),
    });
    expect(oversized.status).toBe(413);

    const first = client();
    await first.instance.connect(first.transport);
    const second = client();
    await expect(second.instance.connect(second.transport)).rejects.toMatchObject({
      code: 429,
    });
  });

  test("stops accepting protocol traffic during shutdown", async () => {
    const { app, authoringMcp, token } = await fixture();
    authoringMcp.beginShutdown();
    const response = await app.request("/mcp/authoring", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "AUTHORING_SHUTTING_DOWN" } });
    await authoringMcp.close();
    await authoringMcp.close();
  });

  test("completes initialize, list, call, and close over the real loopback listener", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-authoring-live-"));
    const repository = new InstallationSettingsRepository({ dataRoot });
    const issued = await createAuthoringAuthService({ repository }).enable();
    repository.close();
    if (issued.token === null) throw new Error("Expected a newly issued Authoring Token");

    const runtime = await startInspector({
      port: 0,
      dataRoot,
      clientOrigin: "http://127.0.0.1:5173",
      version: "3.0.0-live-test",
      openBrowser: () => undefined,
      installSignalHandlers: false,
    });
    cleanups.push(async () => {
      await runtime.close();
      rmSync(dataRoot, { recursive: true, force: true });
    });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${runtime.address.origin}/mcp/authoring`),
      { requestInit: { headers: { Authorization: `Bearer ${issued.token}` } } },
    );
    const client = new Client({ name: "authoring-live-test", version: "1.0.0" });
    await client.connect(transport);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "inspector_get_capabilities",
      "inspector_list_projects",
      "inspector_list_connections",
      "inspector_list_tools",
      "inspector_describe_tool",
      "inspector_call_tool",
      "inspector_list_tool_calls",
      "inspector_get_tool_call",
      "inspector_create_draft",
      "inspector_create_draft_from_call",
      "inspector_list_drafts",
      "inspector_get_draft",
      "inspector_replace_draft",
      "inspector_validate_draft",
      "inspector_execute_draft",
      "inspector_get_draft_execution",
      "inspector_cancel_draft_execution",
      "inspector_save_draft",
      "inspector_list_test_assets",
      "inspector_get_test_asset",
    ]);
    const result = await client.callTool({ name: "inspector_get_capabilities", arguments: {} });
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: { endpoint: `${runtime.address.origin}/mcp/authoring` },
    });
    await client.close();
  });
});
