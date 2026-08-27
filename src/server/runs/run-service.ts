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

function isToolsCallRequest(observation: WireObservation): observation is Extract<WireObservation, { kind: "http-request" }> {
  if (observation.kind !== "http-request" || typeof observation.body !== "object" ||
      observation.body === null || Array.isArray(observation.body)) return false;
  return (observation.body as Record<string, unknown>).method === "tools/call";
}

function redactObservationPayload(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const observation = value as Record<string, unknown>;
  if ((observation.kind !== "http-request" && observation.kind !== "http-response") ||
      typeof observation.headers !== "object" || observation.headers === null || Array.isArray(observation.headers)) return value;
  return redactWireObservation(value as WireObservation);
}

function visibleRun(run: RunDetail, redactSensitiveInfo: boolean): RunDetail {
  if (!redactSensitiveInfo) return { ...run, redactSensitiveInfo: false };
  return {
    ...run,
    redactSensitiveInfo: true,
    request: { ...run.request, http: redactObservationPayload(run.request.http) },
    events: run.events.map((event) => ({ ...event, payload: redactObservationPayload(event.payload) })),
  };
}

export interface RunServiceWithEvents extends RunService {
  readonly eventBus: RunEventBus;
  assertExists(projectId: string, runId: string): RunSummary;
  startInvocation(input: {
    projectId: string;
    connectionId: string;
    toolName: string;
    idempotencyKey: string;
    arguments: Record<string, unknown>;
  }): RunSummary;
  waitForTerminal(projectId: string, runId: string, signal?: AbortSignal): Promise<RunDetail>;
  close(): Promise<void>;
}

interface ActiveRun {
  controller: AbortController;
  observationsClosed: boolean;
}

