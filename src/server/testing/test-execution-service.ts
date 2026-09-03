import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { evaluateAssertion, type AssertionContext } from "../../shared/testing/assertion-engine.js";
import type { AssertionResult } from "../../shared/testing/assertions.js";
import {
  updateTestExecutionBaselineRequestSchema,
  type TestExecutionDetail,
  type TestExecutionReportPage,
  type UpdateTestExecutionBaselineResult,
} from "../../shared/testing/test-execution.js";
import { jsonObjectSchema, jsonValueSchema, type JsonObject, type JsonValue } from "../../shared/tool-definition.js";
import type { ConnectionService } from "../connections/connection-service.js";
import type { EnvironmentService } from "../environment/environment-service.js";
import type { ProjectService } from "../projects/project-service.js";
import { RunValidationError, type RunServiceWithEvents } from "../runs/run-service.js";
import type { RunDetail } from "../runs/run-types.js";
import { ToolRepository } from "../tools/tool-repository.js";
import { canonicalJson } from "../tools/tool-service.js";
import type { WorkflowExecutionDetail } from "../workflows/workflow-execution-repository.js";
import type { WorkflowExecutionService } from "../workflows/workflow-execution-service.js";
import type { WorkflowService } from "../workflows/workflow-service.js";
import type { TestCaseService } from "./test-case-service.js";
import { TestExecutionRepository, type TestExecutionCursorPosition } from "./test-execution-repository.js";
import { runScenario, ScenarioRunnerError, type ScenarioInvocationResult } from "./scenario-runner.js";

const startSchema = z.object({
  projectId: z.uuid(),
  testCaseId: z.uuid(),
  idempotencyKey: z.string().min(1).max(200),
  confirmDestructive: z.boolean().optional(),
  inputs: jsonObjectSchema.optional(),
}).strict();
const terminal = new Set(["PASSED", "FAILED", "ERROR", "CANCELLED", "INTERRUPTED"]);

export class InvalidTestExecutionError extends Error {
  constructor(message = "Test execution payload is invalid") { super(message); this.name = "InvalidTestExecutionError"; }
}
export class TestExecutionNotFoundError extends Error {
  constructor() { super("Test execution not found"); this.name = "TestExecutionNotFoundError"; }
}
export class TestExecutionConflictError extends Error {
  constructor() { super("Test execution idempotency conflict"); this.name = "TestExecutionConflictError"; }
}
export class TestExecutionTargetError extends Error {
  constructor() { super("Test execution target is not available"); this.name = "TestExecutionTargetError"; }
}
export class DestructiveConfirmationRequiredError extends Error {
  constructor() { super("Destructive Tool confirmation is required"); this.name = "DestructiveConfirmationRequiredError"; }
}

export interface TestExecutionService {
  start(input: unknown): TestExecutionDetail;
  get(projectId: string, executionId: string): TestExecutionDetail;
  list(projectId: string, input?: { testCaseId?: string; cursor?: string; limit?: number }): TestExecutionReportPage;
  updateBaseline(projectId: string, executionId: string, input: unknown): UpdateTestExecutionBaselineResult;
  waitForTerminal(projectId: string, executionId: string, signal?: AbortSignal): Promise<TestExecutionDetail>;
  cancel(projectId: string, executionId: string): boolean;
  close(): Promise<void>;
}

interface ActiveExecution { controller: AbortController; timedOut: boolean; timer: ReturnType<typeof setTimeout> | null }

