import { describe, expect, it, vi } from "vitest";
import { RunEventBus } from "../run-event-bus.js";
import {
  RunIdempotencyConflictError, RunNotFoundError, RunValidationError, type RunServiceWithEvents,
} from "../run-service.js";
import { createRunRoutes } from "../routes.js";
import type { RunDetail, RunEvent, RunSummary } from "../run-types.js";

const projectId = "00000000-0000-4000-8000-000000000701";
const runId = "00000000-0000-4000-8000-000000000703";
const tabId = "00000000-0000-4000-8000-000000000704";
const summary: RunSummary = { id: runId, projectId, connectionId: "00000000-0000-4000-8000-000000000702",
  tabId, toolName: "sum", toolSnapshotId: "00000000-0000-4000-8000-000000000705", idempotencyKey: "submit",
  status: "queued", createdAt: "2026-08-17T00:00:00.000Z", startedAt: null, completedAt: null,
  durationMs: null, networkDurationMs: null };
const detail: RunDetail = { ...summary, toolSnapshotHash: "a".repeat(64), protocolVersion: null, serverInfo: null, clientInfo: {},
  request: { arguments: { a: 1 }, jsonrpc: {}, http: null }, response: null, events: [] };

function fake(overrides: Partial<RunServiceWithEvents> = {}): RunServiceWithEvents {
  return {
    eventBus: new RunEventBus(), start: () => summary, cancel: () => true,
    list: () => ({ runs: [summary], nextCursor: null }), get: () => detail,
    assertExists: () => summary, events: () => [], ...overrides,
  };
}

