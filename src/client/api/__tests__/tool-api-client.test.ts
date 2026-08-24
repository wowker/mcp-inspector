import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api-client.js";

const projectId = "00000000-0000-4000-8000-000000000531";
const connectionId = "00000000-0000-4000-8000-000000000532";
const snapshotId = "00000000-0000-4000-8000-000000000533";
const definition = {
  name: "catalog/read item", description: "read", inputSchema: { type: "object" },
  outputSchema: { type: "object" }, _meta: { retained: true },
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
    ["invalid status", { ...tool, status: "new" }],
    ["non-canonical update timestamp", { ...tool, updatedAt: "2026-08-17T12:00:00Z" }],
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
