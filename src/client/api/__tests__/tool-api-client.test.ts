import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api-client.js";

const projectId = "00000000-0000-4000-8000-000000000531";
const connectionId = "00000000-0000-4000-8000-000000000532";
const snapshotId = "00000000-0000-4000-8000-000000000533";
const definition = {
  name: "catalog/read item", title: "Read item", description: "read",
  inputSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: { id: { type: "string" }, forbiddenLegacyValue: false },
    required: ["id"],
    additionalProperties: false,
    futureInput: { retained: true },
  },
  outputSchema: {
    type: "object", properties: { found: { type: "boolean" } },
    required: ["found"], futureOutput: true,
  },
  annotations: {
    title: "Read item safely", readOnlyHint: true, destructiveHint: false,
    idempotentHint: true, openWorldHint: false, futureHint: "retained",
  },
  execution: { taskSupport: "optional", futureExecution: { retained: true } },
  icons: [{
    src: "https://example.test/icon.svg", mimeType: "image/svg+xml",
    sizes: ["any", "48x48"], theme: "dark", futureIcon: true,
  }],
  _meta: { retained: true },
  futureTopLevel: { retained: [1, 2, 3] },
};
const snapshot = {
  id: snapshotId, projectId, connectionId, toolName: definition.name,
  contentHash: "a".repeat(64), definition, createdAt: "2026-08-17T12:00:00.000Z",
};
const tool = {
  projectId, connectionId, name: definition.name, status: "current",
  updatedAt: "2026-08-17T12:00:00.000Z", currentSnapshot: snapshot,
};

describe("Tool API response decoding", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("preserves complete definitions and URL-encodes Tool names", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: { tool, snapshots: [snapshot] } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await expect(createApiClient("session").getTool(projectId, connectionId, definition.name))
      .resolves.toEqual({ tool, snapshots: [snapshot] });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("catalog%2Fread%20item"), expect.anything());
  });

  it.each([
    ["foreign project", { ...tool, projectId: "00000000-0000-4000-8000-000000000599" }],
    ["foreign connection", { ...tool, connectionId: "00000000-0000-4000-8000-000000000599" }],
    ["bad hash", { ...tool, currentSnapshot: { ...snapshot, contentHash: "bad" } }],
    ["mismatched definition", { ...tool, currentSnapshot: { ...snapshot, definition: { ...definition, name: "other" } } }],
    ["non-string definition name", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, name: 1 },
    } }],
    ["invalid status", { ...tool, status: "new" }],
    ["non-canonical update timestamp", { ...tool, updatedAt: "2026-08-17T12:00:00Z" }],
    ["non-boolean annotation hint", { ...tool, currentSnapshot: {
      ...snapshot,
      definition: { ...definition, annotations: { readOnlyHint: "yes" } },
    } }],
    ["non-string title", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, title: 1 },
    } }],
    ["non-string description", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, description: false },
    } }],
    ["non-string JSON Schema URI", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, inputSchema: { type: "object", $schema: false } },
    } }],
    ["non-object input root", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, inputSchema: { type: "array" } },
    } }],
    ["array input properties", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, inputSchema: { type: "object", properties: [] } },
    } }],
    ["non-string required entry", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, inputSchema: { type: "object", required: [1] } },
    } }],
    ["non-object output root", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, outputSchema: { type: "array" } },
    } }],
    ["malformed output properties", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, outputSchema: { type: "object", properties: [] } },
    } }],
    ["non-string output required entry", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, outputSchema: { type: "object", required: [1] } },
    } }],
    ["non-string annotation title", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, annotations: { title: 1 } },
    } }],
    ["non-boolean destructive hint", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, annotations: { destructiveHint: 1 } },
    } }],
    ["non-boolean idempotent hint", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, annotations: { idempotentHint: null } },
    } }],
    ["non-boolean open-world hint", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, annotations: { openWorldHint: "no" } },
    } }],
    ["unknown task support", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, execution: { taskSupport: "sometimes" } },
    } }],
    ["non-array icons", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, icons: {} },
    } }],
    ["non-string icon source", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, icons: [{ src: 1 }] },
    } }],
    ["non-string icon MIME type", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, icons: [{ src: "icon", mimeType: 1 }] },
    } }],
    ["non-string icon size", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, icons: [{ src: "icon", sizes: [48] }] },
    } }],
    ["unknown icon theme", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, icons: [{ src: "icon", theme: "auto" }] },
    } }],
    ["non-object metadata", { ...tool, currentSnapshot: {
      ...snapshot, definition: { ...definition, _meta: [] },
    } }],
  ])("rejects a successful list with %s", async (_label, invalid) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tools: [invalid] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await expect(createApiClient("session").listTools(projectId, connectionId))
      .rejects.toThrow("Invalid Tool response");
  });

  it("uses authenticated POST for explicit refresh", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tools: [tool] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await createApiClient("session").refreshTools(projectId, connectionId);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${projectId}/connections/${connectionId}/tools/refresh`,
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({
        "X-DSers-Inspector-Session": "session",
      }) }),
    );
  });

  it("rejects duplicate Tools and a detail that omits its current snapshot", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tools: [tool, tool] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await expect(createApiClient("session").listTools(projectId, connectionId))
      .rejects.toThrow("Invalid Tool response");

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: { tool, snapshots: [] } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await expect(createApiClient("session").getTool(projectId, connectionId, definition.name))
      .rejects.toThrow("Invalid Tool response");
  });

  it.each([
    ["duplicate snapshot IDs", [snapshot, { ...snapshot, contentHash: "b".repeat(64) }], snapshot],
    ["non-canonical timestamp", [{ ...snapshot, createdAt: "2026-08-17T12:00:00Z" }], { ...snapshot, createdAt: "2026-08-17T12:00:00Z" }],
    ["invalid calendar timestamp", [{ ...snapshot, createdAt: "2026-02-30T12:00:00.000Z" }], { ...snapshot, createdAt: "2026-02-30T12:00:00.000Z" }],
    ["epoch-descending history", [
      { ...snapshot, id: "00000000-0000-4000-8000-000000000534", createdAt: "2026-08-18T12:00:00.000Z" },
      snapshot,
    ], snapshot],
    ["invalid tie ordering", [
      snapshot,
      { ...snapshot, id: "00000000-0000-4000-8000-000000000530" },
    ], snapshot],
    ["current snapshot content mismatch", [snapshot], { ...snapshot, contentHash: "b".repeat(64) }],
  ])("rejects Tool detail with %s", async (_label, snapshots, currentSnapshot) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      detail: { tool: { ...tool, currentSnapshot }, snapshots },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(createApiClient("session").getTool(projectId, connectionId, definition.name))
      .rejects.toThrow("Invalid Tool response");
  });
});
