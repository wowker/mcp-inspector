import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  pressureTestSamplePageSchema,
  startPressureTestExecutionRequestSchema,
  type PressureTestExecution,
  type PressureTestExecutionPage,
  type PressureTestSamplePage,
  type PressureTestSampleStatus,
} from "../../shared/testing/pressure-test.js";
import { shouldStopForErrorRate, summarizePressureSamples } from "../../shared/testing/pressure-test-metrics.js";
import { canonicalJson } from "../tools/tool-service.js";
import { ToolRepository } from "../tools/tool-repository.js";
import type { ProjectService } from "../projects/project-service.js";
import type { TestCaseService } from "./test-case-service.js";
import type { TestExecutionService } from "./test-execution-service.js";
import type { PressureTestService } from "./pressure-test-service.js";
import { PressureTestExecutionRepository } from "./pressure-test-execution-repository.js";
import { runPressureLoad, waitForPressureDelay } from "./pressure-test-runner.js";

const terminal = new Set(["PASSED", "FAILED", "ERROR", "CANCELLED", "INTERRUPTED"]);
const startSchema = z.object({
  projectId: z.uuid(),
  pressureTestId: z.uuid(),
  idempotencyKey: z.string().min(1).max(200),
  request: startPressureTestExecutionRequestSchema,
}).strict();

export class InvalidPressureTestExecutionError extends Error {
  constructor(message = "Pressure test execution payload is invalid") { super(message); this.name = "InvalidPressureTestExecutionError"; }
}
export class PressureTestExecutionNotFoundError extends Error {
  constructor() { super("Pressure test execution not found"); this.name = "PressureTestExecutionNotFoundError"; }
}
export class PressureTestExecutionConflictError extends Error {
  constructor() { super("Pressure test execution idempotency conflict"); this.name = "PressureTestExecutionConflictError"; }
}
export class PressureTestAlreadyRunningError extends Error {
  constructor() { super("A pressure test is already running in this project"); this.name = "PressureTestAlreadyRunningError"; }
}
export class PressureTestDestructiveConfirmationRequiredError extends Error {
  constructor() { super("Destructive Tool confirmation is required for pressure testing"); this.name = "PressureTestDestructiveConfirmationRequiredError"; }
}
export class PressureTestTargetNotAvailableError extends Error {
  constructor() { super("Pressure test target is not available"); this.name = "PressureTestTargetNotAvailableError"; }
}

interface ActivePressureExecution {
  controller: AbortController;
  reason: "running" | "user" | "threshold" | "closing";
}

export interface PressureTestExecutionService {
  start(input: unknown): PressureTestExecution;
  get(projectId: string, executionId: string): PressureTestExecution;
  list(projectId: string, input?: { pressureTestId?: string; cursor?: string; limit?: number }): PressureTestExecutionPage;
  samples(projectId: string, executionId: string, input?: { cursor?: string; limit?: number }): PressureTestSamplePage;
  waitForTerminal(projectId: string, executionId: string, signal?: AbortSignal): Promise<PressureTestExecution>;
  cancel(projectId: string, executionId: string): boolean;
  close(): Promise<void>;
}

