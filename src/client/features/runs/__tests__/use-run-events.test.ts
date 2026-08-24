// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient, RunDetail } from "../../../api/api-client.js";
import { consumeRunEventStream, useRunEvents } from "../use-run-events.js";

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
      durationMs: null, networkDurationMs: null, protocolVersion: "2025-06-18", serverInfo: {}, clientInfo: {},
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

  it("aborts the authenticated stream when project selection changes", async () => {
    const runId = "00000000-0000-4000-8000-000000000821"; const firstProject = "00000000-0000-4000-8000-000000000822";
    const nextProject = "00000000-0000-4000-8000-000000000829";
    const base: RunDetail = { id: runId, projectId: firstProject, connectionId: "00000000-0000-4000-8000-000000000823", tabId: null,
      toolName: "sum", toolSnapshotId: "00000000-0000-4000-8000-000000000824", toolSnapshotHash: "a".repeat(64), idempotencyKey: "once",
      status: "running", createdAt: "2026-08-17T00:00:00.000Z", startedAt: "2026-08-17T00:00:00.000Z", completedAt: null,
      durationMs: null, networkDurationMs: null, protocolVersion: null, serverInfo: null, clientInfo: {}, request: { arguments: {}, jsonrpc: {}, http: null }, response: null, events: [] };
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