describe("run routes", () => {
  it("returns planned start, validation, conflict, cancel, and not-found statuses", async () => {
    const headers = { "Content-Type": "application/json" };
    const valid = { tabId, idempotencyKey: "submit", arguments: { a: 1 } };
    expect((await createRunRoutes(fake()).request(`/${projectId}/runs`, {
      method: "POST", headers, body: JSON.stringify(valid),
    })).status).toBe(202);
    const invalidArguments = createRunRoutes(fake({ start: () => { throw new RunValidationError([
      { path: "/a", keyword: "type", message: "must be number" },
    ]); } }));
    const validation = await invalidArguments.request(`/${projectId}/runs`, { method: "POST", headers, body: JSON.stringify(valid) });
    expect(validation.status).toBe(422);
    expect(await validation.json()).toEqual({ error: { code: "INVALID_ARGUMENTS", message: "Run arguments are invalid",
      issues: [{ path: "/a", keyword: "type", message: "must be number" }] } });
    expect((await createRunRoutes(fake({ start: () => { throw new RunIdempotencyConflictError(); } }))
      .request(`/${projectId}/runs`, { method: "POST", headers, body: JSON.stringify(valid) })).status).toBe(409);
    expect((await createRunRoutes(fake({ cancel: () => false }))
      .request(`/${projectId}/runs/${runId}/cancel`, { method: "POST" })).status).toBe(409);
    expect((await createRunRoutes(fake({ get: () => { throw new RunNotFoundError(); } }))
      .request(`/${projectId}/runs/${runId}`)).status).toBe(404);
    expect((await createRunRoutes(fake()).request(`/${projectId}/runs/${runId}/events?after=-1`)).status).toBe(400);
    expect((await createRunRoutes(fake()).request(`/${projectId}/runs?tabId=bad`)).status).toBe(400);
  });

  it("passes a validated Tab filter to the project-scoped history service", async () => {
    const list = vi.fn(() => ({ runs: [summary], nextCursor: null }));
    const response = await createRunRoutes(fake({ list })).request(`/${projectId}/runs?tabId=${tabId}&cursor=opaque`);
    expect(response.status).toBe(200); expect(list).toHaveBeenCalledWith(projectId, "opaque", tabId);
  });

  it("subscribes before backlog, deduplicates the race, and releases the subscription on abort", async () => {
    const bus = new RunEventBus();
    const makeEvent = (sequence: number): RunEvent => ({ runId, sequence, kind: "rpc-in",
      occurredAt: `2026-08-17T00:00:0${sequence}.000Z`, payload: { sequence } });
    const service = fake({ eventBus: bus, events: (_project, _run, after = 0) => {
      bus.publish(makeEvent(2)); bus.publish(makeEvent(3));
      return [makeEvent(1), makeEvent(2)].filter(({ sequence }) => sequence > after);
    } });
    const response = await createRunRoutes(service).request(`/${projectId}/runs/${runId}/events?after=0`);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader(); const decoder = new TextDecoder(); let text = "";
    for (let attempt = 0; attempt < 10 && !text.includes("id: 3"); attempt += 1) {
      const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value, { stream: true });
    }
    expect(text.match(/^id: [123]$/gm)).toEqual(["id: 1", "id: 2", "id: 3"]);
    await reader.cancel(); await vi.waitFor(() => expect(bus.subscriberCount(runId)).toBe(0));
  });

  it("emits a 15-second heartbeat and cleans its timer on cancellation", async () => {
    vi.useFakeTimers();
    try {
      const service = fake();
      const response = await createRunRoutes(service).request(`/${projectId}/runs/${runId}/events`);
      const reader = response.body!.getReader();
      await vi.advanceTimersByTimeAsync(15_000);
      const chunk = await reader.read();
      expect(new TextDecoder().decode(chunk.value)).toBe(": heartbeat\n\n");
      await reader.cancel();
      await vi.advanceTimersByTimeAsync(1);
      expect(service.eventBus.subscriberCount(runId)).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("disconnects a subscriber whose pending live queue exceeds its bound", async () => {
    const bus = new RunEventBus();
    const service = fake({ eventBus: bus, events: () => {
      for (let sequence = 1; sequence <= 257; sequence += 1) {
        bus.publish({ runId, sequence, kind: "rpc-in", occurredAt: "2026-08-17T00:00:00.000Z", payload: { sequence } });
      }
      return [];
    } });
    const response = await createRunRoutes(service).request(`/${projectId}/runs/${runId}/events`);
    await vi.waitFor(() => expect(bus.subscriberCount(runId)).toBe(0));
    await response.body?.cancel().catch(() => undefined);
  });

  it("streams a 300-event persisted backlog in pages while deduplicating a live arrival", async () => {
    const bus = new RunEventBus();
    const all = Array.from({ length: 301 }, (_, index) => ({ runId, sequence: index + 1, kind: "rpc-in",
      occurredAt: "2026-08-17T00:00:00.000Z", payload: { sequence: index + 1 } } satisfies RunEvent));
    let calls = 0;
    const service = fake({ eventBus: bus,
      events: (_project, _run, after = 0, limit = 128) => {
        calls += 1;
        if (calls === 2) bus.publish(all[300]);
        return all.filter(({ sequence }) => sequence > after).slice(0, limit);
      },
    } as Partial<RunServiceWithEvents>);
    const response = await createRunRoutes(service).request(`/${projectId}/runs/${runId}/events`);
    const reader = response.body!.getReader(); const decoder = new TextDecoder(); let text = "";
    for (let attempt = 0; attempt < 400 && !text.includes("id: 301"); attempt += 1) {
      const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value, { stream: true });
    }
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    expect(ids).toEqual(Array.from({ length: 301 }, (_, index) => index + 1));
    expect(calls).toBeGreaterThanOrEqual(3);
    await reader.cancel();
  });

  it("never lets another Run's live cursor enter the requested Run stream", async () => {
    const otherRunId = "00000000-0000-4000-8000-000000000799";
    const bus = new RunEventBus();
    const own = { runId, sequence: 2, kind: "rpc-in", occurredAt: "2026-08-17T00:00:00.000Z", payload: { owner: "a" } } satisfies RunEvent;
    const foreign = { ...own, runId: otherRunId, sequence: 99, payload: { owner: "b" } };
    const service = fake({ eventBus: bus, events: () => { bus.publish(foreign); return [own]; } });
    const response = await createRunRoutes(service).request(`/${projectId}/runs/${runId}/events?after=1`);
    const reader = response.body!.getReader(); const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain("id: 2"); expect(text).not.toContain("id: 99"); expect(text).not.toContain(otherRunId);
    await reader.cancel();
  });
});
