import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { createTestCaseService } from "../test-case-service.js";
import { TestExecutionRepository } from "../test-execution-repository.js";
import { DestructiveConfirmationRequiredError, type TestExecutionService } from "../test-execution-service.js";
import { TestSuiteExecutionRepository } from "../test-suite-execution-repository.js";
import { createTestSuiteExecutionService } from "../test-suite-execution-service.js";
import { createTestSuiteService } from "../test-suite-service.js";

const projectId = "00000000-0000-4000-8000-000000000971";
const connectionId = "00000000-0000-4000-8000-000000000972";

describe("TestSuiteExecutionService", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it("executes enabled members and persists a position-stable aggregate", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-suite-execution-")); roots.push(dataRoot);
    let nextId = 980;
    const createId = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
    const projects = createProjectService({ dataRoot, createId: () => projectId }); projects.create("Suite runs");
    const connections = createConnectionService(projects, { createId: () => connectionId });
    connections.create(projectId, { name: "A", url: "https://a.example.test/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 10_000 });
    const testCases = createTestCaseService(projects, { createId, now: () => new Date("2026-09-01T02:00:00.000Z") });
    const cases = ["one", "two"].map((toolName) => testCases.create(projectId, {
      kind: "tool", name: toolName, description: "", tags: [], isEnabled: true,
      target: { connectionId, toolName }, arguments: {}, assertions: [], timeoutMs: 10_000,
    }));
    const suites = createTestSuiteService(projects, { createId, now: () => new Date("2026-09-01T02:00:00.000Z") });
    const suite = suites.create(projectId, { name: "Two", description: "", tags: [],
      members: cases.map((testCase, position) => ({ id: createId(), testCaseId: testCase.id, position, isEnabled: true })),
      executionPolicy: { concurrency: 2, stopOnFailure: false } });
    const executionRepository = new TestExecutionRepository(projects.open(projectId));
    const start = vi.fn((input: any) => {
      const id = createId();
      return executionRepository.create({ id, projectId, testCase: testCases.get(projectId, input.testCaseId),
        idempotencyKey: input.idempotencyKey, requestHash: id, inputs: input.inputs ?? {},
        createdAt: "2026-09-01T02:00:00.000Z" }).execution;
    });
    const testExecutions: TestExecutionService = {
      list: vi.fn(() => ({ items: [], nextCursor: null })),
      updateBaseline: vi.fn(() => { throw new Error("not used"); }),
      start,
      get: vi.fn(),
      waitForTerminal: vi.fn(async (_projectId, executionId) => ({
        ...executionRepository.get(projectId, executionId)!, status: "PASSED" as const,
      })),
      cancel: vi.fn(() => true),
      close: vi.fn(async () => undefined),
    };
    const service = createTestSuiteExecutionService({ projects, suites, testCases, testExecutions,
      inspectTarget: () => ({ status: "current", destructive: false }),
      createId, now: () => new Date("2026-09-01T02:00:01.000Z") });
    try {
      const started = service.start({ projectId, suiteId: suite.id, idempotencyKey: "suite-intent", request: {} });
      await vi.waitFor(() => expect(service.get(projectId, started.id).status).toBe("PASSED"));
      const completed = service.get(projectId, started.id);
      expect(start).toHaveBeenCalledTimes(2);
      expect(completed.summary).toEqual({ total: 2, passed: 2, failed: 0, errors: 0, cancelled: 0 });
      expect(completed.items.map(({ position, status, testExecutionId }) =>
        [position, status, testExecutionId !== null])).toEqual([[0, "PASSED", true], [1, "PASSED", true]]);

      const reduced = suites.update(projectId, suite.id, { revision: 1, definition: {
        name: suite.name, description: suite.description, tags: suite.tags,
        members: [{ ...suite.members[1]!, position: 0 }], executionPolicy: suite.executionPolicy,
      } });
      expect(reduced.members.map(({ testCaseId }) => testCaseId)).toEqual([cases[1]!.id]);
      expect(service.get(projectId, started.id).items).toHaveLength(2);
      const replacementMemberId = createId();
      const restored = suites.update(projectId, suite.id, { revision: 2, definition: {
        name: suite.name, description: suite.description, tags: suite.tags,
        members: [{ id: replacementMemberId, testCaseId: cases[0]!.id, position: 0, isEnabled: true },
          { ...suite.members[1]!, position: 1 }], executionPolicy: suite.executionPolicy,
      } });
      expect(restored.members[0]?.id).toBe(suite.members[0]?.id);

      const cancelledId = createId();
      const suiteExecutions = new TestSuiteExecutionRepository(projects.open(projectId));
      suiteExecutions.create({ id: cancelledId, projectId, suite, idempotencyKey: "cancelled-suite",
        requestHash: "cancelled-suite", createdAt: "2026-09-01T02:00:00.000Z",
        itemIds: new Map(suite.members.map((member) => [member.id, createId()])) });
      expect(suiteExecutions.cancel(projectId, cancelledId, "2026-09-01T02:00:01.000Z", 1_000)).toBe(true);
      expect(suiteExecutions.get(projectId, cancelledId)?.summary).toEqual({
        total: 2, passed: 0, failed: 0, errors: 0, cancelled: 2,
      });

      const guardedService = createTestSuiteExecutionService({ projects, suites, testCases, testExecutions,
        inspectTarget: () => ({ status: "current", destructive: true }), createId,
        now: () => new Date("2026-09-01T02:00:02.000Z") });
      try {
        expect(() => guardedService.start({ projectId, suiteId: suite.id, idempotencyKey: "destructive-suite",
          request: {} })).toThrow(DestructiveConfirmationRequiredError);
        expect(start).toHaveBeenCalledTimes(2);
      } finally { await guardedService.close(); }
    } finally { await service.close(); await connections.close(); projects.close(); }
  });
});
