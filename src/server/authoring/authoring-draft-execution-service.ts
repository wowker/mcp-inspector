import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  listAuthoringDraftExecutionsInputSchema,
  startAuthoringDraftExecutionInputSchema,
  type AuthoringDraftExecutionDetail,
  type AuthoringDraftExecutionSummary,
  type AuthoringDraftExecutionTestCase,
  type StartAuthoringDraftExecutionInput,
} from "../../shared/authoring/execution.js";
import { evaluateAssertion, type AssertionContext } from "../../shared/testing/assertion-engine.js";
import type { AssertionDefinition, AssertionResult } from "../../shared/testing/assertions.js";
import type { JsonObject, JsonValue } from "../../shared/tool-definition.js";
import { AUTHORING_LIMITS } from "../../shared/authoring/protocol.js";
import { createScriptRunner, type ScriptRunner } from "../workflows/script-runner.js";
import { canonicalJson } from "../tools/tool-service.js";
import {
  createArgumentTransformExecutor,
  runScenario,
  type ScenarioInvocationResult,
} from "../testing/scenario-runner.js";
import type { ProjectService } from "../projects/project-service.js";
import type { AuthoringCallService } from "./authoring-call-service.js";
import type { AuthoringDraftService } from "./authoring-draft-service.js";
import type { AuthoringDraftValidator } from "./authoring-draft-validator.js";
import {
  AuthoringDraftExecutionRepository,
  AuthoringDraftExecutionRepositoryActiveError,
  AuthoringDraftExecutionRepositoryConflictError,
} from "./authoring-draft-execution-repository.js";

const terminal = new Set(["PASSED", "FAILED", "ERROR", "CANCELLED", "INTERRUPTED"]);
const maximumStoredResultBytes = AUTHORING_LIMITS.maxStructuredResponseBytes;

export class AuthoringDraftExecutionNotFoundError extends Error {
  constructor() { super("Authoring Draft execution not found"); this.name = "AuthoringDraftExecutionNotFoundError"; }
}
export class AuthoringDraftExecutionConflictError extends Error {
  constructor() { super("Authoring Draft execution idempotency conflict"); this.name = "AuthoringDraftExecutionConflictError"; }
}
export class AuthoringDraftExecutionActiveError extends Error {
  constructor() { super("Authoring Draft already has an active execution"); this.name = "AuthoringDraftExecutionActiveError"; }
}
export class AuthoringDraftExecutionValidationError extends Error {
  constructor() { super("Authoring Draft validation is stale or invalid"); this.name = "AuthoringDraftExecutionValidationError"; }
}

export interface AuthoringDraftExecutionService {
  start(input: StartAuthoringDraftExecutionInput): AuthoringDraftExecutionSummary;
  get(projectId: string, executionId: string): AuthoringDraftExecutionDetail;
  list(projectId: string, input?: { draftId?: string; limit?: number }): { items: AuthoringDraftExecutionSummary[] };
  waitForTerminal(projectId: string, executionId: string, signal?: AbortSignal): Promise<AuthoringDraftExecutionDetail>;
  cancel(projectId: string, executionId: string): boolean;
  close(): Promise<void>;
}

interface ActiveExecution {
  controller: AbortController;
  executionId: string;
  projectId: string;
  startedAt: number;
}

function assertionContext(response: JsonValue | null, error: { code: string; message: string } | null,
  status: string, durationMs: number | null): AssertionContext {
  return { sources: {
    RUN: { status, durationMs },
    ...(response === null ? {} : { MCP_RESULT: response }),
    ...(error === null ? {} : { MCP_ERROR: error }),
  } };
}

