import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { FakeMcpSession } from "../../../../test-support/fake-mcp-session.js";
import { createConnectionService } from "../../connections/connection-service.js";
import { CallTimeoutError } from "../../connections/connection-runtime.js";
import { createProjectService } from "../../projects/project-service.js";
import { createTabService } from "../../tabs/tab-service.js";
import { ToolRepository } from "../../tools/tool-repository.js";
import { createToolService } from "../../tools/tool-service.js";
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
    return { projects, connections, session, tabs, tabA, tabB, service };
  }

  async function terminal(service: ReturnType<typeof createRunService>, id: string) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const run = service.get(projectId, id);
      if (["succeeded", "failed", "cancelled"].includes(run.status)) return run;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error("Run did not finish");
  }

  it("is idempotent only for the same Tab, snapshot, and canonical arguments", () => {
    const { projects, service, tabA, tabB } = fixture();
    try {
      const first = service.start({ projectId, tabId: tabA.id, idempotencyKey: "submit-a", arguments: { a: 1, b: 2 } });
      const duplicate = service.start({ projectId, tabId: tabA.id, idempotencyKey: "submit-a", arguments: { b: 2, a: 1 } });
      expect(duplicate.id).toBe(first.id);
      expect(() => service.start({ projectId, tabId: tabA.id, idempotencyKey: "submit-a", arguments: { a: 3, b: 2 } }))
        .toThrow(RunIdempotencyConflictError);
      expect(() => service.start({ projectId, tabId: tabB.id, idempotencyKey: "submit-a", arguments: { a: 99 } }))
        .toThrow(RunIdempotencyConflictError);
      expect(service.cancel(projectId, first.id)).toBe(true);
    } finally { projects.close(); }
  });

  it("schedules exactly one execution for duplicate submissions", async () => {
    const { projects, connections, session, service, tabA } = fixture();
    try {
      await connections.connect(projectId, connectionId);
      const first = service.start({ projectId, tabId: tabA.id, idempotencyKey: "one-execution", arguments: { a: 1 } });
      const duplicate = service.start({ projectId, tabId: tabA.id, idempotencyKey: "one-execution", arguments: { a: 1 } });
      expect(duplicate.id).toBe(first.id);
      await terminal(service, first.id);
      expect(session.calls).toHaveLength(1);
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
    const { projects, connections, service, tabA } = fixture(async () => ++call === 1 ? late.promise : ({ isError: true, content: [{ type: "text", text: "bad input" }] }));
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
      expect(detail.response?.error).toEqual({ code: "TRACE_PERSIST_FAILED", message: "Tool call completed but trace persistence failed" });
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
      projects.open(projectId).database.prepare("UPDATE run_requests SET arguments_json = 'not-json' WHERE run_id = ?").run(runs[0].id);
      expect(() => service.get(projectId, runs[0].id)).toThrow(/corrupt/i);
      expect(projects.open(projectId).database.prepare("SELECT version FROM schema_migrations ORDER BY version").all())
        .toEqual([1, 2, 3, 4, 5].map((version) => ({ version })));
    } finally { projects.close(); }
  });
});
