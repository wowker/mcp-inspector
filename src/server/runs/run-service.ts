import { randomUUID } from "node:crypto";
import { z } from "zod";
import { validateArguments, type SchemaIssue } from "../../shared/json-schema.js";
import type { ConnectionService } from "../connections/connection-service.js";
import { CallCancelledError, CallTimeoutError, McpConnectError, type WireObservation } from "../connections/connection-runtime.js";
import { redactWireObservation } from "../connections/observed-fetch.js";
import type { ProjectService } from "../projects/project-service.js";
import type { TabService } from "../tabs/tab-service.js";
import { ToolRepository } from "../tools/tool-repository.js";
import { RunEventBus } from "./run-event-bus.js";
import { RunRepository } from "./run-repository.js";
import type { RunDetail, RunEvent, RunPage, RunService, RunSummary, StartRunInput } from "./run-types.js";

const uuid = z.string().uuid();
const terminal = new Set(["succeeded", "failed", "cancelled", "interrupted"]);

export class RunNotFoundError extends Error { constructor() { super("Run not found"); this.name = "RunNotFoundError"; } }
export class InvalidRunError extends Error { constructor(message = "Run payload is invalid") { super(message); this.name = "InvalidRunError"; } }
export class RunIdempotencyConflictError extends Error { constructor() { super("Run idempotency conflict"); this.name = "RunIdempotencyConflictError"; } }
export class InvalidRunCursorError extends Error { constructor() { super("Run cursor is invalid"); this.name = "InvalidRunCursorError"; } }
export class RunValidationError extends Error {
  constructor(readonly issues: SchemaIssue[]) { super("Run arguments are invalid"); this.name = "RunValidationError"; }
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InvalidRunError();
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || ancestors.has(value)) throw new InvalidRunError();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) throw new InvalidRunError();
      return `[${value.map((item) => canonicalJson(item, ancestors)).join(",")}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new InvalidRunError();
    if (Object.getOwnPropertySymbols(value).length > 0) throw new InvalidRunError();
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key], ancestors)}`).join(",")}}`;
  } finally { ancestors.delete(value); }
}

function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof CallTimeoutError) return { code: "CALL_TIMEOUT", message: "MCP Tool call timed out" };
  if (error instanceof McpConnectError) return { code: "MCP_CONNECT_FAILED", message: "Unable to connect to MCP server" };
  if (error instanceof CallCancelledError || (error instanceof DOMException && error.name === "AbortError")) {
    return { code: "CALL_CANCELLED", message: "MCP Tool call was cancelled" };
  }
  return { code: "MCP_CALL_FAILED", message: "MCP Tool call failed" };
}

function elapsed(from: string, to: string): number {
  const value = Date.parse(to) - Date.parse(from);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export interface RunServiceWithEvents extends RunService {
  readonly eventBus: RunEventBus;
}

export function createRunService(projects: ProjectService, connections: ConnectionService, tabs: TabService,
  options: { createId?: () => string; now?: () => Date; eventBus?: RunEventBus; clientInfo?: Record<string, unknown> } = {},
): RunServiceWithEvents {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const eventBus = options.eventBus ?? new RunEventBus();
  const clientInfo = options.clientInfo ?? { name: "dsers-mcp-inspector", version: "0.1.0" };
  const controllers = new Map<string, AbortController>();
  const repository = (projectId: string) => new RunRepository(projects.open(projectId), eventBus);
  const key = (projectId: string, runId: string) => `${projectId}:${runId}`;
  const timestamp = () => now().toISOString();

  function appendStatus(projectId: string, runId: string, status: string, at: string): void {
    repository(projectId).append(runId, "run-status", at, { status });
  }

  async function execute(projectId: string, runId: string): Promise<void> {
    const controllerKey = key(projectId, runId);
    const controller = controllers.get(controllerKey);
    if (controller === undefined) return;
    const repo = repository(projectId);
    let traceFailure = false;
    let requestAt: string | null = null;
    let networkDurationMs: number | null = null;
    const observe = (observation: WireObservation) => {
      if (traceFailure) return;
      try {
        const safeObservation = redactWireObservation(observation);
        repo.append(runId, safeObservation.kind, safeObservation.at, safeObservation);
        if (safeObservation.kind === "http-request" && requestAt === null) {
          requestAt = safeObservation.at;
          repo.recordHttpRequest(runId, safeObservation);
        }
        if (safeObservation.kind === "http-response" && requestAt !== null && networkDurationMs === null) {
          networkDurationMs = elapsed(requestAt, safeObservation.at);
        }
      } catch { traceFailure = true; }
    };
    try {
      let run = repo.get(projectId, runId);
      if (run === null || terminal.has(run.status)) return;
      const runtime = connections.runtime(projectId);
      if (runtime.get(run.connectionId) === undefined) {
        const at = timestamp();
        if (!repo.transition(projectId, runId, ["queued"], "connecting", at)) return;
        appendStatus(projectId, runId, "connecting", at);
        await runtime.connect(run.connectionId);
      }
      run = repo.get(projectId, runId);
      if (run === null || terminal.has(run.status) || controller.signal.aborted) return;
      const session = runtime.get(run.connectionId);
      if (session === undefined) throw new Error("connection unavailable");
      const runningAt = timestamp();
      if (!repo.transition(projectId, runId, ["queued", "connecting"], "running", runningAt, {
        protocolVersion: session.protocolVersion, serverInfo: session.serverInfo,
      })) return;
      appendStatus(projectId, runId, "running", runningAt);
      const result = await runtime.callTool(run.connectionId, {
        name: run.toolName, arguments: run.request.arguments, signal: controller.signal, observe,
      });
      const completedAt = timestamp();
      const latest = repo.get(projectId, runId);
      if (latest === null || terminal.has(latest.status)) return;
      const failed = traceFailure || result.isError === true;
      const response = traceFailure
        ? { error: { code: "TRACE_PERSIST_FAILED", message: "Tool call completed but trace persistence failed" } }
        : { result };
      if (repo.finish(projectId, runId, failed ? "failed" : "succeeded", completedAt,
        elapsed(latest.createdAt, completedAt), networkDurationMs, response)) {
        try { appendStatus(projectId, runId, failed ? "failed" : "succeeded", completedAt); } catch { /* terminal state is authoritative */ }
      }
    } catch (error) {
      const latest = repo.get(projectId, runId);
      if (latest !== null && !terminal.has(latest.status)) {
        const completedAt = timestamp();
        const cancellation = controller.signal.aborted || error instanceof CallCancelledError;
        const status = cancellation ? "cancelled" : "failed";
        const normalized = cancellation ? { code: "CALL_CANCELLED", message: "MCP Tool call was cancelled" } : safeError(error);
        if (repo.finish(projectId, runId, status, completedAt, elapsed(latest.createdAt, completedAt), networkDurationMs,
          { error: normalized })) {
          try { appendStatus(projectId, runId, status, completedAt); } catch { /* terminal state is authoritative */ }
        }
      }
    } finally {
      controllers.delete(controllerKey);
    }
  }

  function requireRun(projectId: string, runId: string): RunDetail {
    if (!uuid.safeParse(runId).success) throw new RunNotFoundError();
    const run = repository(projectId).get(projectId, runId);
    if (run === null) throw new RunNotFoundError();
    return run;
  }

  return {
    eventBus,
    start(input: StartRunInput): RunSummary {
      if (!uuid.safeParse(input.projectId).success || !uuid.safeParse(input.tabId).success ||
          typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 1 || input.idempotencyKey.length > 200 ||
          typeof input.arguments !== "object" || input.arguments === null || Array.isArray(input.arguments)) throw new InvalidRunError();
      const tab = tabs.get(input.projectId, input.tabId);
      const tool = new ToolRepository(projects.open(input.projectId)).get(input.projectId, tab.connectionId, tab.toolName);
      if (tool === null || tool.tool.status === "removed") throw new InvalidRunError("Tool is not available");
      const canonicalArguments = canonicalJson(input.arguments);
      const issues = validateArguments(tool.tool.currentSnapshot.definition.inputSchema, input.arguments);
      if (issues.length > 0) throw new RunValidationError(issues);
      const id = createId(); if (!uuid.safeParse(id).success) throw new Error("Run ID generator returned an invalid UUID");
      const createdAt = timestamp();
      const result = repository(input.projectId).create({ id, projectId: input.projectId, connectionId: tab.connectionId,
        tabId: tab.id, toolName: tab.toolName, toolSnapshotId: tool.tool.currentSnapshot.id,
        idempotencyKey: input.idempotencyKey, canonicalArguments,
        jsonrpc: { jsonrpc: "2.0", id, method: "tools/call", params: { name: tab.toolName, arguments: input.arguments } },
        clientInfo, createdAt });
      if (!result.created) {
        if (result.identity.tabId !== tab.id || result.identity.toolSnapshotId !== tool.tool.currentSnapshot.id ||
            result.identity.canonicalArguments !== canonicalArguments) throw new RunIdempotencyConflictError();
        return result.run;
      }
      controllers.set(key(input.projectId, id), new AbortController());
      queueMicrotask(() => { void execute(input.projectId, id).catch(() => undefined); });
      return result.run;
    },
    cancel(projectId, runId) {
      const run = requireRun(projectId, runId);
      if (terminal.has(run.status)) return false;
      const completedAt = timestamp();
      const changed = repository(projectId).finish(projectId, runId, "cancelled", completedAt,
        elapsed(run.createdAt, completedAt), run.networkDurationMs, { error: { code: "CALL_CANCELLED", message: "MCP Tool call was cancelled" } });
      if (!changed) return false;
      const controller = controllers.get(key(projectId, runId));
      controllers.delete(key(projectId, runId)); controller?.abort();
      try { appendStatus(projectId, runId, "cancelled", completedAt); } catch { /* terminal state is authoritative */ }
      return true;
    },
    list(projectId, cursor) {
      projects.open(projectId);
      try { return repository(projectId).list(projectId, cursor); }
      catch (error) {
        if (error instanceof Error && error.message === "Run cursor is invalid") throw new InvalidRunCursorError();
        throw error;
      }
    },
    get: requireRun,
    events(projectId, runId, after = 0): RunEvent[] { requireRun(projectId, runId); return repository(projectId).events(runId, after); },
  };
}
