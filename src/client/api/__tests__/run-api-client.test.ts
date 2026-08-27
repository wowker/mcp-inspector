import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api-client.js";

const projectId = "00000000-0000-4000-8000-000000000831";
const tabId = "00000000-0000-4000-8000-000000000832";
const run = { id: "00000000-0000-4000-8000-000000000833", projectId,
  connectionId: "00000000-0000-4000-8000-000000000834", tabId, toolName: "sum",
  toolSnapshotId: "00000000-0000-4000-8000-000000000835", idempotencyKey: "once", status: "queued",
  createdAt: "2026-08-17T00:00:00.000Z", startedAt: null, completedAt: null, durationMs: null, networkDurationMs: null };
const connectionId = run.connectionId;

describe("Run API client", () => {
  const fetchMock = vi.fn(); beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); }); afterEach(() => vi.unstubAllGlobals());
  it("posts one idempotent Run and authenticates its SSE observation", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ run }), { status: 202 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    const api = createApiClient("session");
    await expect(api.startRun(projectId, connectionId, tabId, "once", { a: 1 })).resolves.toEqual(run);
    const controller = new AbortController(); await api.openRunEventStream(projectId, run.id, 7, controller.signal);
    expect(fetchMock.mock.calls[0]).toEqual([`/api/projects/${projectId}/runs`, expect.objectContaining({ method: "POST",
      body: JSON.stringify({ connectionId, tabId, idempotencyKey: "once", arguments: { a: 1 } }) })]);
    expect(fetchMock.mock.calls[1]).toEqual([`/api/projects/${projectId}/runs/${run.id}/events?after=7`, expect.objectContaining({
      headers: expect.objectContaining({ "X-MCP-Inspector-Session": "session", Accept: "text/event-stream" }), signal: controller.signal,
    })]);
  });

  it("rejects a foreign or malformed Run response", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ run: { ...run, projectId: "00000000-0000-4000-8000-000000000899" } }), { status: 200 }));
    await expect(createApiClient("session").startRun(projectId, connectionId, tabId, "once", {})).rejects.toThrow("Invalid Run response");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ run: { ...run, id: "00000000-0000-4000-8000-000000000899",
      toolSnapshotHash: "a".repeat(64), protocolVersion: null, serverInfo: null, clientInfo: {},
      request: { arguments: {}, jsonrpc: {}, http: null }, response: null, events: [] } }), { status: 200 }));
    await expect(createApiClient("session").getRun(projectId, run.id)).rejects.toThrow("Invalid Run response");
  });

  it("loads a lightweight status summary with strict project and Run identity", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ run: { ...run, status: "running" } }), { status: 200 }));
    const api = createApiClient("session");
    await expect(api.getRunSummary(projectId, run.id)).resolves.toEqual({ ...run, status: "running" });
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/projects/${projectId}/runs/${run.id}/status`, expect.objectContaining({ signal: undefined }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ run: { ...run, id: "00000000-0000-4000-8000-000000000899" } }), { status: 200 }));
    await expect(api.getRunSummary(projectId, run.id)).rejects.toThrow("Invalid Run response");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ run: { ...run, projectId: "00000000-0000-4000-8000-000000000899" } }), { status: 200 }));
    await expect(api.getRunSummary(projectId, run.id)).rejects.toThrow("Invalid Run response");
  });

  it("requests server-filtered Tab history and rejects duplicate IDs or malformed cursors", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ runs: [run], nextCursor: "next_page" }), { status: 200 }));
    const api = createApiClient("session");
    const filter = { tabId, connectionId: run.connectionId, toolName: run.toolName };
    await expect(api.listRuns(projectId, undefined, filter)).resolves.toEqual({ runs: [run], nextCursor: "next_page" });
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/projects/${projectId}/runs?tabId=${tabId}&connectionId=${run.connectionId}&toolName=sum`, expect.anything());
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ runs: [run, run], nextCursor: null }), { status: 200 }));
    await expect(api.listRuns(projectId)).rejects.toThrow("Invalid Run response");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ runs: [run], nextCursor: "not a cursor" }), { status: 200 }));
    await expect(api.listRuns(projectId)).rejects.toThrow("Invalid Run response");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ runs: [{ ...run, tabId: "00000000-0000-4000-8000-000000000799" }], nextCursor: null }), { status: 200 }));
    await expect(api.listRuns(projectId, undefined, { tabId })).rejects.toThrow("Invalid Run response");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ runs: [{ ...run, toolName: "previous_sum" }], nextCursor: null }), { status: 200 }));
    await expect(api.listRuns(projectId, undefined, filter)).rejects.toThrow("Invalid Run response");
  });
});
