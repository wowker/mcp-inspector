// @vitest-environment jsdom
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient, RunDetail, RunSummary } from "../../../api/api-client.js";
import { consumeRunEventStream, useRunEvents, useRunPolling } from "../use-run-events.js";
import "../../../i18n/index.js";

describe("consumeRunEventStream", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("parses chunk boundaries, comments, CRLF, and multi-line data", async () => {
    const runId = "00000000-0000-4000-8000-000000000821"; const encoder = new TextEncoder();
    const chunks = [": heart\r\n\r\ndata: {\"runId\":\"00000000-0000-4000-8000-000000000821\",\"sequence\":1,",
      "\r\ndata: \"kind\":\"rpc-in\",\"occurredAt\":\"2026-08-17T00:00:00.000Z\",\"payload\":{}}\r\n\r\n"];
    const response = new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }));
    const seen: number[] = []; await consumeRunEventStream(response, runId, new AbortController().signal, (event) => seen.push(event.sequence));
    expect(seen).toEqual([1]);
  });

  it("accepts LF, CRLF, lone CR, and a CRLF split between chunks", async () => {
    const runId = "00000000-0000-4000-8000-000000000821"; const encoder = new TextEncoder();
    const line = (sequence: number) => `data: ${JSON.stringify({ runId, sequence, kind: "rpc-in", occurredAt: `2026-08-17T00:00:0${sequence}.000Z`, payload: {} })}`;
    const chunks = [`${line(1)}\n\n${line(2)}\r\n\r`, `\n${line(3)}\r\r${line(4)}\r`, `\n\r\n`];
    const response = new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }));
    const seen: number[] = []; await consumeRunEventStream(response, runId, new AbortController().signal, (event) => seen.push(event.sequence));
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it("rejects a foreign Run event", async () => {
    const runId = "00000000-0000-4000-8000-000000000821";
    const body = `data: ${JSON.stringify({ runId: "00000000-0000-4000-8000-000000000899", sequence: 1, kind: "rpc-in", occurredAt: "2026-08-17T00:00:00.000Z", payload: {} })}\n\n`;
    await expect(consumeRunEventStream(new Response(body), runId, new AbortController().signal, () => undefined)).rejects.toThrow("Invalid Run event");
  });

  it("reconnects observation with the persisted cursor and never starts a Run", async () => {
    const runId = "00000000-0000-4000-8000-000000000821";
    const projectId = "00000000-0000-4000-8000-000000000822";
    const event = (sequence: number, status?: string) => ({ runId, sequence, kind: status === undefined ? "rpc-in" : "run-status",
      occurredAt: `2026-08-17T00:00:0${sequence}.000Z`, payload: status === undefined ? {} : { status } });
    const base: RunDetail = { id: runId, projectId, connectionId: "00000000-0000-4000-8000-000000000823", tabId: null,
      toolName: "sum", toolSnapshotId: "00000000-0000-4000-8000-000000000824", toolSnapshotHash: "a".repeat(64), idempotencyKey: "once",
      status: "running", createdAt: "2026-08-17T00:00:00.000Z", startedAt: "2026-08-17T00:00:00.000Z", completedAt: null,
      durationMs: null, networkDurationMs: null, pinned: false, replayedFromRunId: null,
      protocolVersion: "2025-06-18", serverInfo: {}, clientInfo: {},
      request: { arguments: {}, jsonrpc: {}, http: null }, response: null, events: [event(1)] };
    const finished = { ...base, status: "succeeded" as const, completedAt: "2026-08-17T00:00:02.000Z", durationMs: 2_000,
      response: { result: { ok: true }, error: null, truncated: false, originalBytes: 11 }, events: [event(1), event(2, "succeeded")] };
    const getRun = vi.fn().mockResolvedValueOnce(base).mockResolvedValueOnce(base).mockResolvedValueOnce(finished);
    const openRunEventStream = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(new Response(
      `data: ${JSON.stringify(event(1))}\n\ndata: ${JSON.stringify(event(2, "succeeded"))}\n\n`));
    const client = { getRun, openRunEventStream, startRun: vi.fn() } as unknown as InspectorApiClient;
    const hook = renderHook(() => useRunEvents(client, projectId, runId));
    await waitFor(() => expect(openRunEventStream).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.run?.status).toBe("succeeded"));
    expect(openRunEventStream.mock.calls.map((call) => call[2])).toEqual([1, 1]);
    expect(hook.result.current.run?.events.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(client.startRun).not.toHaveBeenCalled(); hook.unmount();
  });

  it("retries an initial detail failure with bounded backoff before opening at the authoritative cursor", async () => {
    const runId = "00000000-0000-4000-8000-000000000821"; const projectId = "00000000-0000-4000-8000-000000000822";
    const finished = { id: runId, projectId, connectionId: "00000000-0000-4000-8000-000000000823", tabId: null, toolName: "sum",
      toolSnapshotId: "00000000-0000-4000-8000-000000000824", toolSnapshotHash: "a".repeat(64), idempotencyKey: "once", status: "succeeded" as const,
      createdAt: "2026-08-17T00:00:00.000Z", startedAt: "2026-08-17T00:00:00.000Z", completedAt: "2026-08-17T00:00:01.000Z",
      durationMs: 1_000, networkDurationMs: 900, pinned: false, replayedFromRunId: null,
      protocolVersion: null, serverInfo: null, clientInfo: {}, request: { arguments: {}, jsonrpc: {}, http: null },
      response: { result: {}, error: null, truncated: false, originalBytes: 2 }, events: [{ runId, sequence: 7, kind: "run-status", occurredAt: "2026-08-17T00:00:01.000Z", payload: { status: "succeeded" } }] } satisfies RunDetail;
    const getRun = vi.fn().mockRejectedValueOnce(new Error("detail offline")).mockResolvedValueOnce(finished);
    const client = { getRun, openRunEventStream: vi.fn(), startRun: vi.fn() } as unknown as InspectorApiClient;
    const hook = renderHook(() => useRunEvents(client, projectId, runId));
    await waitFor(() => expect(hook.result.current.error).toContain("detail offline"));
    await waitFor(() => expect(hook.result.current.run?.status).toBe("succeeded"));
    expect(getRun).toHaveBeenCalledTimes(2); expect(client.openRunEventStream).not.toHaveBeenCalled(); expect(client.startRun).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("cancels a pending initial-detail retry timer on unmount", async () => {
    vi.useFakeTimers();
    const getRun = vi.fn().mockRejectedValue(new Error("offline"));
    const client = { getRun, openRunEventStream: vi.fn(), startRun: vi.fn() } as unknown as InspectorApiClient;
    const hook = renderHook(() => useRunEvents(client, "00000000-0000-4000-8000-000000000822", "00000000-0000-4000-8000-000000000821"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(getRun).toHaveBeenCalledTimes(1); hook.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(getRun).toHaveBeenCalledTimes(1); expect(client.openRunEventStream).not.toHaveBeenCalled();
  });

  it("aborts an active stream reader on unmount", async () => {
    const runId = "00000000-0000-4000-8000-000000000821"; const projectId = "00000000-0000-4000-8000-000000000822";
    const running = { id: runId, projectId, connectionId: "00000000-0000-4000-8000-000000000823", tabId: null, toolName: "sum",
      toolSnapshotId: "00000000-0000-4000-8000-000000000824", toolSnapshotHash: "a".repeat(64), idempotencyKey: "once", status: "running" as const,
      createdAt: "2026-08-17T00:00:00.000Z", startedAt: "2026-08-17T00:00:00.000Z", completedAt: null, durationMs: null,
      networkDurationMs: null, pinned: false, replayedFromRunId: null,
      protocolVersion: null, serverInfo: null, clientInfo: {}, request: { arguments: {}, jsonrpc: {}, http: null },
      response: null, events: [] } satisfies RunDetail;
    let streamSignal: AbortSignal | undefined;
    const client = { getRun: vi.fn(async () => running), openRunEventStream: vi.fn((_project: string, _run: string, _after: number, signal: AbortSignal) => {
      streamSignal = signal; return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    }), startRun: vi.fn() } as unknown as InspectorApiClient;
    const hook = renderHook(() => useRunEvents(client, projectId, runId));
    await waitFor(() => expect(streamSignal).toBeDefined()); hook.unmount();
    expect(streamSignal?.aborted).toBe(true); expect(client.startRun).not.toHaveBeenCalled();
  });

  it("aborts the authenticated stream when project selection changes", async () => {
    const runId = "00000000-0000-4000-8000-000000000821"; const firstProject = "00000000-0000-4000-8000-000000000822";
    const nextProject = "00000000-0000-4000-8000-000000000829";
    const base: RunDetail = { id: runId, projectId: firstProject, connectionId: "00000000-0000-4000-8000-000000000823", tabId: null,
      toolName: "sum", toolSnapshotId: "00000000-0000-4000-8000-000000000824", toolSnapshotHash: "a".repeat(64), idempotencyKey: "once",
      status: "running", createdAt: "2026-08-17T00:00:00.000Z", startedAt: "2026-08-17T00:00:00.000Z", completedAt: null,
      durationMs: null, networkDurationMs: null, pinned: false, replayedFromRunId: null,
      protocolVersion: null, serverInfo: null, clientInfo: {}, request: { arguments: {}, jsonrpc: {}, http: null }, response: null, events: [] };
    let firstSignal: AbortSignal | undefined;
    const client = { getRun: vi.fn(async (project: string) => project === firstProject ? base : { ...base, projectId: nextProject, status: "succeeded" }),
      openRunEventStream: vi.fn((_project: string, _run: string, _after: number, signal: AbortSignal) => {
        firstSignal = signal; return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      }) } as unknown as InspectorApiClient;
    const hook = renderHook(({ project }) => useRunEvents(client, project, runId), { initialProps: { project: firstProject } });
    await waitFor(() => expect(firstSignal).toBeDefined()); hook.rerender({ project: nextProject });
    await waitFor(() => expect(firstSignal?.aborted).toBe(true));
    await waitFor(() => expect(hook.result.current.run?.projectId).toBe(nextProject)); hook.unmount();
  });
});

describe("useRunPolling", () => {
  const projectId = "00000000-0000-4000-8000-000000000822";
  const tabId = "00000000-0000-4000-8000-000000000825";
  const runId = "00000000-0000-4000-8000-000000000821";
  const running: RunSummary = { id: runId, projectId, connectionId: "00000000-0000-4000-8000-000000000823", tabId,
    toolName: "sum", toolSnapshotId: "00000000-0000-4000-8000-000000000824", idempotencyKey: "once", status: "running",
    createdAt: "2026-08-17T00:00:00.000Z", startedAt: "2026-08-17T00:00:00.000Z", completedAt: null,
    durationMs: null, networkDurationMs: null, pinned: false, replayedFromRunId: null };
  const finished: RunDetail = { ...running, status: "succeeded", completedAt: "2026-08-17T00:00:01.000Z", durationMs: 1_000,
    toolSnapshotHash: "a".repeat(64), protocolVersion: null, serverInfo: null, clientInfo: {}, request: { arguments: {}, jsonrpc: {}, http: null },
    response: { result: {}, error: null, truncated: false, originalBytes: 2 }, events: [] };

  afterEach(() => { vi.useRealTimers(); });

  it("polls lightweight status at one-second cadence, refreshes detail once at terminal, and stops", async () => {
    vi.useFakeTimers();
    const getRunSummary = vi.fn().mockResolvedValueOnce(running).mockResolvedValueOnce({ ...running, status: "succeeded" });
    const getRun = vi.fn(async () => finished);
    const client = { getRunSummary, getRun } as unknown as InspectorApiClient;
    const hook = renderHook(() => useRunPolling(client, projectId, tabId, runId));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(getRunSummary).toHaveBeenCalledTimes(1); expect(getRun).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(999); }); expect(getRunSummary).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(getRunSummary).toHaveBeenCalledTimes(2); expect(getRun).toHaveBeenCalledTimes(1);
    expect(hook.result.current.run?.status).toBe("succeeded");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getRunSummary).toHaveBeenCalledTimes(2); expect(getRun).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    hook.unmount();
  });

  it("backs status errors off exponentially with an eight-second ceiling", async () => {
    vi.useFakeTimers();
    const getRunSummary = vi.fn().mockRejectedValue(new Error("offline"));
    const client = { getRunSummary, getRun: vi.fn() } as unknown as InspectorApiClient;
    const hook = renderHook(() => useRunPolling(client, projectId, tabId, runId));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); }); expect(getRunSummary).toHaveBeenCalledTimes(1);
    for (const [elapsed, calls] of [[999, 1], [1, 2], [1_999, 2], [1, 3], [3_999, 3], [1, 4], [7_999, 4], [1, 5]] as const) {
      await act(async () => { await vi.advanceTimersByTimeAsync(elapsed); }); expect(getRunSummary).toHaveBeenCalledTimes(calls);
    }
    expect(hook.result.current.error).toBe("offline"); hook.unmount();
  });

  it("aborts old status requests and timers across run, tab, project, selection, and unmount changes", async () => {
    vi.useFakeTimers(); const signals: AbortSignal[] = [];
    const getRunSummary = vi.fn((_project: string, _run: string, signal?: AbortSignal) => {
      signals.push(signal!); return new Promise<RunSummary>(() => undefined);
    });
    const client = { getRunSummary, getRun: vi.fn() } as unknown as InspectorApiClient;
    const hook = renderHook(({ project, tab, run, selected }) => useRunPolling(client, project, tab, selected ? null : run), {
      initialProps: { project: projectId, tab: tabId, run: runId, selected: false },
    });
    await act(async () => { await Promise.resolve(); }); expect(signals[0]?.aborted).toBe(false);
    hook.rerender({ project: projectId, tab: tabId, run: "00000000-0000-4000-8000-000000000826", selected: false });
    expect(signals[0]?.aborted).toBe(true);
    hook.rerender({ project: projectId, tab: "00000000-0000-4000-8000-000000000827", run: "00000000-0000-4000-8000-000000000826", selected: false });
    expect(signals[1]?.aborted).toBe(true);
    hook.rerender({ project: "00000000-0000-4000-8000-000000000828", tab: "00000000-0000-4000-8000-000000000827", run: "00000000-0000-4000-8000-000000000826", selected: false });
    expect(signals[2]?.aborted).toBe(true);
    hook.rerender({ project: "00000000-0000-4000-8000-000000000828", tab: "00000000-0000-4000-8000-000000000827", run: "00000000-0000-4000-8000-000000000826", selected: true });
    expect(signals[3]?.aborted).toBe(true); expect(getRunSummary).toHaveBeenCalledTimes(4);
    hook.unmount(); await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getRunSummary).toHaveBeenCalledTimes(4); expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds N background Tabs to at most one lightweight request per Run per second", async () => {
    vi.useFakeTimers(); const count = 32;
    const targets = Array.from({ length: count }, (_, index) => ({
      tabId: `00000000-0000-4000-8000-${String(100_000_000_000 + index)}`,
      runId: `00000000-0000-4000-8001-${String(100_000_000_000 + index)}`,
    }));
    const getRunSummary = vi.fn(async (project: string, run: string) => {
      const target = targets.find(({ runId: id }) => id === run)!;
      return { ...running, id: run, projectId: project, tabId: target.tabId };
    });
    const client = { getRunSummary, getRun: vi.fn() } as unknown as InspectorApiClient;
    function Observer({ tab, run }: { tab: string; run: string }) { useRunPolling(client, projectId, tab, run); return null; }
    const view = render(createElement("div", null, targets.map((target) =>
      createElement(Observer, { key: target.runId, tab: target.tabId, run: target.runId }))));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(getRunSummary).toHaveBeenCalledTimes(count);
    await act(async () => { await vi.advanceTimersByTimeAsync(9_999); });
    expect(getRunSummary).toHaveBeenCalledTimes(count * 10);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(getRunSummary).toHaveBeenCalledTimes(count * 11); expect(client.getRun).not.toHaveBeenCalled();
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});
