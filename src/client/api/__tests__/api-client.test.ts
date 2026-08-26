import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api-client.js";

const projectId = "00000000-0000-4000-8000-000000000601";

function validConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000602",
    projectId,
    name: "Catalog MCP",
    url: "https://mcp.example.test/mcp?region=eu",
    transport: "streamable-http",
    authMode: "none",
    headers: {},
    timeoutMs: 10_000,
    status: "disconnected",
    lastProtocolVersion: null,
    lastServerInfo: null,
    lastError: null,
    ...overrides,
  };
}

describe("connection API response decoding", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("accepts only a valid project-owned list envelope", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      connections: [validConnection({
        lastProtocolVersion: "2025-06-18",
        lastServerInfo: { name: "catalog", version: "1.0.0" },
        lastError: { code: "TIMEOUT", message: "Timed out" },
      })],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(createApiClient("session").listConnections(projectId)).resolves.toEqual([
      validConnection({
        lastProtocolVersion: "2025-06-18",
        lastServerInfo: { name: "catalog", version: "1.0.0" },
        lastError: { code: "TIMEOUT", message: "Timed out" },
      }),
    ]);
  });

  it.each([
    ["missing envelope", {}],
    ["non-array list", { connections: validConnection() }],
    ["malformed UUID", { connections: [validConnection({ id: "not-a-uuid" })] }],
    ["foreign project", { connections: [validConnection({ projectId: "00000000-0000-4000-8000-000000000699" })] }],
    ["non-HTTP URL", { connections: [validConnection({ url: "file:///tmp/server" })] }],
    ["credential URL", { connections: [validConnection({ url: "https://user:secret@mcp.example.test/mcp" })] }],
    ["unsupported transport", { connections: [validConnection({ transport: "sse" })] }],
    ["unsupported auth", { connections: [validConnection({ authMode: "bearer" })] }],
    ["unknown runtime state", { connections: [validConnection({ status: "ready" })] }],
    ["invalid timeout", { connections: [validConnection({ timeoutMs: 99 })] }],
    ["invalid headers", { connections: [validConnection({ headers: { "Bad Header": "value" } })] }],
    ["non-string header", { connections: [validConnection({ headers: { "X-API-Key": 42 } })] }],
    ["invalid protocol", { connections: [validConnection({ lastProtocolVersion: 42 })] }],
    ["invalid server info", { connections: [validConnection({ lastServerInfo: [] })] }],
    ["invalid error", { connections: [validConnection({ lastError: { code: 42, message: "bad" } })] }],
  ])("rejects a 200 response with %s", async (_label, payload) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(createApiClient("session").listConnections(projectId))
      .rejects.toThrow("Invalid connection response");
  });

  it.each(["disconnected", "connecting", "connected", "failed"] as const)(
    "accepts the public %s runtime state",
    async (status) => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({
        connections: [validConnection({ status })],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

      await expect(createApiClient("session").listConnections(projectId)).resolves.toEqual([
        validConnection({ status }),
      ]);
    },
  );

  it("validates the create envelope against the requested project", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      connection: validConnection({ projectId: "00000000-0000-4000-8000-000000000699" }),
    }), { status: 201, headers: { "Content-Type": "application/json" } }));

    await expect(createApiClient("session").createConnection(projectId, {
      name: "Catalog MCP",
      url: "https://mcp.example.test/mcp",
      transport: "streamable-http",
      authMode: "none",
      timeoutMs: 10_000,
    })).rejects.toThrow("Invalid connection response");
  });

  it("patches editable connection fields and validates the returned identity", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      connection: validConnection({ name: "Fixed MCP", url: "https://fixed.example.test/mcp", timeoutMs: 20_000 }),
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(createApiClient("session").updateConnection(
      projectId,
      "00000000-0000-4000-8000-000000000602",
      { name: "Fixed MCP", url: "https://fixed.example.test/mcp", timeoutMs: 20_000 },
    )).resolves.toEqual(validConnection({ name: "Fixed MCP", url: "https://fixed.example.test/mcp", timeoutMs: 20_000 }));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${projectId}/connections/00000000-0000-4000-8000-000000000602`,
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({
        name: "Fixed MCP", url: "https://fixed.example.test/mcp", timeoutMs: 20_000,
      }) }),
    );
  });

  it("rejects a record whose equally requested project ID is not a UUID", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      connections: [validConnection({ projectId: "not-a-uuid" })],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(createApiClient("session").listConnections("not-a-uuid"))
      .rejects.toThrow("Invalid connection response");
  });

  it("uses a stable connection error for a non-JSON success response", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));

    await expect(createApiClient("session").listConnections(projectId))
      .rejects.toThrow("Invalid connection response");
  });

  it("uses the HTTP status when an error response has no JSON body", async () => {
    fetchMock.mockResolvedValue(new Response("service unavailable", { status: 503 }));

    await expect(createApiClient("session").listConnections(projectId))
      .rejects.toThrow("Request failed (503)");
  });
});