function asJson(value: unknown): JsonValue | undefined {
  const parsed = jsonValueSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function assertionSources(run: RunDetail, workflow: WorkflowExecutionDetail | null): AssertionContext {
  const runSource = asJson({
    status: run.status,
    durationMs: run.durationMs,
    networkDurationMs: run.networkDurationMs,
    toolName: run.toolName,
    toolSnapshotId: run.toolSnapshotId,
  });
  const http = asJson({
    request: run.request.http,
    events: run.events.filter(({ kind }) => kind === "http-request" || kind === "http-response").map(({ payload }) => payload),
  });
  const workflowSource = workflow === null ? undefined : asJson({
    status: workflow.status,
    durationMs: workflow.durationMs,
    finalArguments: workflow.finalArguments,
    response: workflow.response,
    error: workflow.error,
  });
  return {
    sources: {
      ...(runSource === undefined ? {} : { RUN: runSource }),
      ...(asJson(run.response?.result) === undefined ? {} : { MCP_RESULT: asJson(run.response?.result)! }),
      ...(asJson(run.response?.error) === undefined ? {} : { MCP_ERROR: asJson(run.response?.error)! }),
      ...(http === undefined ? {} : { HTTP: http }),
      ...(workflowSource === undefined ? {} : { WORKFLOW: workflowSource }),
    },
    ...(run.redactSensitiveInfo === true ? { redactedSources: new Set(["HTTP"] as const) } : {}),
  };
}

function boundedResult(result: AssertionResult): AssertionResult {
  const bounded = (value: JsonValue | undefined): JsonValue | undefined => {
    if (value === undefined) return undefined;
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= 32_768 ? value : undefined;
  };
  const actual = bounded(result.actual);
  const expected = bounded(result.expected);
  return {
    ...result,
    ...(actual === undefined ? { actual: undefined } : { actual }),
    ...(expected === undefined ? { expected: undefined } : { expected }),
  };
}

function elapsed(from: string, to: string): number {
  const value = Date.parse(to) - Date.parse(from);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function createTestExecutionService(deps: {
  projects: ProjectService;
  connections: ConnectionService;
  testCases: TestCaseService;
  runs: RunServiceWithEvents;
  workflows: WorkflowService;
  workflowExecutions: WorkflowExecutionService;
  environment: EnvironmentService;
  createId?: () => string;
  now?: () => Date;
}): TestExecutionService {
  const createId = deps.createId ?? randomUUID;
  const now = deps.now ?? (() => new Date());
  const active = new Map<string, ActiveExecution>();
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
    const repo = new TestExecutionRepository(deps.projects.open(projectId));
    if (!recoveredProjects.has(projectId)) {
      repo.interruptActive(projectId, timestamp());
      recoveredProjects.add(projectId);
    }
    return repo;
  };

  const get = (projectId: string, executionId: string): TestExecutionDetail => {
    if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(executionId).success) {
      throw new TestExecutionNotFoundError();
    }
    const execution = repository(projectId).get(projectId, executionId);
    if (execution === null) throw new TestExecutionNotFoundError();
    return execution;
  };

  const decodeCursor = (value: string | undefined, projectId: string,
    testCaseId: string | undefined): TestExecutionCursorPosition | null => {
    if (value === undefined) return null;
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
        projectId?: unknown; testCaseId?: unknown; createdAt?: unknown; id?: unknown;
      };
      if (parsed.projectId !== projectId || parsed.testCaseId !== testCaseId || typeof parsed.createdAt !== "string" ||
          !z.string().datetime({ offset: true }).safeParse(parsed.createdAt).success ||
          typeof parsed.id !== "string" || !z.uuid().safeParse(parsed.id).success) throw new Error();
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch { throw new InvalidTestExecutionError("Test execution cursor is invalid"); }
  };

  const encodeCursor = (projectId: string, testCaseId: string | undefined,
    position: TestExecutionCursorPosition): string =>
    Buffer.from(JSON.stringify({ projectId, ...(testCaseId === undefined ? {} : { testCaseId }), ...position }), "utf8")
      .toString("base64url");

  const baselineOperators = new Set(["EQUALS", "DEEP_EQUALS"]);

  function updateBaseline(projectId: string, executionId: string, value: unknown): UpdateTestExecutionBaselineResult {
    const parsed = updateTestExecutionBaselineRequestSchema.safeParse(value);
    if (!parsed.success) throw new InvalidTestExecutionError("Baseline update requires explicit confirmation");
    const execution = get(projectId, executionId);
    if (!terminal.has(execution.status)) throw new InvalidTestExecutionError("Test execution is not complete");
    const candidates = new Map(execution.assertions.flatMap((result) =>
      result.actual !== undefined && !result.isRedacted && result.status !== "ERROR" &&
      baselineOperators.has(result.definition.operator)
        ? [[result.assertionId, result.actual] as const] : []));
    if (candidates.size === 0) throw new InvalidTestExecutionError("Test execution has no baseline-compatible assertion values");
    const current = deps.testCases.get(projectId, execution.testCaseId);
    let updatedAssertions = 0;
    const updateAssertions = <T extends { id: string; expected?: JsonValue }>(assertions: T[]): T[] => assertions.map((assertion) => {
      const actual = candidates.get(assertion.id);
      if (actual === undefined) return assertion;
      updatedAssertions += 1;
      return { ...assertion, expected: actual };
    });
    const definition = current.kind === "tool"
      ? { kind: current.kind, name: current.name, description: current.description, tags: current.tags,
        isEnabled: current.isEnabled, target: current.target, arguments: current.arguments,
        assertions: updateAssertions(current.assertions), timeoutMs: current.timeoutMs }
      : { kind: current.kind, name: current.name, description: current.description, tags: current.tags,
        isEnabled: current.isEnabled, inputs: current.inputs,
        steps: current.steps.map((step) => ({ ...step, assertions: updateAssertions(step.assertions) })),
        cleanupSteps: current.cleanupSteps.map((step) => ({ ...step, assertions: updateAssertions(step.assertions) })),
        assertions: updateAssertions(current.assertions), failurePolicy: current.failurePolicy };
    if (updatedAssertions === 0) throw new InvalidTestExecutionError("Matching assertions no longer exist in the current definition");
    return { testCase: deps.testCases.update(projectId, current.id, {
      revision: parsed.data.revision, definition,
    }), updatedAssertions };
  }

  async function invokeScenarioTarget(input: {
    projectId: string; executionId: string; connectionId: string; toolName: string;
    argumentsValue: JsonObject; stepId: string; attempt: number; signal?: AbortSignal;
  }): Promise<ScenarioInvocationResult> {
    let invocation: { run: RunDetail; workflow: WorkflowExecutionDetail | null };
    try {
      const workflowConfig = deps.workflows.get(input.projectId, input.connectionId, input.toolName);
      const usesWorkflow = workflowConfig.before.enabled || workflowConfig.after.enabled;
      const idempotencyKey = `${input.executionId}:${input.stepId}:${input.attempt}`;
      if (usesWorkflow) {
        const started = deps.workflowExecutions.startInvocation({
          projectId: input.projectId, connectionId: input.connectionId, toolName: input.toolName,
          idempotencyKey: `${idempotencyKey}:workflow`, arguments: input.argumentsValue,
        });
        const completed = await deps.workflowExecutions.waitForTerminal(input.projectId, started.id, input.signal);
        const main = completed.runs.find(({ phase }) => phase === "main");
        if (main === undefined) throw new InvalidTestExecutionError("Workflow did not invoke the main Tool");
        invocation = { run: deps.runs.get(input.projectId, main.runId), workflow: completed };
      } else {
        const started = deps.runs.startInvocation({
          projectId: input.projectId, connectionId: input.connectionId, toolName: input.toolName,
          idempotencyKey: `${idempotencyKey}:run`, arguments: input.argumentsValue,
        });
        invocation = {
          run: await deps.runs.waitForTerminal(input.projectId, started.id, input.signal), workflow: null,
        };
      }
    } catch (error) {
      if (error instanceof RunValidationError) {
        const details = error.issues.map(({ path, message }) => `${path || "/"} ${message}`).join("; ");
        throw new ScenarioRunnerError("INVALID_ARGUMENTS", `Tool arguments are invalid: ${details}`.slice(0, 2_000));
      }
      throw error;
    }
    const workflowInfrastructureFailed = invocation.workflow !== null && invocation.workflow.status !== "succeeded" && !(
      invocation.workflow.error?.code === "WORKFLOW_FAILED" && invocation.run.response?.result !== null &&
      invocation.run.response?.result !== undefined
    );
    const context = assertionSources(invocation.run, invocation.workflow);
    const invocationError = workflowInfrastructureFailed
      ? invocation.workflow?.error ?? { code: "WORKFLOW_EXECUTION_FAILED", message: "Workflow execution failed" }
      : invocation.run.status === "succeeded"
        ? undefined
        : invocation.run.response?.error ?? { code: "TOOL_EXECUTION_FAILED", message: "Tool execution failed" };
    return {
      sources: context.sources,
      redactedSources: context.redactedSources,
      runId: invocation.run.id,
      workflowExecutionId: invocation.workflow?.id ?? null,
      succeeded: !workflowInfrastructureFailed && invocation.run.status === "succeeded",
      ...(invocationError === undefined ? {} : { error: invocationError }),
    };
  }

  async function executeScenario(projectId: string, executionId: string, initial: TestExecutionDetail): Promise<void> {
    const activeExecution = active.get(key(projectId, executionId));
    if (activeExecution === undefined || initial.definitionSnapshot.kind !== "scenario") return;
    const repo = repository(projectId);
    if (!repo.beginExecution(projectId, executionId, timestamp())) return;
    try {
      const result = await runScenario({
        definition: initial.definitionSnapshot, inputs: initial.inputs, signal: activeExecution.controller.signal,
      }, {
        invoke: (invocation) => invokeScenarioTarget({ projectId, executionId, ...invocation }),
        wait: (milliseconds, signal) => new Promise<void>((resolve, reject) => {
          if (signal?.aborted) { reject(new DOMException("Scenario wait was aborted", "AbortError")); return; }
          const complete = () => { signal?.removeEventListener("abort", abort); resolve(); };
          const timer = setTimeout(complete, milliseconds);
          const abort = () => {
            clearTimeout(timer); signal?.removeEventListener("abort", abort);
            reject(new DOMException("Scenario wait was aborted", "AbortError"));
          };
          signal?.addEventListener("abort", abort, { once: true });
        }),
        resolveEnvironment: async (scope, connectionId, name) => {
          const resolved = deps.environment.resolve(projectId, connectionId);
          return scope === "PROJECT" ? resolved.project[name] : resolved.server[name];
        },
        createId: () => generatedId("Assertion result"),
        now: () => now().getTime(),
      });
      const completedAt = timestamp();
      if (result.status === "CANCELLED" || (activeExecution.controller.signal.aborted && !activeExecution.timedOut)) {
        repo.cancel(projectId, executionId, completedAt, elapsed(initial.createdAt, completedAt));
        return;
      }
      repo.completeScenario(projectId, executionId, {
        status: result.status,
        completedAt,
        durationMs: elapsed(initial.createdAt, completedAt),
        error: activeExecution.timedOut ? { code: "TEST_TIMEOUT", message: "Test execution timed out" } : result.error,
        steps: result.steps.map((step) => ({
          id: generatedId("Test execution step"), ...step,
          assertions: step.assertions.map(boundedResult),
        })),
        assertions: result.assertions.map(boundedResult),
      });
    } catch {
      const completedAt = timestamp();
      if (activeExecution.controller.signal.aborted && !activeExecution.timedOut) {
        repo.cancel(projectId, executionId, completedAt, elapsed(initial.createdAt, completedAt));
      } else {
        repo.completeScenario(projectId, executionId, {
          status: "ERROR", completedAt, durationMs: elapsed(initial.createdAt, completedAt),
          error: activeExecution.timedOut
            ? { code: "TEST_TIMEOUT", message: "Test execution timed out" }
            : { code: "TEST_EXECUTION_FAILED", message: "Test execution failed" },
          steps: [], assertions: [],
        });
      }
    }
  }

  async function execute(projectId: string, executionId: string, stepRecordId: string): Promise<void> {
    const activeExecution = active.get(key(projectId, executionId));
    if (activeExecution === undefined) return;
    const initial = get(projectId, executionId);
    const testCase = initial.definitionSnapshot;
    if (testCase.kind === "scenario") {
      try { await executeScenario(projectId, executionId, initial); }
      finally {
        if (activeExecution.timer !== null) clearTimeout(activeExecution.timer);
        if (active.get(key(projectId, executionId)) === activeExecution) active.delete(key(projectId, executionId));
      }
      return;
    }
    try {
      if (!repository(projectId).begin(projectId, executionId, stepRecordId, timestamp(), testCase.arguments)) return;
      const workflowConfig = deps.workflows.get(projectId, testCase.target.connectionId, testCase.target.toolName);
      const usesWorkflow = workflowConfig.before.enabled || workflowConfig.after.enabled;
      let linkedWorkflowId: string | null = null;
      let invocation: { run: RunDetail; workflow: WorkflowExecutionDetail | null };
      if (usesWorkflow) {
        const started = deps.workflowExecutions.startInvocation({
          projectId, connectionId: testCase.target.connectionId, toolName: testCase.target.toolName,
          idempotencyKey: `${executionId}:workflow`, arguments: testCase.arguments,
        });
        linkedWorkflowId = started.id;
        repository(projectId).linkInvocation(projectId, executionId, stepRecordId, {
          runId: null, workflowExecutionId: started.id,
        });
        const completed = await deps.workflowExecutions.waitForTerminal(projectId, started.id, activeExecution.controller.signal);
        const main = completed.runs.find(({ phase }) => phase === "main");
        if (main === undefined) throw new InvalidTestExecutionError(completed.error?.message ?? "Workflow did not invoke the main Tool");
        invocation = { run: deps.runs.get(projectId, main.runId), workflow: completed };
      } else {
        const started = deps.runs.startInvocation({
          projectId, connectionId: testCase.target.connectionId, toolName: testCase.target.toolName,
          idempotencyKey: `${executionId}:run`, arguments: testCase.arguments,
        });
        repository(projectId).linkInvocation(projectId, executionId, stepRecordId, {
          runId: started.id, workflowExecutionId: null,
        });
        invocation = { run: await deps.runs.waitForTerminal(projectId, started.id, activeExecution.controller.signal), workflow: null };
      }
      if (linkedWorkflowId !== null) {
        repository(projectId).linkInvocation(projectId, executionId, stepRecordId, {
          runId: invocation.run.id, workflowExecutionId: linkedWorkflowId,
        });
      }
      const workflowInfrastructureFailed = invocation.workflow !== null && invocation.workflow.status !== "succeeded" && !(
        invocation.workflow.error?.code === "WORKFLOW_FAILED" && invocation.run.response?.result !== null &&
        invocation.run.response?.result !== undefined
      );
      if (workflowInfrastructureFailed) {
        throw new InvalidTestExecutionError(invocation.workflow?.error?.message ?? "Workflow execution failed");
      }
      const hasBusinessResult = invocation.run.response?.result !== null && invocation.run.response?.result !== undefined;
      if (!hasBusinessResult && invocation.run.status !== "succeeded") {
        throw new InvalidTestExecutionError(invocation.run.response?.error?.message ?? "Tool execution failed");
      }
      const context = assertionSources(invocation.run, invocation.workflow);
      const results = testCase.assertions.map((assertion) => boundedResult(evaluateAssertion(assertion, context, {
        createId: () => generatedId("Assertion result"),
      })));
      const hasError = results.some(({ status }) => status === "ERROR");
      const hasFailure = results.some(({ status }) => status === "FAILED");
      const businessFailureWithoutAssertion = invocation.run.status !== "succeeded" && results.length === 0;
      const status = hasError ? "ERROR" : hasFailure || businessFailureWithoutAssertion ? "FAILED" : "PASSED";
      const completedAt = timestamp();
      repository(projectId).complete(projectId, executionId, stepRecordId, {
        status,
        stepStatus: status,
        completedAt,
        durationMs: elapsed(initial.createdAt, completedAt),
        error: hasError ? { code: "ASSERTION_EVALUATION_ERROR", message: "One or more assertions could not be evaluated" } : null,
        assertions: results,
      });
    } catch (error) {
      const completedAt = timestamp();
      if (activeExecution.controller.signal.aborted && !activeExecution.timedOut) {
        repository(projectId).cancel(projectId, executionId, completedAt, elapsed(initial.createdAt, completedAt));
      } else {
        const failure = activeExecution.timedOut
          ? { code: "TEST_TIMEOUT", message: "Test execution timed out" }
          : { code: "TEST_EXECUTION_FAILED", message: "Test execution failed" };
        repository(projectId).complete(projectId, executionId, stepRecordId, {
          status: "ERROR", stepStatus: "ERROR", completedAt,
          durationMs: elapsed(initial.createdAt, completedAt), error: failure, assertions: [],
        });
      }
    } finally {
      if (activeExecution.timer !== null) clearTimeout(activeExecution.timer);
      if (active.get(key(projectId, executionId)) === activeExecution) active.delete(key(projectId, executionId));
    }
  }

  function schedule(projectId: string, executionId: string, stepRecordId: string, timeoutMs: number): void {
    const controller = new AbortController();
    const state: ActiveExecution = { controller, timedOut: false, timer: null };
    state.timer = setTimeout(() => { state.timedOut = true; controller.abort(); }, timeoutMs);
    state.timer.unref?.();
    const operationKey = key(projectId, executionId);
    active.set(operationKey, state);
    const operation = Promise.resolve().then(() => execute(projectId, executionId, stepRecordId)).catch(() => undefined);
    operations.set(operationKey, operation);
    void operation.finally(() => { if (operations.get(operationKey) === operation) operations.delete(operationKey); });
  }

  return {
    list(rawProjectId, input = {}) {
      const parsedProjectId = z.uuid().safeParse(rawProjectId);
      const parsedInput = z.object({ testCaseId: z.uuid().optional(), cursor: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).default(50) })
        .strict().safeParse(input);
      if (!parsedProjectId.success || !parsedInput.success) throw new InvalidTestExecutionError();
      const page = repository(parsedProjectId.data).list(parsedProjectId.data, parsedInput.data.limit,
        decodeCursor(parsedInput.data.cursor, parsedProjectId.data, parsedInput.data.testCaseId), parsedInput.data.testCaseId);
      return { items: page.items,
        nextCursor: page.next === null ? null : encodeCursor(parsedProjectId.data, parsedInput.data.testCaseId, page.next) };
    },
    updateBaseline,
    start(raw) {
      const parsed = startSchema.safeParse(raw);
      if (!parsed.success) throw new InvalidTestExecutionError();
      const input = parsed.data;
      const definition = deps.testCases.get(input.projectId, input.testCaseId);
      if (!definition.isEnabled) throw new InvalidTestExecutionError();
      const targets = definition.kind === "tool"
        ? [definition.target]
        : [...definition.steps, ...definition.cleanupSteps].map(({ target }) => target);
      for (const target of targets) {
        deps.connections.get(input.projectId, target.connectionId);
        const tool = new ToolRepository(deps.projects.open(input.projectId)).get(
          input.projectId, target.connectionId, target.toolName,
        );
        if (tool === null || tool.tool.status === "removed") throw new TestExecutionTargetError();
        if (tool.tool.currentSnapshot.definition.annotations?.destructiveHint === true && input.confirmDestructive !== true) {
          throw new DestructiveConfirmationRequiredError();
        }
      }
      const executionInputs = definition.kind === "scenario" ? input.inputs ?? {} : {};
      const requestHash = createHash("sha256").update(canonicalJson({
        testCaseId: definition.id, revision: definition.revision,
        confirmDestructive: input.confirmDestructive === true,
        inputs: executionInputs,
      })).digest("hex");
      const executionId = generatedId("Test execution");
      const result = repository(input.projectId).create({
        id: executionId, projectId: input.projectId, testCase: definition,
        idempotencyKey: input.idempotencyKey, requestHash, inputs: executionInputs, createdAt: timestamp(),
      });
      if (result.requestHash !== requestHash) throw new TestExecutionConflictError();
      const timeoutMs = definition.kind === "tool" ? definition.timeoutMs : 3_600_000;
      if (result.created) schedule(input.projectId, executionId, generatedId("Test execution step"), timeoutMs);
      return result.execution;
    },
    get,
    async waitForTerminal(projectId, executionId, signal) {
      const current = get(projectId, executionId);
      if (terminal.has(current.status)) return current;
      const operation = operations.get(key(projectId, executionId));
      if (operation === undefined) return get(projectId, executionId);
      if (signal?.aborted) {
        this.cancel(projectId, executionId);
        throw new DOMException("Test execution wait was aborted", "AbortError");
      }
      let aborted: (() => void) | undefined;
      const abort = new Promise<never>((_resolve, reject) => {
        aborted = () => {
          this.cancel(projectId, executionId);
          reject(new DOMException("Test execution wait was aborted", "AbortError"));
        };
        signal?.addEventListener("abort", aborted, { once: true });
      });
      try { await (signal === undefined ? operation : Promise.race([operation, abort])); }
      finally { if (aborted !== undefined) signal?.removeEventListener("abort", aborted); }
      return get(projectId, executionId);
    },
    cancel(projectId, executionId) {
      const execution = get(projectId, executionId);
      if (terminal.has(execution.status)) return false;
      const completedAt = timestamp();
      const changed = repository(projectId).cancel(
        projectId, executionId, completedAt, elapsed(execution.createdAt, completedAt),
      );
      if (changed) active.get(key(projectId, executionId))?.controller.abort();
      return changed;
    },
    async close() {
      for (const state of active.values()) state.controller.abort();
      await Promise.allSettled([...operations.values()]);
      active.clear(); operations.clear();
    },
  };
}