export function createAuthoringDraftExecutionService(options: {
  projects: ProjectService;
  drafts: Pick<AuthoringDraftService, "get">;
  validator: Pick<AuthoringDraftValidator, "validate">;
  calls: Pick<AuthoringCallService, "call">;
  resolveEnvironment(projectId: string, scope: "PROJECT" | "SERVER", connectionId: string,
    name: string): Promise<JsonValue | undefined>;
  scriptRunner?: ScriptRunner;
  createId?: () => string;
  now?: () => Date;
}): AuthoringDraftExecutionService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const scriptRunner = options.scriptRunner ?? createScriptRunner();
  const ownsScriptRunner = options.scriptRunner === undefined;
  const active = new Map<string, ActiveExecution>();
  const operations = new Map<string, Promise<void>>();
  const recoveredProjects = new Set<string>();
  const key = (projectId: string, executionId: string) => `${projectId}:${executionId}`;
  const repository = (projectId: string) => {
    const repo = new AuthoringDraftExecutionRepository(options.projects.open(projectId));
    if (!recoveredProjects.has(projectId)) {
      repo.interruptActive(projectId, now().toISOString());
      recoveredProjects.add(projectId);
    }
    return repo;
  };
  const generatedId = () => {
    const id = createId();
    if (!z.string().uuid().safeParse(id).success) throw new Error("Authoring Draft execution ID generator returned an invalid UUID");
    return id;
  };
  const elapsed = (startedAt: number) => Math.max(0, now().getTime() - startedAt);
  const get = (projectId: string, executionId: string) => {
    const value = repository(projectId).get(projectId, executionId);
    if (value === null) throw new AuthoringDraftExecutionNotFoundError();
    return value;
  };
  const assertionResults = (definitions: readonly AssertionDefinition[], context: AssertionContext): AssertionResult[] =>
    definitions.map((definition) => evaluateAssertion(definition, context, { createId: generatedId, now: () => now().getTime() }));
  const boundedResults = (results: AuthoringDraftExecutionTestCase[]) =>
    Buffer.byteLength(JSON.stringify({ testCases: results }), "utf8") <= maximumStoredResultBytes ? results : [];
  const callKey = (executionId: string, localId: string, stepId: string, attempt: number) =>
    `draft-exec:${executionId}:${createHash("sha256").update(`${localId}:${stepId}:${attempt}`).digest("hex").slice(0, 32)}`;

  async function execute(projectId: string, executionId: string, request: StartAuthoringDraftExecutionInput): Promise<void> {
    const running = active.get(key(projectId, executionId));
    if (running === undefined) return;
    const repo = repository(projectId);
    const results: AuthoringDraftExecutionTestCase[] = [];
    let topError: { code: string; message: string } | null = null;
    try {
      if (!repo.transition(projectId, executionId, "VALIDATING", now().toISOString())) return;
      const draft = options.drafts.get(projectId, request.draftId);
      if (draft.revision !== request.revision || draft.definitionDigest !== get(projectId, executionId).definitionDigest) {
        throw new AuthoringDraftExecutionValidationError();
      }
      const validation = options.validator.validate({ projectId, draftId: request.draftId, revision: request.revision });
      if (validation.status !== "VALID" || validation.validationDigest !== request.validationDigest ||
          validation.definitionDigest !== draft.definitionDigest) throw new AuthoringDraftExecutionValidationError();
      repo.transition(projectId, executionId, "RUNNING_SETUP", now().toISOString());
      repo.transition(projectId, executionId, "RUNNING_STEPS", now().toISOString());

      for (const testCase of draft.definition.testCases) {
        if (running.controller.signal.aborted) break;
        if (testCase.kind === "tool") {
          const call = await options.calls.call({ projectId, connectionId: testCase.target.connectionId,
            toolName: testCase.target.toolName,
            toolSchemaHash: validation.toolSchemaHashes[`${testCase.target.connectionId}:${testCase.target.toolName}`]!,
            arguments: testCase.arguments, context: { kind: "DRAFT", draftId: draft.id, draftRevision: draft.revision },
            purpose: "ACTION", idempotencyKey: callKey(executionId, testCase.localId, "tool", 1) }, running.controller.signal);
          repo.transition(projectId, executionId, "RUNNING_ASSERTIONS", now().toISOString());
          const assertions = assertionResults(testCase.assertions,
            assertionContext(call.response, call.error, call.status, call.durationMs));
          const assertionError = assertions.some(({ status }) => status === "ERROR");
          const assertionFailure = assertions.some(({ status }) => status === "FAILED");
          const status = call.status === "SUCCEEDED"
            ? assertionError ? "ERROR" as const : assertionFailure ? "FAILED" as const : "PASSED" as const
            : call.status === "CANCELLED" ? "CANCELLED" as const : "FAILED" as const;
          results.push({ localId: testCase.localId, kind: "tool", status,
            steps: [{ stepId: "tool", position: 0, attempt: 1, status,
              arguments: call.arguments, runId: call.runId, assertions, error: call.error }],
            assertions, error: call.error });
          repo.transition(projectId, executionId, "RUNNING_STEPS", now().toISOString());
          continue;
        }

        let lastMainCallId: string | undefined;
        const scenario = await runScenario({ definition: {
          ...testCase, id: generatedId(), projectId, revision: request.revision, isEnabled: false,
          createdAt: draft.createdAt, updatedAt: draft.updatedAt,
        }, inputs: request.inputs[testCase.localId] ?? {}, signal: running.controller.signal }, {
          invoke: async (invocation): Promise<ScenarioInvocationResult> => {
            repo.transition(projectId, executionId,
              invocation.phase === "cleanup" ? "RUNNING_CLEANUP" : "RUNNING_STEPS", now().toISOString());
            const call = await options.calls.call({ projectId, connectionId: invocation.connectionId,
              toolName: invocation.toolName,
              toolSchemaHash: validation.toolSchemaHashes[`${invocation.connectionId}:${invocation.toolName}`]!,
              arguments: invocation.argumentsValue,
              context: { kind: "DRAFT", draftId: draft.id, draftRevision: draft.revision },
              purpose: invocation.phase === "cleanup" ? "CLEANUP" : invocation.attempt > 1 ? "POLL" : "ACTION",
              idempotencyKey: callKey(executionId, testCase.localId, invocation.stepId, invocation.attempt),
              ...(invocation.phase === "cleanup" && lastMainCallId !== undefined
                ? { cleanupForCallId: lastMainCallId } : {}),
            }, invocation.signal);
            if (invocation.phase === "main") lastMainCallId = call.id;
            if (running.controller.signal.aborted && invocation.phase === "main") {
              return { sources: {}, runId: call.runId, workflowExecutionId: null,
                sanitizedArguments: call.arguments, succeeded: false,
                error: { code: "TEST_EXECUTION_CANCELLED", message: "Draft execution was cancelled" } };
            }
            return { sources: assertionContext(call.response, call.error, call.status, call.durationMs).sources,
              runId: call.runId, workflowExecutionId: null,
              sanitizedArguments: call.arguments, succeeded: call.status === "SUCCEEDED",
              error: call.error ?? undefined };
          },
          wait: async (milliseconds, signal) => new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, milliseconds);
            signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
          }),
          resolveEnvironment: (scope, connectionId, name) =>
            options.resolveEnvironment(projectId, scope, connectionId, name),
          transformArguments: createArgumentTransformExecutor(scriptRunner), createId: generatedId,
          now: () => now().getTime(),
        });
        results.push({ localId: testCase.localId, kind: "scenario", status: scenario.status,
          steps: scenario.steps.map((step) => ({ stepId: step.stepId, position: step.position, attempt: step.attempt,
            status: step.status, arguments: step.argumentsValue, runId: step.runId,
            assertions: step.assertions, error: step.error })),
          assertions: scenario.assertions, error: scenario.error });
      }

      if (running.controller.signal.aborted) {
        repo.recordCancelledResult(projectId, executionId, boundedResults(results));
        return;
      }
      const status = results.some(({ status }) => status === "ERROR") ? "ERROR" as const
        : results.some(({ status }) => status === "FAILED" || status === "CANCELLED") ? "FAILED" as const
          : "PASSED" as const;
      topError = results.find(({ error }) => error !== null)?.error ?? null;
      const stored = boundedResults(results);
      repo.complete({ projectId, executionId, status: stored.length === results.length ? status : "ERROR",
        testCases: stored, error: stored.length === results.length ? topError
          : { code: "DRAFT_EXECUTION_RESULT_TOO_LARGE", message: "Draft execution result exceeds the storage limit" },
        completedAt: now().toISOString(), durationMs: elapsed(running.startedAt) });
    } catch (error) {
      if (running.controller.signal.aborted) {
        repo.recordCancelledResult(projectId, executionId, boundedResults(results));
        return;
      }
      topError = error instanceof AuthoringDraftExecutionValidationError
        ? { code: "DRAFT_VALIDATION_STALE", message: error.message }
        : { code: "DRAFT_EXECUTION_FAILED", message: "Authoring Draft execution failed" };
      repo.complete({ projectId, executionId, status: "ERROR", testCases: results, error: topError,
        completedAt: now().toISOString(), durationMs: elapsed(running.startedAt) });
    }
  }

  return {
    start(rawInput) {
      const input = startAuthoringDraftExecutionInputSchema.parse(rawInput);
      const draft = options.drafts.get(input.projectId, input.draftId);
      if (draft.revision !== input.revision || draft.state !== "ACTIVE") throw new AuthoringDraftExecutionValidationError();
      try {
        const created = repository(input.projectId).create({ id: generatedId(), projectId: input.projectId,
          draftId: input.draftId, draftRevision: input.revision, definitionDigest: draft.definitionDigest,
          validationDigest: input.validationDigest, idempotencyKey: input.idempotencyKey,
          requestHash: createHash("sha256").update(canonicalJson(input)).digest("hex"),
          inputs: input.inputs, createdAt: now().toISOString() });
        if (created.created) {
          const operationKey = key(input.projectId, created.execution.id);
          const state = { controller: new AbortController(), executionId: created.execution.id,
            projectId: input.projectId, startedAt: now().getTime() };
          active.set(operationKey, state);
          const operation = Promise.resolve().then(() => execute(input.projectId, created.execution.id, input))
            .finally(() => { active.delete(operationKey); operations.delete(operationKey); });
          operations.set(operationKey, operation);
        }
        return created.execution;
      } catch (error) {
        if (error instanceof AuthoringDraftExecutionRepositoryConflictError) throw new AuthoringDraftExecutionConflictError();
        if (error instanceof AuthoringDraftExecutionRepositoryActiveError) throw new AuthoringDraftExecutionActiveError();
        throw error;
      }
    },
    get,
    list(projectId, rawInput = {}) {
      const input = listAuthoringDraftExecutionsInputSchema.parse({ projectId, ...rawInput });
      return { items: repository(projectId).list(projectId, input.draftId, input.limit) };
    },
    async waitForTerminal(projectId, executionId, signal) {
      const current = get(projectId, executionId);
      if (terminal.has(current.status)) return current;
      const operation = operations.get(key(projectId, executionId));
      if (operation === undefined) return get(projectId, executionId);
      if (signal === undefined) await operation;
      else {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        let abort!: () => void;
        const cancellation = new Promise<never>((_resolve, reject) => {
          abort = () => reject(new DOMException("Aborted", "AbortError"));
          signal.addEventListener("abort", abort, { once: true });
        });
        try { await Promise.race([operation, cancellation]); }
        finally { signal.removeEventListener("abort", abort); }
      }
      return get(projectId, executionId);
    },
    cancel(projectId, executionId) {
      const current = get(projectId, executionId);
      if (terminal.has(current.status)) return false;
      const running = active.get(key(projectId, executionId));
      const changed = repository(projectId).cancel(projectId, executionId, now().toISOString(),
        running === undefined ? 0 : elapsed(running.startedAt));
      if (changed) running?.controller.abort();
      return changed;
    },
    async close() {
      for (const state of active.values()) {
        repository(state.projectId).cancel(state.projectId, state.executionId, now().toISOString(), elapsed(state.startedAt));
        state.controller.abort();
      }
      await Promise.allSettled([...operations.values()]);
      if (ownsScriptRunner) await scriptRunner.close();
      active.clear(); operations.clear();
    },
  };
}