export function createRunService(projects: ProjectService, connections: ConnectionService, tabs: TabService,
  options: { createId?: () => string; now?: () => Date; eventBus?: RunEventBus; clientInfo?: Record<string, unknown>;
    maxResponseBytes?: number } = {},
): RunServiceWithEvents {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const eventBus = options.eventBus ?? new RunEventBus();
  const clientInfo = options.clientInfo ?? { name: "mcp-inspector", version: "0.1.0" };
  const activeRuns = new Map<string, ActiveRun>();
  const executions = new Set<Promise<void>>();
  const repository = (projectId: string) => new RunRepository(projects.open(projectId), eventBus,
    { maxResponseBytes: options.maxResponseBytes });
  const key = (projectId: string, runId: string) => `${projectId}:${runId}`;
  const timestamp = () => now().toISOString();

  function appendStatus(projectId: string, runId: string, status: string, at: string): void {
    repository(projectId).append(runId, "run-status", at, { status });
  }

  function finishSafely(repo: RunRepository, projectId: string, runId: string,
    status: "succeeded" | "failed" | "cancelled", at: string, durationMs: number,
    networkDurationMs: number | null, response: { result?: unknown; error?: { code: string; message: string } }): boolean {
    try { return repo.finish(projectId, runId, status, at, durationMs, networkDurationMs, response) !== null; }
    catch { return repo.failRecording(projectId, runId, at, durationMs, networkDurationMs, response.result); }
  }

  async function execute(projectId: string, runId: string): Promise<void> {
    const controllerKey = key(projectId, runId);
    const activeRun = activeRuns.get(controllerKey);
    if (activeRun === undefined) return;
    const { controller } = activeRun;
    const repo = repository(projectId);
    let traceFailure = false;
    let requestAt: string | null = null;
    let requestExchangeId: string | null = null;
    let fallbackRequestAt: string | null = null;
    let fallbackExchangeId: string | null = null;
    let networkDurationMs: number | null = null;
    let fallbackNetworkDurationMs: number | null = null;
    let redactSensitiveInfo = true;
    const observe = (observation: WireObservation) => {
      if (activeRun.observationsClosed || traceFailure) return;
      try {
        const recordedObservation = redactSensitiveInfo ? redactWireObservation(observation) : observation;
        repo.append(runId, recordedObservation.kind, recordedObservation.at, recordedObservation);
        if (recordedObservation.kind === "http-request" && fallbackRequestAt === null) {
          fallbackRequestAt = recordedObservation.at;
          fallbackExchangeId = recordedObservation.exchangeId ?? null;
          repo.recordHttpRequest(runId, recordedObservation);
        }
        if (isToolsCallRequest(recordedObservation) && requestAt === null) {
          requestAt = recordedObservation.at;
          requestExchangeId = recordedObservation.exchangeId ?? null;
          repo.recordHttpRequest(runId, recordedObservation, true);
        }
        if (recordedObservation.kind === "http-response") {
          const matchesCall = requestExchangeId === null || recordedObservation.exchangeId === requestExchangeId;
          const matchesFallback = fallbackExchangeId === null || recordedObservation.exchangeId === fallbackExchangeId;
          if (requestAt !== null && matchesCall && networkDurationMs === null) networkDurationMs = elapsed(requestAt, recordedObservation.at);
          else if (requestAt === null && fallbackRequestAt !== null && matchesFallback && fallbackNetworkDurationMs === null) {
            fallbackNetworkDurationMs = elapsed(fallbackRequestAt, recordedObservation.at);
          }
        }
      } catch { traceFailure = true; }
    };
    try {
      let run = repo.get(projectId, runId);
      if (run === null || terminal.has(run.status)) return;
      redactSensitiveInfo = connections.get(projectId, run.connectionId).redactSensitiveInfo;
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
      activeRun.observationsClosed = true;
      const completedAt = timestamp();
      const latest = repo.get(projectId, runId);
      if (latest === null || terminal.has(latest.status)) return;
      const failed = traceFailure || result.isError === true;
      networkDurationMs ??= fallbackNetworkDurationMs;
      const response = traceFailure
        ? { result, error: { code: "TRACE_PERSIST_FAILED", message: "Run recording failed" } }
        : { result };
      finishSafely(repo, projectId, runId, failed ? "failed" : "succeeded", completedAt,
        elapsed(latest.createdAt, completedAt), networkDurationMs, response);
    } catch (error) {
      activeRun.observationsClosed = true;
      const latest = repo.get(projectId, runId);
      if (latest !== null && !terminal.has(latest.status)) {
        networkDurationMs ??= fallbackNetworkDurationMs;
        const completedAt = timestamp();
        const cancellation = controller.signal.aborted || error instanceof CallCancelledError;
        const status = cancellation ? "cancelled" : "failed";
        const normalized = cancellation ? { code: "CALL_CANCELLED", message: "MCP Tool call was cancelled" } : safeError(error);
        finishSafely(repo, projectId, runId, status, completedAt, elapsed(latest.createdAt, completedAt), networkDurationMs,
          { error: normalized });
      }
    } finally {
      activeRun.observationsClosed = true;
      if (activeRuns.get(controllerKey) === activeRun) activeRuns.delete(controllerKey);
    }
  }

  function requireRun(projectId: string, runId: string): RunDetail {
    if (!uuid.safeParse(runId).success) throw new RunNotFoundError();
    const run = repository(projectId).get(projectId, runId);
    if (run === null) throw new RunNotFoundError();
    return visibleRun(run, connections.get(projectId, run.connectionId).redactSensitiveInfo);
  }

  function requireSummary(projectId: string, runId: string): RunSummary {
    if (!uuid.safeParse(runId).success) throw new RunNotFoundError();
    const run = repository(projectId).getSummary(projectId, runId);
    if (run === null) throw new RunNotFoundError();
    return run;
  }

  function createAndSchedule(input: {
    projectId: string;
    connectionId: string;
    tabId: string | null;
    toolName: string;
    idempotencyKey: string;
    arguments: Record<string, unknown>;
  }): RunSummary {
    if (!uuid.safeParse(input.projectId).success ||
        (input.tabId !== null && !uuid.safeParse(input.tabId).success) ||
        !uuid.safeParse(input.connectionId).success ||
        typeof input.toolName !== "string" || input.toolName.trim() === "" || input.toolName.length > 512 ||
        typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 1 || input.idempotencyKey.length > 200 ||
        typeof input.arguments !== "object" || input.arguments === null || Array.isArray(input.arguments)) {
      throw new InvalidRunError();
    }
    connections.get(input.projectId, input.connectionId);
    const tool = new ToolRepository(projects.open(input.projectId)).get(
      input.projectId,
      input.connectionId,
      input.toolName,
    );
    if (tool === null || tool.tool.status === "removed") throw new InvalidRunError("Tool is not available");
    const canonicalArguments = canonicalJson(input.arguments);
    const issues = validateArguments(tool.tool.currentSnapshot.definition.inputSchema, input.arguments);
    if (issues.length > 0) throw new RunValidationError(issues);
    const id = createId();
    if (!uuid.safeParse(id).success) throw new Error("Run ID generator returned an invalid UUID");
    const createdAt = timestamp();
    const result = repository(input.projectId).create({
      id,
      projectId: input.projectId,
      connectionId: input.connectionId,
      tabId: input.tabId,
      toolName: input.toolName,
      toolSnapshotId: tool.tool.currentSnapshot.id,
      idempotencyKey: input.idempotencyKey,
      canonicalArguments,
      jsonrpc: {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: input.toolName, arguments: input.arguments },
      },
      clientInfo,
      createdAt,
    });
    if (!result.created) {
      if (result.identity.tabId !== input.tabId ||
          result.identity.toolSnapshotId !== tool.tool.currentSnapshot.id ||
          result.identity.canonicalArguments !== canonicalArguments) {
        throw new RunIdempotencyConflictError();
      }
      return result.run;
    }
    activeRuns.set(key(input.projectId, id), { controller: new AbortController(), observationsClosed: false });
    queueMicrotask(() => {
      const operation = execute(input.projectId, id).catch(() => undefined);
      executions.add(operation);
      void operation.finally(() => executions.delete(operation));
    });
    return result.run;
  }

  function cancelRun(projectId: string, runId: string): boolean {
    const run = requireRun(projectId, runId);
    if (terminal.has(run.status)) return false;
    const activeRun = activeRuns.get(key(projectId, runId));
    if (activeRun !== undefined) activeRun.observationsClosed = true;
    const completedAt = timestamp();
    const changed = finishSafely(repository(projectId), projectId, runId, "cancelled", completedAt,
      elapsed(run.createdAt, completedAt), run.networkDurationMs, { error: { code: "CALL_CANCELLED", message: "MCP Tool call was cancelled" } });
    if (!changed) return false;
    if (activeRun !== undefined) {
      activeRuns.delete(key(projectId, runId));
      activeRun.controller.abort();
    }
    return true;
  }

  return {
    eventBus,
    assertExists: requireSummary,
    start(input: StartRunInput): RunSummary {
      const tab = tabs.get(input.projectId, input.tabId);
      if (input.connectionId !== undefined && tab.connectionId !== input.connectionId) {
        throw new InvalidRunError("Run Tab belongs to a different connection");
      }
      return createAndSchedule({
        projectId: input.projectId,
        connectionId: tab.connectionId,
        tabId: tab.id,
        toolName: tab.toolName,
        idempotencyKey: input.idempotencyKey,
        arguments: input.arguments,
      });
    },
    startInvocation(input) {
      return createAndSchedule({ ...input, tabId: null });
    },
    async waitForTerminal(projectId, runId, signal) {
      const current = requireRun(projectId, runId);
      if (terminal.has(current.status)) return current;
      return await new Promise<RunDetail>((resolve, reject) => {
        let finished = false;
        const cleanup = () => {
          unsubscribe();
          signal?.removeEventListener("abort", aborted);
        };
        const complete = () => {
          if (finished) return;
          finished = true;
          cleanup();
          resolve(requireRun(projectId, runId));
        };
        const aborted = () => {
          if (finished) return;
          finished = true;
          cleanup();
          cancelRun(projectId, runId);
          reject(new DOMException("Run wait was aborted", "AbortError"));
        };
        const unsubscribe = eventBus.subscribe(runId, (event) => {
          if (event.kind === "run-status" &&
              terminal.has((event.payload as { status?: string }).status ?? "")) complete();
        });
        signal?.addEventListener("abort", aborted, { once: true });
        if (signal?.aborted) aborted();
        else if (terminal.has(requireSummary(projectId, runId).status)) complete();
      });
    },
    cancel: cancelRun,
    list(projectId, cursor, filter = {}) {
      projects.open(projectId);
      if (filter.tabId !== undefined) tabs.get(projectId, filter.tabId);
      try { return repository(projectId).list(projectId, cursor, 50, filter); }
      catch (error) {
        if (error instanceof Error && error.message === "Run cursor is invalid") throw new InvalidRunCursorError();
        throw error;
      }
    },
    getSummary: requireSummary,
    get: requireRun,
    events(projectId, runId, after = 0, limit): RunEvent[] {
      const run = requireSummary(projectId, runId);
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000)) throw new InvalidRunError();
      const redactSensitiveInfo = connections.get(projectId, run.connectionId).redactSensitiveInfo;
      return repository(projectId).events(runId, after, limit).map((event) => ({
        ...event,
        payload: redactSensitiveInfo ? redactObservationPayload(event.payload) : event.payload,
      }));
    },
    async close() {
      for (const activeRun of activeRuns.values()) {
        activeRun.observationsClosed = true;
        activeRun.controller.abort();
      }
      await Promise.allSettled([...executions]);
      activeRuns.clear();
    },
  };
}
