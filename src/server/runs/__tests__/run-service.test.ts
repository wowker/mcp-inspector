import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { FakeMcpSession } from "../../../../test-support/fake-mcp-session.js";
import { createConnectionService } from "../../connections/connection-service.js";
import { CallTimeoutError, type WireObservation } from "../../connections/connection-runtime.js";
import { createProjectService } from "../../projects/project-service.js";
import { createTabService } from "../../tabs/tab-service.js";
import { ToolRepository } from "../../tools/tool-repository.js";
import { createToolService } from "../../tools/tool-service.js";
import { RunRepository } from "../run-repository.js";
import { RunEventBus } from "../run-event-bus.js";
import type { RunEvent } from "../run-types.js";
import { RunIdempotencyConflictError, RunValidationError, createRunService } from "../run-service.js";

const projectId = "00000000-0000-4000-8000-000000000701";
const connectionId = "00000000-0000-4000-8000-000000000702";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}

describe("RunService", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture(call?: FakeMcpSession["call"], factory?: () => Promise<FakeMcpSession>) {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-runs-")); roots.push(dataRoot);
    let next = 710;
    const ids = () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
    const projects = createProjectService({ dataRoot, createId: () => projectId }); projects.create("Runs");
    const session = new FakeMcpSession(); session.call = call;
    const connections = createConnectionService(projects, { createId: () => connectionId,
      sessionFactory: factory ?? (async () => session) });
    connections.create(projectId, { name: "Server", url: "https://example.test/mcp", transport: "streamable-http", authMode: "none", timeoutMs: 10_000 });
    new ToolRepository(projects.open(projectId)).replaceCatalog(projectId, connectionId, [{ id: ids(), name: "sum", contentHash: "a".repeat(64),
      definitionJson: JSON.stringify({ name: "sum", inputSchema: { type: "object", required: ["a"], properties: { a: { type: "number" } } } }) }], "2026-08-17T00:00:00.000Z");
    const tools = createToolService(projects, connections);
    const tabs = createTabService(projects, connections, { tools, createId: ids });
    const tabA = tabs.open({ projectId, connectionId, toolName: "sum" });
    const tabB = tabs.open({ projectId, connectionId, toolName: "sum" });
    const service = createRunService(projects, connections, tabs, { createId: ids });
    return { dataRoot, projects, connections, session, tabs, tabA, tabB, service };
  }

  async function terminal(service: ReturnType<typeof createRunService>, id: string) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const run = service.get(projectId, id);
      if (["succeeded", "failed", "cancelled"].includes(run.status)) return run;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error("Run did not finish");
  }

  it("is idempotent only for the same Tab, snapshot, and canonical arguments", async () => {
    const { projects, session, service, tabA, tabB } = fixture();
    try {
      const first = service.start({ projectId, tabId: tabA.id, idempotencyKey: "submit-a", arguments: { a: 1, b: 2 } });
      const duplicate = service.start({ projectId, tabId: tabA.id, idempotencyKey: "submit-a", arguments: { b: 2, a: 1 } });
      expect(duplicate.id).toBe(first.id);
      expect(() => service.start({ projectId, tabId: tabA.id, idempotencyKey: "submit-a", arguments: { a: 3, b: 2 } }))
        .toThrow(RunIdempotencyConflictError);
      expect(() => service.start({ projectId, tabId: tabB.id, idempotencyKey: "submit-a", arguments: { a: 99 } }))
        .toThrow(RunIdempotencyConflictError);
      expect(service.cancel(projectId, first.id)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(session.calls).toHaveLength(0);
    } finally { projects.close(); }
  });

  it("makes genuinely overlapping duplicate inserts race-safe across worker SQLite handles", async () => {
    const { dataRoot, projects, tabA } = fixture();
    const project = projects.list()[0];
    try {
      const firstStore = projects.open(projectId);
      const snapshot = firstStore.database.prepare("SELECT id FROM tool_snapshots LIMIT 1").get() as { id: string };
      const input = { projectId, connectionId, tabId: tabA.id, toolName: "sum", toolSnapshotId: snapshot.id,
        idempotencyKey: "parallel", canonicalArguments: '{"a":1}', jsonrpc: { method: "tools/call" }, clientInfo: {},
        createdAt: "2026-08-17T00:00:00.000Z" };
      const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
      const state = new Int32Array(barrier);
      const runWorker = (id: string) => {
        let readyResolve!: () => void; let resultResolve!: (value: { ok: boolean; created?: boolean; runId?: string; error?: string }) => void;
        const ready = new Promise<void>((resolve) => { readyResolve = resolve; });
        const result = new Promise<{ ok: boolean; created?: boolean; runId?: string; error?: string }>((resolve) => { resultResolve = resolve; });
        const worker = new Worker(new URL("../../../../test-support/run-create-worker.mjs", import.meta.url), {
          workerData: { databasePath: join(dataRoot, "projects", projectId, "project.sqlite"), project,
            input: { ...input, id }, barrier },
        });
        worker.on("message", (message: { type: string; ok?: boolean; created?: boolean; runId?: string; error?: string }) => {
          if (message.type === "ready") readyResolve();
          else resultResolve({ ok: message.ok === true, created: message.created, runId: message.runId, error: message.error });
        });
        worker.once("error", (error) => resultResolve({ ok: false, error: error.message }));
        return { ready, result };
      };
      const left = runWorker("00000000-0000-4000-8000-000000000981");
      const right = runWorker("00000000-0000-4000-8000-000000000982");
      await Promise.all([left.ready, right.ready]);
      Atomics.store(state, 0, 1); Atomics.notify(state, 0, 2);
      const outcomes = await Promise.all([left.result, right.result]);
      expect(outcomes.every(({ ok }) => ok)).toBe(true);
      expect(outcomes.map(({ created }) => created).sort()).toEqual([false, true]);
      expect(outcomes[0].runId).toBe(outcomes[1].runId);
      expect(JSON.stringify(outcomes)).not.toContain("SQLITE_BUSY");
      expect(firstStore.database.prepare("SELECT count(*) AS count FROM runs WHERE idempotency_key = 'parallel'").get())
        .toEqual({ count: 1 });
      expect(firstStore.database.prepare("SELECT count(*) AS count FROM run_requests WHERE run_id IN (SELECT id FROM runs WHERE idempotency_key = 'parallel')").get())
        .toEqual({ count: 1 });
      expect(firstStore.database.prepare("SELECT count(*) AS count FROM run_events WHERE run_id IN (SELECT id FROM runs WHERE idempotency_key = 'parallel')").get())
        .toEqual({ count: 1 });
    } finally { projects.close(); }
  });

  it("schedules exactly one execution for duplicate submissions", async () => {
    const { projects, connections, session, service, tabA } = fixture();
    try {
      await connections.connect(projectId, connectionId);
      const first = service.start({ projectId, tabId: tabA.id, idempotencyKey: "one-execution", arguments: { a: 1 } });
      let terminalWasCommitted = false;
      const unsubscribe = service.eventBus.subscribe(first.id, (event) => {
        if ((event.payload as { status?: string }).status !== "succeeded") return;
        const stored = projects.open(projectId).database.prepare(`SELECT r.status, p.result_json, t.last_run_id
          FROM runs r JOIN run_responses p ON p.run_id = r.id JOIN debug_tabs t ON t.id = r.tab_id WHERE r.id = ?`)
          .get(first.id) as { status: string; result_json: string; last_run_id: string };
        terminalWasCommitted = stored.status === "succeeded" && stored.last_run_id === first.id && JSON.parse(stored.result_json) !== null;
        throw new Error("listener failure must not roll back the transaction");
      });
      const duplicate = service.start({ projectId, tabId: tabA.id, idempotencyKey: "one-execution", arguments: { a: 1 } });
      expect(duplicate.id).toBe(first.id);
      await terminal(service, first.id);
      unsubscribe();
      expect(session.calls).toHaveLength(1);
      expect(terminalWasCommitted).toBe(true);
      expect(new RunRepository(projects.open(projectId), service.eventBus)
        .transition(projectId, first.id, ["queued"], "running", new Date().toISOString())).toBe(false);
    } finally { projects.close(); }
  });

  it("isolates eight shuffled calls, observations, and results", async () => {
    const pending = new Map<number, ReturnType<typeof deferred<CallToolResult>>>();
    const { projects, connections, service, tabA } = fixture(async ({ arguments: args, observe }) => {
      const marker = args.a as number; const item = deferred<CallToolResult>(); pending.set(marker, item);
      observe?.({ kind: "http-request", at: `2026-08-17T00:00:0${marker}.000Z`, method: "POST", url: "https://example.test/mcp",
        headers: { Authorization: "Bearer do-not-store", "x-safe": "visible" }, body: { marker } });
      const result = await item.promise;
      observe?.({ kind: "http-response", at: `2026-08-17T00:00:0${marker}.025Z`, status: 200, headers: {}, body: result });
      return result;
    });
    try {
      await connections.connect(projectId, connectionId);
      const runs = Array.from({ length: 8 }, (_, a) => service.start({ projectId, tabId: tabA.id, idempotencyKey: `call-${a}`, arguments: { a } }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (const marker of [6, 1, 7, 0, 4, 2, 5, 3]) pending.get(marker)!.resolve({ content: [{ type: "text", text: String(marker) }] });
      const details = await Promise.all(runs.map((run) => terminal(service, run.id)));
      details.forEach((detail, marker) => {
        expect(detail.status).toBe("succeeded");
        expect(detail.request.arguments).toEqual({ a: marker });
        expect(detail.response?.result).toEqual({ content: [{ type: "text", text: String(marker) }] });
        expect(detail.networkDurationMs).toBe(25);
        expect(detail.protocolVersion).toBe("2025-06-18");
        expect(detail.toolSnapshotHash).toBe("a".repeat(64));
        expect(detail.serverInfo).toEqual({ name: "fake", version: "1.0.0" });
        expect(detail.request.http).toMatchObject({ kind: "http-request", body: { marker } });
        expect(detail.request.http).toMatchObject({ headers: { Authorization: "[REDACTED]", "x-safe": "visible" } });
        expect(JSON.stringify(detail.events)).not.toContain("do-not-store");
        expect(detail.events.map((event) => event.sequence)).toEqual([...detail.events.keys()].map((index) => index + 1));
        expect(JSON.stringify(detail.events)).toContain(`"marker":${marker}`);
      });
    } finally { projects.close(); }
  });

  it("lets cancellation win a late result and preserves isError Tool results", async () => {
    const late = deferred<CallToolResult>();
    let call = 0;
    const { projects, connections, service, tabs, tabA } = fixture(async () => ++call === 1 ? late.promise : ({ isError: true, content: [{ type: "text", text: "bad input" }] }));
    try {
      await connections.connect(projectId, connectionId);
      const cancelled = service.start({ projectId, tabId: tabA.id, idempotencyKey: "cancel", arguments: { a: 1 } });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(service.cancel(projectId, cancelled.id)).toBe(true);
      late.resolve({ content: [{ type: "text", text: "too late" }] });
      expect((await terminal(service, cancelled.id)).status).toBe("cancelled");
      expect(service.get(projectId, cancelled.id).response?.result).toBeNull();
      expect(service.get(projectId, cancelled.id).response?.error?.code).toBe("CALL_CANCELLED");
      expect(service.cancel(projectId, cancelled.id)).toBe(false);
      const completedAt = service.get(projectId, cancelled.id).completedAt;
      const lastRunId = tabs.get(projectId, tabA.id).lastRunId;
      expect(service.cancel(projectId, cancelled.id)).toBe(false);
      expect(service.get(projectId, cancelled.id).completedAt).toBe(completedAt);
      expect(tabs.get(projectId, tabA.id).lastRunId).toBe(lastRunId);
      const failed = service.start({ projectId, tabId: tabA.id, idempotencyKey: "tool-error", arguments: { a: 2 } });
      const detail = await terminal(service, failed.id);
      expect(detail.status).toBe("failed");
      expect(detail.response?.result).toMatchObject({ isError: true });
      expect(service.cancel(projectId, failed.id)).toBe(false);
    } finally { projects.close(); }
  });

  it("moves a disconnected call through connecting and stores safe rejected-call errors", async () => {
    let invocation = 0;
    const { projects, service, tabA } = fixture(async () => {
      invocation += 1;
      if (invocation === 1) return { content: [{ type: "text", text: "ok" }] };
      throw new Error("Bearer top-secret /Users/test/private.sqlite");
    });
    try {
      const success = service.start({ projectId, tabId: tabA.id, idempotencyKey: "connect", arguments: { a: 1 } });
      const succeeded = await terminal(service, success.id);
      expect(succeeded.events.filter(({ kind }) => kind === "run-status").map(({ payload }) => payload))
        .toEqual([{ status: "queued" }, { status: "connecting" }, { status: "running" }, { status: "succeeded" }]);
      const failure = service.start({ projectId, tabId: tabA.id, idempotencyKey: "reject", arguments: { a: 2 } });
      const failed = await terminal(service, failure.id);
      expect(failed.response?.error).toEqual({ code: "MCP_CALL_FAILED", message: "MCP Tool call failed" });
      expect(JSON.stringify(failed)).not.toContain("top-secret");
      expect(JSON.stringify(failed)).not.toContain("private.sqlite");
    } finally { projects.close(); }
  });

  it("cancels while connecting without dispatching a Tool call", async () => {
    const connectionGate = deferred<void>();
    const session = new FakeMcpSession();
    const { projects, service, tabA } = fixture(undefined, async () => { await connectionGate.promise; return session; });
    try {
      const run = service.start({ projectId, tabId: tabA.id, idempotencyKey: "cancel-connect", arguments: { a: 1 } });
      await vi.waitFor(() => expect(service.get(projectId, run.id).status).toBe("connecting"));
      expect(service.cancel(projectId, run.id)).toBe(true);
      connectionGate.resolve();
      expect((await terminal(service, run.id)).status).toBe("cancelled");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(session.calls).toHaveLength(0);
    } finally { projects.close(); }
  });

  it("closes the scoped observer immediately when an external cancel wins", async () => {
    const pending = deferred<CallToolResult>(); let observer: ((event: WireObservation) => void) | undefined;
    const { projects, connections, service, tabA } = fixture(async ({ observe }) => { observer = observe; return pending.promise; });
    try {
      await connections.connect(projectId, connectionId);
      const run = service.start({ projectId, tabId: tabA.id, idempotencyKey: "cancel-observer", arguments: { a: 1 } });
      await vi.waitFor(() => expect(service.get(projectId, run.id).status).toBe("running"));
      expect(service.cancel(projectId, run.id)).toBe(true);
      const count = service.get(projectId, run.id).events.length;
      observer?.({ kind: "rpc-in", at: "2026-08-17T00:00:09.000Z", message: { late: "after-cancel" } });
      expect(service.get(projectId, run.id).events).toHaveLength(count);
      pending.resolve({ content: [{ type: "text", text: "late" }] });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(service.get(projectId, run.id).status).toBe("cancelled");
    } finally { projects.close(); }
  });

  it("normalizes connection factory failures without persisting their details", async () => {
    const { projects, service, tabA } = fixture(undefined, async () => {
      throw new Error("dial failed with secret at /Users/test/key");
    });
    try {
      const run = service.start({ projectId, tabId: tabA.id, idempotencyKey: "factory-fail", arguments: { a: 1 } });
      const failed = await terminal(service, run.id);
      expect(failed.status).toBe("failed");
      expect(failed.response?.error).toEqual({ code: "MCP_CONNECT_FAILED", message: "Unable to connect to MCP server" });
      expect(JSON.stringify(failed)).not.toContain("/Users/test/key");
    } finally { projects.close(); }
  });

  it("distinguishes timeout and reports validation issues with JSON pointers before persistence", async () => {
    const { projects, service, tabA } = fixture(async () => { throw new CallTimeoutError(); });
    try {
      expect(() => service.start({ projectId, tabId: tabA.id, idempotencyKey: "invalid", arguments: {} }))
        .toThrow(RunValidationError);
      expect(service.list(projectId).runs).toHaveLength(0);
      const run = service.start({ projectId, tabId: tabA.id, idempotencyKey: "timeout", arguments: { a: 1 } });
      expect((await terminal(service, run.id)).response?.error)
        .toEqual({ code: "CALL_TIMEOUT", message: "MCP Tool call timed out" });
    } finally { projects.close(); }
  });

  it("surfaces scoped trace persistence failure without losing an otherwise resolved call", async () => {
    const { projects, connections, service, tabA } = fixture(async ({ observe }) => {
      observe?.({ kind: "http-request", at: "2026-08-17T00:00:00.000Z", method: "POST", url: "https://example.test/mcp", headers: {}, body: {} });
      return { content: [{ type: "text", text: "completed" }] };
    });
    try {
      await connections.connect(projectId, connectionId);
      projects.open(projectId).database.exec(`CREATE TRIGGER reject_http_trace BEFORE INSERT ON run_events
        WHEN NEW.kind = 'http-request' BEGIN SELECT RAISE(ABORT, 'trace write unavailable'); END`);
      const run = service.start({ projectId, tabId: tabA.id, idempotencyKey: "trace-fail", arguments: { a: 1 } });
      const detail = await terminal(service, run.id);
      expect(detail.status).toBe("failed");
      expect(detail.response?.error).toEqual({ code: "TRACE_PERSIST_FAILED", message: "Run recording failed" });
      expect(detail.response?.result).toEqual({ content: [{ type: "text", text: "completed" }] });
    } finally { projects.close(); }
  });

  it("falls back to failed when an atomic success terminal event cannot be recorded", async () => {
    const { projects, connections, service, tabA } = fixture();
    try {
      await connections.connect(projectId, connectionId);
      projects.open(projectId).database.exec(`CREATE TRIGGER reject_success_event BEFORE INSERT ON run_events
        WHEN NEW.kind = 'run-status' AND NEW.payload_json LIKE '%succeeded%' BEGIN SELECT RAISE(ABORT, 'terminal event failed'); END`);
      const run = service.start({ projectId, tabId: tabA.id, idempotencyKey: "terminal-event-fail", arguments: { a: 1 } });
      const live: unknown[] = []; const unsubscribe = service.eventBus.subscribe(run.id, (event) => live.push(event.payload));
      const detail = await terminal(service, run.id);
      unsubscribe();
      expect(detail.status).toBe("failed");
      expect(detail.response?.error?.code).toBe("TRACE_PERSIST_FAILED");
      expect(detail.response?.result).toEqual({ content: [{ type: "text", text: "sum" }] });
      expect(detail.events.some(({ payload }) => JSON.stringify(payload).includes("succeeded"))).toBe(false);
      expect(detail.events.at(-1)?.payload).toEqual({ status: "failed" });
      expect(live).toContainEqual({ status: "failed" });
    } finally { projects.close(); }
  });

  it("falls back to failed when cancellation cannot atomically record its terminal event", async () => {
    const late = deferred<CallToolResult>();
    const { projects, connections, service, tabA } = fixture(async () => late.promise);
    try {
      await connections.connect(projectId, connectionId);
      const run = service.start({ projectId, tabId: tabA.id, idempotencyKey: "cancel-event-fail", arguments: { a: 1 } });
      await vi.waitFor(() => expect(service.get(projectId, run.id).status).toBe("running"));
      projects.open(projectId).database.exec(`CREATE TRIGGER reject_cancel_event BEFORE INSERT ON run_events
        WHEN NEW.kind = 'run-status' AND NEW.payload_json LIKE '%cancelled%' BEGIN SELECT RAISE(ABORT, 'terminal event failed'); END`);
      const live: unknown[] = []; const unsubscribe = service.eventBus.subscribe(run.id, (event) => live.push(event.payload));
      expect(service.cancel(projectId, run.id)).toBe(true); unsubscribe();
      const detail = service.get(projectId, run.id);
      expect(detail.status).toBe("failed");
      expect(detail.response?.error?.code).toBe("TRACE_PERSIST_FAILED");
      expect(detail.events.some(({ payload }) => JSON.stringify(payload).includes("cancelled"))).toBe(false);
      expect(detail.events.at(-1)?.payload).toEqual({ status: "failed" });
      expect(live).toContainEqual({ status: "failed" });
      late.resolve({ content: [{ type: "text", text: "late" }] });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(service.get(projectId, run.id).status).toBe("failed");
    } finally { projects.close(); }
  });

  it("publishes a synthetic failed event when terminal events remain unavailable", async () => {
    const result = deferred<CallToolResult>();
    let lateObserver: ((event: WireObservation) => void) | undefined;
    const { projects, connections, service, tabA } = fixture(async ({ observe }) => {
      lateObserver = observe as typeof lateObserver;
      return result.promise;
    });
    try {
      await connections.connect(projectId, connectionId);
      const run = service.start({ projectId, tabId: tabA.id, idempotencyKey: "persistent-event-fail", arguments: { a: 1 } });
      await vi.waitFor(() => expect(service.get(projectId, run.id).status).toBe("running"));
      projects.open(projectId).database.exec(`CREATE TRIGGER reject_every_terminal_event BEFORE INSERT ON run_events
        WHEN NEW.kind = 'run-status' BEGIN SELECT RAISE(ABORT, 'event store unavailable'); END`);
      const live: RunEvent[] = [];
      const unsubscribe = service.eventBus.subscribe(run.id, (event) => live.push(event));
      result.resolve({ content: [{ type: "text", text: "completed" }] });
      const detail = await terminal(service, run.id);
      expect(detail.status).toBe("failed");
      expect(detail.response?.error?.code).toBe("TRACE_PERSIST_FAILED");
      expect(detail.events.at(-1)?.payload).toEqual({ status: "running" });
      expect(live.at(-1)?.payload).toEqual({ status: "failed", synthetic: true, code: "TRACE_PERSIST_FAILED" });
      const synthetic = live.at(-1)!; const persistedLast = detail.events.at(-1)!;
      expect(synthetic.sequence).toBe(persistedLast.sequence + 1);
      const persistedCount = detail.events.length; const liveCount = live.length;
      projects.open(projectId).database.exec("DROP TRIGGER reject_every_terminal_event");
      lateObserver?.({ kind: "rpc-in", at: "2026-08-17T00:00:09.000Z", message: { late: true } });
      const direct = new RunRepository(projects.open(projectId), service.eventBus).append(
        run.id, "rpc-in", "2026-08-17T00:00:10.000Z", { late: "direct" });
      expect(direct).toBeNull();
      expect(service.get(projectId, run.id).events).toHaveLength(persistedCount);
      expect(service.events(projectId, run.id, persistedLast.sequence)).toEqual([]);
      expect(live).toHaveLength(liveCount);
      unsubscribe();
    } finally { projects.close(); }
  });

  it("stores a bounded UTF-8-safe descriptor for oversized Tool results", async () => {
    const result = { isError: true, content: [{ type: "text" as const, text: `前缀-${"x".repeat(500)}-结尾` }] };
    const base = fixture(async () => result);
    const service = createRunService(base.projects, base.connections, base.tabs, {
      createId: (() => { let next = 900; return () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`; })(),
      ...({ maxResponseBytes: 100 } as {}),
    });
    try {
      await base.connections.connect(projectId, connectionId);
      const run = service.start({ projectId, tabId: base.tabA.id, idempotencyKey: "large-result", arguments: { a: 1 } });
      const detail = await terminal(service, run.id);
      expect(detail.status).toBe("failed");
      expect(detail.response?.truncated).toBe(true);
      expect(detail.response?.originalBytes).toBe(new TextEncoder().encode(JSON.stringify(result)).byteLength);
      expect(detail.response?.result).toMatchObject({ truncated: true, originalBytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(detail.response?.result).toMatchObject({ isError: true });
      expect(() => JSON.stringify(detail.response?.result)).not.toThrow();
    } finally { base.projects.close(); }
  });

  it("stores a response exactly at the byte limit without truncating it", async () => {
    const result = { content: [{ type: "text" as const, text: "边界" }] };
    const maxResponseBytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
    const base = fixture(async () => result);
    const service = createRunService(base.projects, base.connections, base.tabs, {
      createId: () => "00000000-0000-4000-8000-000000000998", maxResponseBytes,
    });
    try {
      await base.connections.connect(projectId, connectionId);
      const run = service.start({ projectId, tabId: base.tabA.id, idempotencyKey: "exact-limit", arguments: { a: 1 } });
      const detail = await terminal(service, run.id);
      expect(detail.response?.truncated).toBe(false);
      expect(detail.response?.originalBytes).toBe(maxResponseBytes);
      expect(detail.response?.result).toEqual(result);
    } finally { base.projects.close(); }
  });

  it("selects the tools/call HTTP exchange when extra stream traffic is observed", async () => {
    const { projects, connections, service, tabA } = fixture(async ({ observe }) => {
      observe?.({ kind: "http-request", exchangeId: "stream", at: "2026-08-17T00:00:00.000Z", method: "GET", url: "https://example.test/sse", headers: {}, body: null });
      observe?.({ kind: "http-request", exchangeId: "call", at: "2026-08-17T00:00:01.000Z", method: "POST", url: "https://example.test/mcp", headers: {},
        body: { jsonrpc: "2.0", method: "tools/call" } });
      observe?.({ kind: "http-response", exchangeId: "stream", at: "2026-08-17T00:00:01.010Z", status: 200, headers: {}, body: { stream: true } });
      observe?.({ kind: "rpc-in", at: "2026-08-17T00:00:01.020Z", message: { method: "notifications/progress" } });
      observe?.({ kind: "http-response", exchangeId: "call", at: "2026-08-17T00:00:01.040Z", status: 200, headers: {}, body: {} });
      return { content: [{ type: "text", text: "ok" }] };
    });
    try {
      await connections.connect(projectId, connectionId);
      const run = service.start({ projectId, tabId: tabA.id, idempotencyKey: "timing", arguments: { a: 1 } });
      const detail = await terminal(service, run.id);
      expect(detail.networkDurationMs).toBe(40);
      expect(detail.request.http).toMatchObject({ body: { method: "tools/call" } });
    } finally { projects.close(); }
  });

  it("publishes only committed events, paginates stably, rejects foreign cursors, and decodes defensively", () => {
    const { projects, service, tabA } = fixture();
    try {
      let observedCommitted = false;
      const unsubscribe = service.eventBus.subscribe("00000000-0000-4000-8000-000000000713", (event) => {
        const row = projects.open(projectId).database.prepare("SELECT sequence FROM run_events WHERE run_id = ? AND sequence = ?")
          .get(event.runId, event.sequence);
        observedCommitted = row !== undefined;
      });
      const runs = Array.from({ length: 51 }, (_, index) => {
        const run = service.start({ projectId, tabId: tabA.id, idempotencyKey: `page-${index}`, arguments: { a: index } });
        service.cancel(projectId, run.id); return run;
      });
      unsubscribe();
      expect(observedCommitted).toBe(true);
      const first = service.list(projectId);
      expect(first.runs).toHaveLength(50); expect(first.nextCursor).not.toBeNull();
      const second = service.list(projectId, first.nextCursor!);
      expect(second.runs).toHaveLength(1);
      expect(new Set([...first.runs, ...second.runs].map(({ id }) => id)).size).toBe(51);
      const decoded = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString("utf8"));
      decoded.projectId = "00000000-0000-4000-8000-000000000799";
      expect(() => service.list(projectId, Buffer.from(JSON.stringify(decoded)).toString("base64url"))).toThrow(/cursor/i);
      for (const mutation of [{ createdAt: "2026-08-17" }, { id: "not-a-uuid" }]) {
        const malformed = { ...JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString("utf8")), ...mutation };
        expect(() => service.list(projectId, Buffer.from(JSON.stringify(malformed)).toString("base64url"))).toThrow(/cursor/i);
      }
      projects.open(projectId).database.prepare("UPDATE run_requests SET arguments_json = 'not-json' WHERE run_id = ?").run(runs[0].id);
      expect(() => service.get(projectId, runs[0].id)).toThrow(/corrupt/i);
      expect(projects.open(projectId).database.prepare("SELECT version FROM schema_migrations ORDER BY version").all())
        .toEqual([1, 2, 3, 4, 5, 6].map((version) => ({ version })));
      const store = projects.open(projectId); const snapshotId = store.database.prepare("SELECT id FROM tool_snapshots LIMIT 1").get() as { id: string };
      const insert = store.database.prepare(`INSERT INTO runs
        (id, project_id, connection_id, tab_id, tool_name, tool_snapshot_id, idempotency_key, status, created_at, client_info_json)
        VALUES (?, ?, ?, ?, 'sum', ?, ?, 'queued', '2026-08-17T00:00:00.000Z', '{}')`);
      const bad = "00000000-0000-4000-8000-000000000799";
      for (const [index, values] of [
        [bad, connectionId, tabA.id, snapshotId.id], [projectId, bad, tabA.id, snapshotId.id],
        [projectId, connectionId, bad, snapshotId.id], [projectId, connectionId, tabA.id, bad],
      ].entries()) {
        expect(() => insert.run(`00000000-0000-4000-8000-${String(970 + index).padStart(12, "0")}`,
          values[0], values[1], values[2], values[3], `fk-${index}`)).toThrow(/foreign key/i);
      }
    } finally { projects.close(); }
  });

  it("paginates current-Tab history independently and binds its cursor to that Tab", () => {
    const { projects, service, tabA, tabB } = fixture();
    try {
      for (let index = 0; index < 52; index += 1) {
        const tab = index % 2 === 0 ? tabA : tabB;
        const run = service.start({ projectId, tabId: tab.id, idempotencyKey: `tab-page-${index}`, arguments: { a: index } });
        service.cancel(projectId, run.id);
      }
      const first = service.list(projectId, undefined, { tabId: tabA.id });
      expect(first.runs).toHaveLength(26); expect(first.runs.every(({ tabId }) => tabId === tabA.id)).toBe(true);
      expect(first.nextCursor).toBeNull();
      projects.open(projectId).database.prepare(`UPDATE runs SET tool_name = 'previous_sum'
        WHERE id = (SELECT id FROM runs WHERE tab_id = ? ORDER BY created_at DESC, id DESC LIMIT 1)`).run(tabA.id);
      const currentTool = service.list(projectId, undefined, { tabId: tabA.id, connectionId, toolName: "sum" });
      expect(currentTool.runs).toHaveLength(25);
      expect(currentTool.runs.every((run) => run.tabId === tabA.id && run.connectionId === connectionId && run.toolName === "sum")).toBe(true);
      expect(() => service.list(projectId, undefined, { tabId: "00000000-0000-4000-8000-000000000799" })).toThrow(/Tab not found/i);
      const repository = new RunRepository(projects.open(projectId), service.eventBus);
      const small = repository.list(projectId, undefined, 10, { tabId: tabA.id, connectionId, toolName: "sum" });
      expect(small.runs).toHaveLength(10); expect(small.nextCursor).not.toBeNull();
      expect(repository.list(projectId, small.nextCursor!, 10, { tabId: tabA.id, connectionId, toolName: "sum" }).runs).toHaveLength(10);
      expect(() => repository.list(projectId, small.nextCursor!, 10, { tabId: tabA.id, connectionId, toolName: "previous_sum" })).toThrow(/cursor/i);
      expect(() => repository.list(projectId, small.nextCursor!, 10, { tabId: tabB.id, connectionId, toolName: "sum" })).toThrow(/cursor/i);
    } finally { projects.close(); }
  });
});
