import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  startTestSuiteExecutionRequestSchema,
  type TestSuiteExecutionDetail,
  type TestSuiteExecutionSummary,
} from "../../shared/testing/test-suite-execution.js";
import {
  testSuiteExecutionReportOutlineSchema,
  type TestSuiteExecutionReportOutline,
  type TestSuiteExecutionReportPage,
} from "../../shared/testing/test-suite-report.js";
import { canonicalJson } from "../tools/tool-service.js";
import { ToolRepository } from "../tools/tool-repository.js";
import type { ProjectService } from "../projects/project-service.js";
import { TestCaseNotFoundError, type TestCaseService } from "./test-case-service.js";
import {
  DestructiveConfirmationRequiredError,
  TestExecutionTargetError,
  type TestExecutionService,
} from "./test-execution-service.js";
import type { TestSuiteService } from "./test-suite-service.js";
import {
  TestSuiteExecutionRepository,
  type TestSuiteExecutionCursorPosition,
} from "./test-suite-execution-repository.js";
import { runSuite, type SuiteMemberInvocationResult, type SuiteRunItem } from "./suite-runner.js";

const startSchema = z.object({
  projectId: z.uuid(),
  suiteId: z.uuid(),
  idempotencyKey: z.string().min(1).max(200),
  request: startTestSuiteExecutionRequestSchema,
}).strict();
const terminal = new Set(["PASSED", "FAILED", "ERROR", "CANCELLED", "INTERRUPTED"]);

export class InvalidTestSuiteExecutionError extends Error {
  constructor() { super("Test suite execution payload is invalid"); this.name = "InvalidTestSuiteExecutionError"; }
}
export class TestSuiteExecutionNotFoundError extends Error {
  constructor() { super("Test suite execution not found"); this.name = "TestSuiteExecutionNotFoundError"; }
}
export class TestSuiteExecutionConflictError extends Error {
  constructor() { super("Test suite execution idempotency conflict"); this.name = "TestSuiteExecutionConflictError"; }
}

export interface TestSuiteExecutionService {
  start(input: unknown): TestSuiteExecutionDetail;
  get(projectId: string, executionId: string): TestSuiteExecutionDetail;
  list(projectId: string, suiteId: string,
    input?: { cursor?: string; limit?: number }): TestSuiteExecutionReportPage;
  report(projectId: string, executionId: string): TestSuiteExecutionReportOutline;
  cancel(projectId: string, executionId: string): boolean;
  close(): Promise<void>;
}

function elapsed(from: string, to: string): number {
  return Math.max(0, Date.parse(to) - Date.parse(from));
}

function summaryOf(items: readonly SuiteRunItem[]): TestSuiteExecutionSummary {
  return {
    total: items.length,
    passed: items.filter(({ status }) => status === "PASSED").length,
    failed: items.filter(({ status }) => status === "FAILED").length,
    errors: items.filter(({ status }) => status === "ERROR" || status === "INTERRUPTED").length,
    cancelled: items.filter(({ status }) => status === "CANCELLED").length,
  };
}

function terminalResult(execution: Awaited<ReturnType<TestExecutionService["waitForTerminal"]>>): SuiteMemberInvocationResult {
  switch (execution.status) {
    case "PASSED": case "FAILED": case "ERROR": case "CANCELLED": case "INTERRUPTED":
      return { testExecutionId: execution.id, status: execution.status };
    default: return { testExecutionId: execution.id, status: "ERROR" };
  }
}