function elapsed(from: string, to: string): number {
  const value = Date.parse(to) - Date.parse(from);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function sampleStatus(status: string): PressureTestSampleStatus {
  if (status === "PASSED" || status === "FAILED" || status === "CANCELLED") return status;
  return "ERROR";
}

export function createPressureTestExecutionService(deps: {
  projects: ProjectService;
  pressureTests: PressureTestService;
  testCases: TestCaseService;
  testExecutions: TestExecutionService;
  inspectTarget?: (projectId: string, connectionId: string, toolName: string) => {
    status: "current" | "removed";
    destructive: boolean;
  } | null;
  createId?: () => string;
  now?: () => Date;
}): PressureTestExecutionService {
  const createId = deps.createId ?? randomUUID;
  const now = deps.now ?? (() => new Date());
  const active = new Map<string, ActivePressureExecution>();
  const operations = new Map<string, Promise<void>>();
  const recoveredProjects = new Set<string>();
  const key = (projectId: string, executionId: string) => `${projectId}:${executionId}`;
  const timestamp = () => now().toISOString();
  const generatedId = (label: string) => {
    const id = createId();
    if (!z.uuid().safeParse(id).success) throw new Error(`${label} ID generator returned an invalid UUID`);
    return id;
  };
  const repository = (projectId: string) => {
    const repo = new PressureTestExecutionRepository(deps.projects.open(projectId));
    if (!recoveredProjects.has(projectId)) {
      repo.interruptActive(projectId, timestamp());
      recoveredProjects.add(projectId);
    }
    return repo;
  };
  const inspectTarget = deps.inspectTarget ?? ((projectId: string, connectionId: string, toolName: string) => {
    const value = new ToolRepository(deps.projects.open(projectId)).get(projectId, connectionId, toolName);
    return value === null ? null : {
      status: value.tool.status,
      destructive: value.tool.currentSnapshot.definition.annotations?.destructiveHint === true,
    };
  });

  const get = (projectId: string, executionId: string): PressureTestExecution => {
    if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(executionId).success) {
      throw new PressureTestExecutionNotFoundError();
    }
    const value = repository(projectId).get(projectId, executionId);
    if (value === null) throw new PressureTestExecutionNotFoundError();
    return value;
  };

  function decodeCursor(value: string | undefined, expected: Record<string, string | undefined>): {
    createdAt: string;
    id: string;
  } | undefined {
    if (value === undefined) return undefined;
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
      for (const [name, expectedValue] of Object.entries(expected)) if (parsed[name] !== expectedValue) throw new Error();
      if (typeof parsed.createdAt !== "string" || !z.string().datetime({ offset: true }).safeParse(parsed.createdAt).success ||
          typeof parsed.id !== "string" || !z.uuid().safeParse(parsed.id).success) throw new Error();
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch { throw new InvalidPressureTestExecutionError("Pressure test execution cursor is invalid"); }
  }

  const encodeCursor = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

  async function execute(projectId: string, executionId: string, confirmDestructive: boolean): Promise<void> {
    const state = active.get(key(projectId, executionId));
    if (state === undefined) return;
    const repo = repository(projectId);
    const initial = get(projectId, executionId);
    if (!repo.begin(projectId, executionId, timestamp())) {
      if (active.get(key(projectId, executionId)) === state) active.delete(key(projectId, executionId));
      return;
    }
    let completedSamples = 0;
    let failedOrErrored = 0;
    try {
      await runPressureLoad({ load: initial.definitionSnapshot.load, signal: state.controller.signal }, {
        now: () => now().getTime(),
        wait: (milliseconds, signal) => waitForPressureDelay(milliseconds, signal),
        execute: async (virtualUser, iteration) => {
          const started = deps.testExecutions.start({
            projectId,
            testCaseId: initial.targetSnapshot.id,
            idempotencyKey: `${executionId}:${iteration}`,
            confirmDestructive,
            inputs: initial.definitionSnapshot.inputs,
          });
          const completed = await deps.testExecutions.waitForTerminal(projectId, started.id, state.controller.signal);
          const completedAt = completed.completedAt ?? timestamp();
          const startedAt = completed.startedAt ?? completed.createdAt;
          const sample = pressureTestSamplePageSchema.shape.items.element.parse({
            id: generatedId("Pressure test sample"),
            projectId,
            pressureTestExecutionId: executionId,
            testExecutionId: completed.id,
            virtualUser,
            iteration,
            status: sampleStatus(completed.status),
            startedAt,
            completedAt,
            durationMs: completed.durationMs ?? elapsed(startedAt, completedAt),
            error: completed.error,
          });
          repo.appendSample(sample);
          completedSamples += 1;
          if (sample.status === "FAILED" || sample.status === "ERROR") failedOrErrored += 1;
          if (shouldStopForErrorRate({
            sampleCount: completedSamples,
            failedOrErrored,
            thresholds: initial.definitionSnapshot.thresholds,
          })) {
            state.reason = "threshold";
            state.controller.abort();
          }
          return { status: sample.status, durationMs: sample.durationMs };
        },
      });
      const completedAt = timestamp();
      if (state.reason === "user" || state.reason === "closing") {
        repo.cancel(projectId, executionId, completedAt, elapsed(initial.createdAt, completedAt));
        return;
      }
      const summary = summarizePressureSamples({
        samples: repo.allSamples(projectId, executionId),
        elapsedMs: elapsed(initial.startedAt ?? initial.createdAt, completedAt),
        thresholds: initial.definitionSnapshot.thresholds,
      });
      repo.complete(projectId, executionId, {
        status: summary.thresholds.every(({ passed }) => passed) ? "PASSED" : "FAILED",
        summary,
        error: state.reason === "threshold"
          ? { code: "ERROR_RATE_CIRCUIT_OPEN", message: "Pressure test stopped after exceeding the error-rate threshold" }
          : null,
        completedAt,
        durationMs: elapsed(initial.createdAt, completedAt),
      });
    } catch {
      const completedAt = timestamp();
      if (state.controller.signal.aborted) {
        repo.cancel(projectId, executionId, completedAt, elapsed(initial.createdAt, completedAt));
      } else {
        repo.complete(projectId, executionId, {
          status: "ERROR",
          summary: null,
          error: { code: "PRESSURE_TEST_EXECUTION_FAILED", message: "Pressure test execution failed" },
          completedAt,
          durationMs: elapsed(initial.createdAt, completedAt),
        });
      }
    } finally {
      if (active.get(key(projectId, executionId)) === state) active.delete(key(projectId, executionId));
    }
  }

  return {
    start(raw) {
      const parsed = startSchema.safeParse(raw);
      if (!parsed.success) throw new InvalidPressureTestExecutionError();
      const { projectId, pressureTestId, idempotencyKey, request } = parsed.data;
      const definition = deps.pressureTests.get(projectId, pressureTestId);
      const target = deps.testCases.get(projectId, definition.target.testCaseId);
      if (!target.isEnabled) throw new PressureTestTargetNotAvailableError();
      const targets = target.kind === "tool" ? [target.target]
        : [...target.steps, ...target.cleanupSteps].map(({ target: value }) => value);
      for (const item of targets) {
        const tool = inspectTarget(projectId, item.connectionId, item.toolName);
        if (tool === null || tool.status === "removed") throw new PressureTestTargetNotAvailableError();
        if (tool.destructive && request.confirmDestructive !== true) {
          throw new PressureTestDestructiveConfirmationRequiredError();
        }
      }
      const repo = repository(projectId);
      const requestHash = createHash("sha256").update(canonicalJson({
        pressureTestId,
        revision: definition.revision,
        confirmDestructive: request.confirmDestructive === true,
      })).digest("hex");
      const prior = repo.getByIdempotencyKey(projectId, idempotencyKey);
      if (prior !== null) {
        const storedHash = deps.projects.open(projectId).database.prepare(
          "SELECT request_hash FROM pressure_test_executions WHERE project_id = ? AND id = ?",
        ).get(projectId, prior.id) as { request_hash: string };
        if (storedHash.request_hash !== requestHash) throw new PressureTestExecutionConflictError();
        return prior;
      }
      if (repo.hasActive(projectId)) throw new PressureTestAlreadyRunningError();
      let execution: PressureTestExecution;
      try {
        execution = repo.insert({
          id: generatedId("Pressure test execution"), projectId, definition,
          targetSnapshot: { id: target.id, name: target.name, kind: target.kind, revision: target.revision },
          idempotencyKey, requestHash, createdAt: timestamp(),
        });
      } catch (error) {
        if (repo.hasActive(projectId)) throw new PressureTestAlreadyRunningError();
        throw error;
      }
      const state: ActivePressureExecution = { controller: new AbortController(), reason: "running" };
      active.set(key(projectId, execution.id), state);
      const operation = Promise.resolve().then(() => execute(
        projectId, execution.id, request.confirmDestructive === true,
      )).catch(() => undefined);
      operations.set(key(projectId, execution.id), operation);
      void operation.finally(() => {
        if (operations.get(key(projectId, execution.id)) === operation) operations.delete(key(projectId, execution.id));
      });
      return execution;
    },
    get,
    list(rawProjectId, input = {}) {
      const parsed = z.object({ projectId: z.uuid(), pressureTestId: z.uuid().optional(),
        cursor: z.string().min(1).optional(), limit: z.number().int().min(1).max(100).default(50) })
        .strict().safeParse({ projectId: rawProjectId, ...input });
      if (!parsed.success) throw new InvalidPressureTestExecutionError();
      const cursor = decodeCursor(parsed.data.cursor, {
        projectId: parsed.data.projectId, pressureTestId: parsed.data.pressureTestId,
      });
      const page = repository(parsed.data.projectId).list(
        parsed.data.projectId, parsed.data.pressureTestId, parsed.data.limit, cursor,
      );
      return { items: page.items, nextCursor: page.next === null ? null : encodeCursor({
        projectId: parsed.data.projectId, pressureTestId: parsed.data.pressureTestId, ...page.next,
      }) };
    },
    samples(rawProjectId, rawExecutionId, input = {}) {
      const parsed = z.object({ projectId: z.uuid(), executionId: z.uuid(), cursor: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).default(50) }).strict()
        .safeParse({ projectId: rawProjectId, executionId: rawExecutionId, ...input });
      if (!parsed.success) throw new InvalidPressureTestExecutionError();
      get(parsed.data.projectId, parsed.data.executionId);
      let afterIteration = 0;
      if (parsed.data.cursor !== undefined) {
        try {
          const cursor = JSON.parse(Buffer.from(parsed.data.cursor, "base64url").toString("utf8")) as Record<string, unknown>;
          if (cursor.projectId !== parsed.data.projectId || cursor.executionId !== parsed.data.executionId ||
              !Number.isInteger(cursor.iteration) || (cursor.iteration as number) < 1) throw new Error();
          afterIteration = cursor.iteration as number;
        } catch { throw new InvalidPressureTestExecutionError("Pressure test sample cursor is invalid"); }
      }
      const page = repository(parsed.data.projectId).listSamples(
        parsed.data.projectId, parsed.data.executionId, parsed.data.limit, afterIteration,
      );
      return pressureTestSamplePageSchema.parse({ items: page.items, nextCursor: page.nextIteration === null ? null
        : encodeCursor({ projectId: parsed.data.projectId, executionId: parsed.data.executionId,
          iteration: page.nextIteration }) });
    },
    async waitForTerminal(projectId, executionId, signal) {
      const current = get(projectId, executionId);
      if (terminal.has(current.status)) return current;
      const operation = operations.get(key(projectId, executionId));
      if (operation === undefined) return get(projectId, executionId);
      if (signal?.aborted) {
        this.cancel(projectId, executionId);
        throw new DOMException("Pressure test wait was aborted", "AbortError");
      }
      let abortListener: (() => void) | undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        abortListener = () => {
          this.cancel(projectId, executionId);
          reject(new DOMException("Pressure test wait was aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abortListener, { once: true });
      });
      try { await (signal === undefined ? operation : Promise.race([operation, aborted])); }
      finally { if (abortListener !== undefined) signal?.removeEventListener("abort", abortListener); }
      return get(projectId, executionId);
    },
    cancel(projectId, executionId) {
      const current = get(projectId, executionId);
      if (terminal.has(current.status)) return false;
      const completedAt = timestamp();
      const changed = repository(projectId).cancel(projectId, executionId, completedAt,
        elapsed(current.createdAt, completedAt));
      const state = active.get(key(projectId, executionId));
      if (changed && state !== undefined) { state.reason = "user"; state.controller.abort(); }
      return changed;
    },
    async close() {
      for (const state of active.values()) { state.reason = "closing"; state.controller.abort(); }
      await Promise.allSettled(operations.values());
      active.clear();
      operations.clear();
    },
  };
}
