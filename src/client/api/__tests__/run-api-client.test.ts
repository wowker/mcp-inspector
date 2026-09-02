import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api-client.js";

const projectId = "00000000-0000-4000-8000-000000000831";
const tabId = "00000000-0000-4000-8000-000000000832";
const run = { id: "00000000-0000-4000-8000-000000000833", projectId,
  connectionId: "00000000-0000-4000-8000-000000000834", tabId, toolName: "sum",
  toolSnapshotId: "00000000-0000-4000-8000-000000000835", idempotencyKey: "once", status: "queued",
  createdAt: "2026-08-17T00:00:00.000Z", startedAt: null, completedAt: null,
  durationMs: null, networkDurationMs: null, pinned: false, replayedFromRunId: null };
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
      headers: { Accept: "text/event-stream" }, signal: controller.signal,
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

  it("decodes a large Run response in a Worker before it reaches the UI thread", async () => {
    const detail = { ...run, status: "succeeded", startedAt: run.createdAt, completedAt: run.createdAt,
      durationMs: 1, networkDurationMs: 1, toolSnapshotHash: "a".repeat(64), protocolVersion: null,
      serverInfo: null, clientInfo: {}, request: { arguments: {}, jsonrpc: {}, http: null },
      response: { result: { payload: "x".repeat(600 * 1024) }, error: null, truncated: false,
        originalBytes: 600 * 1024 }, events: [] };
    const workerCalls: unknown[] = [];
    class WorkerMock {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(message: { source: ArrayBuffer }, transfer: Transferable[]) {
        workerCalls.push(message);
        workerCalls.push(transfer);
        const value = JSON.parse(new TextDecoder().decode(message.source)) as { run: unknown };
        queueMicrotask(() => this.onmessage?.({ data: { ok: true, run: value.run } } as MessageEvent));
      }
      terminate() { workerCalls.push("terminated"); }
    }
    vi.stubGlobal("Worker", WorkerMock);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ run: detail }), { status: 200 }));

    await expect(createApiClient().getRun(projectId, run.id)).resolves.toMatchObject({
      id: run.id, response: { result: { payload: expect.stringMatching(/^x+$/) } },
    });
    expect(workerCalls[0]).toMatchObject({ projectId, runId: run.id });
    expect(workerCalls[1]).toEqual([expect.any(ArrayBuffer)]);
    expect(workerCalls.at(-1)).toBe("terminated");
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

  it("sends extended history filters and pins a Run explicitly", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ runs: [{ ...run, pinned: true }], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ run: { ...run, pinned: true } }), { status: 200 }));
    const api = createApiClient("session");
    await expect(api.listRuns(projectId, undefined, {
      status: "succeeded", origin: "REPLAY", pinned: true,
      createdFrom: "2026-09-01T00:00:00.000Z", limit: 25,
    })).resolves.toEqual({ runs: [{ ...run, pinned: true }], nextCursor: null });
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/projects/${projectId}/runs?status=succeeded&origin=REPLAY&pinned=true&createdFrom=2026-09-01T00%3A00%3A00.000Z&limit=25`,
      expect.anything(),
    );
    await expect(api.setRunPinned(projectId, run.id, true)).resolves.toEqual({ ...run, pinned: true });
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/projects/${projectId}/runs/${run.id}/pin`, expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ pinned: true }),
    }));
  });

  it("loads a strict replay preflight and starts a lineage-fenced replay", async () => {
    const preflight = {
      projectId, sourceRunId: run.id, connectionId, toolName: "sum", arguments: { a: 1 },
      sourceToolSnapshotId: run.toolSnapshotId, sourceToolSnapshotHash: "a".repeat(64),
      currentToolSnapshotId: run.toolSnapshotId, currentToolSnapshotHash: "a".repeat(64),
      annotations: { readOnlyHint: true }, schemaChanges: [], sideEffectRisk: "SAFE", blockers: [],
      requiredConfirmations: [], digest: "d".repeat(64),
    };
    const replay = { ...run, id: "00000000-0000-4000-8000-000000000836", tabId: null,
      idempotencyKey: "replay", replayedFromRunId: run.id };
    const request = { idempotencyKey: "replay", preflightDigest: preflight.digest,
      confirmSchemaDrift: false, confirmSideEffects: false };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ preflight }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ run: replay }), { status: 202 }));
    const api = createApiClient("session");
    await expect(api.getReplayPreflight(projectId, run.id)).resolves.toEqual(preflight);
    await expect(api.startReplay(projectId, run.id, request)).resolves.toEqual(replay);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/projects/${projectId}/runs/${run.id}/replay-preflight`);
    expect(fetchMock.mock.calls[1]).toEqual([`/api/projects/${projectId}/runs/${run.id}/replay`, expect.objectContaining({
      method: "POST", body: JSON.stringify(request),
    })]);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ preflight: { ...preflight, sourceRunId: replay.id } }), { status: 200 }));
    await expect(api.getReplayPreflight(projectId, run.id)).rejects.toThrow("Invalid replay preflight response");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ run: { ...replay, replayedFromRunId: null } }), { status: 202 }));
    await expect(api.startReplay(projectId, run.id, request)).rejects.toThrow("Invalid replay response");
  });
});