export function createTestSuiteExecutionService(deps: {
  projects: ProjectService;
  suites: TestSuiteService;
  testCases: TestCaseService;
  testExecutions: TestExecutionService;
  inspectTarget?: (projectId: string, connectionId: string, toolName: string) => {
    status: "current" | "removed";
    destructive: boolean;
  } | null;
  createId?: () => string;
  now?: () => Date;
}): TestSuiteExecutionService {
  const createId = deps.createId ?? randomUUID;
  const now = deps.now ?? (() => new Date());
  const active = new Map<string, AbortController>();
  const operations = new Map<string, Promise<void>>();
  const key = (projectId: string, executionId: string) => `${projectId}:${executionId}`;
  const timestamp = () => now().toISOString();
  const repository = (projectId: string) => new TestSuiteExecutionRepository(deps.projects.open(projectId));
  const inspectTarget = deps.inspectTarget ?? ((projectId: string, connectionId: string, toolName: string) => {
    const tool = new ToolRepository(deps.projects.open(projectId)).get(projectId, connectionId, toolName);
    return tool === null ? null : {
      status: tool.tool.status,
      destructive: tool.tool.currentSnapshot.definition.annotations?.destructiveHint === true,
    };
  });
  const generatedId = () => {
    const id = createId();
    if (!z.uuid().safeParse(id).success) throw new Error("Test suite execution ID generator returned an invalid UUID");
    return id;
  };

  const get = (projectId: string, executionId: string) => {
    if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(executionId).success) {
      throw new TestSuiteExecutionNotFoundError();
    }
    const value = repository(projectId).get(projectId, executionId);
    if (value === null) throw new TestSuiteExecutionNotFoundError();
    return value;
  };

  const decodeCursor = (value: string | undefined, projectId: string,
    suiteId: string): TestSuiteExecutionCursorPosition | null => {
    if (value === undefined) return null;
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
        projectId?: unknown; suiteId?: unknown; createdAt?: unknown; id?: unknown;
      };
      if (parsed.projectId !== projectId || parsed.suiteId !== suiteId || typeof parsed.createdAt !== "string" ||
          !z.string().datetime({ offset: true }).safeParse(parsed.createdAt).success ||
          typeof parsed.id !== "string" || !z.uuid().safeParse(parsed.id).success) throw new Error();
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch { throw new InvalidTestSuiteExecutionError(); }
  };

  const encodeCursor = (projectId: string, suiteId: string,
    position: TestSuiteExecutionCursorPosition): string =>
    Buffer.from(JSON.stringify({ projectId, suiteId, ...position }), "utf8").toString("base64url");

  const report = (projectId: string, executionId: string): TestSuiteExecutionReportOutline => {
    const execution = get(projectId, executionId);
    const members = execution.items.map((item) => {
      if (item.testExecutionId === null) return { item, testExecution: null, calls: [] };
      const testExecution = deps.testExecutions.get(projectId, item.testExecutionId);
      if (testExecution.testCaseId !== item.testCaseId) throw new TestSuiteExecutionNotFoundError();
      const cleanupIds = testExecution.definitionSnapshot.kind === "scenario"
        ? new Set(testExecution.definitionSnapshot.cleanupSteps.map(({ id }) => id))
        : new Set<string>();
      return {
        item,
        testExecution: {
          id: testExecution.id,
          testCaseId: testExecution.testCaseId,
          testCaseRevision: testExecution.testCaseRevision,
          testCaseName: testExecution.definitionSnapshot.name,
          testCaseKind: testExecution.definitionSnapshot.kind,
          status: testExecution.status,
          createdAt: testExecution.createdAt,
          startedAt: testExecution.startedAt,
          completedAt: testExecution.completedAt,
          durationMs: testExecution.durationMs,
          error: testExecution.error,
        },
        calls: [...testExecution.steps]
          .sort((left, right) => left.position - right.position || left.attempt - right.attempt || left.id.localeCompare(right.id))
          .map((step) => ({
            stepRecordId: step.id,
            stepId: step.stepId,
            stepKind: cleanupIds.has(step.stepId) ? "cleanup" as const : "tool" as const,
            position: step.position,
            attempt: step.attempt,
            runId: step.runId,
            workflowExecutionId: step.workflowExecutionId,
            status: step.status,
            startedAt: step.startedAt,
            completedAt: step.completedAt,
            durationMs: step.durationMs,
            error: step.error,
          })),
      };
    });
    return testSuiteExecutionReportOutlineSchema.parse({ execution, members });
  };

  async function execute(projectId: string, executionId: string, inputsByMember: Record<string, Record<string, unknown>>,
    confirmDestructive: boolean): Promise<void> {
    const controller = active.get(key(projectId, executionId));
    if (controller === undefined) return;
    const repo = repository(projectId);
    const initial = get(projectId, executionId);
    if (!repo.begin(projectId, executionId, timestamp())) return;
    try {
      const result = await runSuite({
        members: initial.suiteSnapshot.members,
        concurrency: initial.suiteSnapshot.executionPolicy.concurrency,
        stopOnFailure: initial.suiteSnapshot.executionPolicy.stopOnFailure,
        signal: controller.signal,
      }, {
        execute: async (member, signal) => {
          const started = deps.testExecutions.start({
            projectId, testCaseId: member.testCaseId,
            idempotencyKey: `${executionId}:${member.id}`,
            confirmDestructive,
            inputs: inputsByMember[member.id] ?? {},
          }, "TEST_SUITE");
          const completed = await deps.testExecutions.waitForTerminal(projectId, started.id, signal);
          return terminalResult(completed);
        },
      });
      const completedAt = timestamp();
      if (controller.signal.aborted) {
        repo.cancel(projectId, executionId, completedAt, elapsed(initial.createdAt, completedAt));
      } else {
        repo.complete(projectId, executionId, {
          status: result.status,
          completedAt,
          durationMs: elapsed(initial.createdAt, completedAt),
          summary: summaryOf(result.items),
          error: result.status === "ERROR" ? { code: "TEST_SUITE_EXECUTION_FAILED", message: "Test suite execution failed" } : null,
          items: result.items,
        });
      }
    } catch {
      const completedAt = timestamp();
      if (controller.signal.aborted) repo.cancel(projectId, executionId, completedAt, elapsed(initial.createdAt, completedAt));
      else repo.complete(projectId, executionId, {
        status: "ERROR", completedAt, durationMs: elapsed(initial.createdAt, completedAt),
        summary: { total: 0, passed: 0, failed: 0, errors: 1, cancelled: 0 },
        error: { code: "TEST_SUITE_EXECUTION_FAILED", message: "Test suite execution failed" },
        items: initial.items.map((item) => ({
          memberId: item.memberId, testCaseId: item.testCaseId, position: item.position,
          testExecutionId: null, status: "ERROR",
        })),
      });
    } finally {
      if (active.get(key(projectId, executionId)) === controller) active.delete(key(projectId, executionId));
    }
  }

  return {
    list(rawProjectId, rawSuiteId, input = {}) {
      const parsed = z.object({
        projectId: z.uuid(),
        suiteId: z.uuid(),
        cursor: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }).strict().safeParse({ projectId: rawProjectId, suiteId: rawSuiteId, ...input });
      if (!parsed.success) throw new InvalidTestSuiteExecutionError();
      const page = repository(parsed.data.projectId).list(
        parsed.data.projectId,
        parsed.data.suiteId,
        parsed.data.limit,
        decodeCursor(parsed.data.cursor, parsed.data.projectId, parsed.data.suiteId),
      );
      return {
        items: page.items,
        nextCursor: page.next === null
          ? null
          : encodeCursor(parsed.data.projectId, parsed.data.suiteId, page.next),
      };
    },
    report,
    start(raw) {
      const parsed = startSchema.safeParse(raw);
      if (!parsed.success) throw new InvalidTestSuiteExecutionError();
      const { projectId, suiteId, idempotencyKey, request } = parsed.data;
      const suite = deps.suites.get(projectId, suiteId);
      const enabledMemberIds = new Set(suite.members.filter(({ isEnabled }) => isEnabled).map(({ id }) => id));
      if (Object.keys(request.inputsByMember ?? {}).some((memberId) => !enabledMemberIds.has(memberId))) {
        throw new InvalidTestSuiteExecutionError();
      }
      for (const member of suite.members.filter(({ isEnabled }) => isEnabled)) {
        let testCase: ReturnType<TestCaseService["get"]>;
        try { testCase = deps.testCases.get(projectId, member.testCaseId); }
        catch (error) {
          if (error instanceof TestCaseNotFoundError) throw new TestExecutionTargetError();
          throw error;
        }
        if (!testCase.isEnabled) throw new InvalidTestSuiteExecutionError();
        const targets = testCase.kind === "tool"
          ? [testCase.target]
          : [...testCase.steps, ...testCase.cleanupSteps].map(({ target }) => target);
        for (const target of targets) {
          const tool = inspectTarget(projectId, target.connectionId, target.toolName);
          if (tool === null || tool.status === "removed") throw new TestExecutionTargetError();
          if (tool.destructive && request.confirmDestructive !== true) throw new DestructiveConfirmationRequiredError();
        }
      }
      const requestHash = createHash("sha256").update(canonicalJson({
        suiteId, revision: suite.revision, request,
      })).digest("hex");
      const executionId = generatedId();
      const itemIds = new Map(suite.members.filter(({ isEnabled }) => isEnabled).map((member) => [member.id, generatedId()]));
      const result = repository(projectId).create({ id: executionId, projectId, suite, idempotencyKey,
        requestHash, createdAt: timestamp(), itemIds });
      if (result.requestHash !== requestHash) throw new TestSuiteExecutionConflictError();
      if (result.created) {
        const controller = new AbortController();
        active.set(key(projectId, executionId), controller);
        const operation = Promise.resolve().then(() => execute(
          projectId, executionId, request.inputsByMember ?? {}, request.confirmDestructive === true,
        )).catch(() => undefined);
        operations.set(key(projectId, executionId), operation);
        void operation.finally(() => { if (operations.get(key(projectId, executionId)) === operation) operations.delete(key(projectId, executionId)); });
      }
      return result.execution;
    },
    get,
    cancel(projectId, executionId) {
      const execution = get(projectId, executionId);
      if (terminal.has(execution.status)) return false;
      const completedAt = timestamp();
      const changed = repository(projectId).cancel(projectId, executionId, completedAt,
        elapsed(execution.createdAt, completedAt));
      if (changed) active.get(key(projectId, executionId))?.abort();
      return changed;
    },
    async close() {
      for (const controller of active.values()) controller.abort();
      await Promise.allSettled(operations.values());
      active.clear(); operations.clear();
    },
  };
}
