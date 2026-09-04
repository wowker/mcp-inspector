import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TestExecutionDetail } from "../../../shared/testing/test-execution.js";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import {
  createPressureTestExecutionService,
  PressureTestAlreadyRunningError,
  PressureTestDestructiveConfirmationRequiredError,
  PressureTestExecutionConflictError,
} from "../pressure-test-execution-service.js";
import { createPressureTestService } from "../pressure-test-service.js";
import { createTestCaseService } from "../test-case-service.js";
import type { TestExecutionService } from "../test-execution-service.js";

const projectId = "00000000-0000-4000-8000-000000005301";
const connectionId = "00000000-0000-4000-8000-000000005302";

describe("PressureTestExecutionService", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture(options: { destructive?: boolean } = {}) {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-pressure-executions-")); roots.push(dataRoot);
    let nextId = 5_400;
    const createId = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Pressure executions");
    const connections = createConnectionService(projects, { createId: () => connectionId });
    connections.create(projectId, { name: "A", url: "https://a.example.test/mcp",
      transport: "streamable-http", authMode: "none", timeoutMs: 10_000 });
    const testCases = createTestCaseService(projects, { createId });
    const testCase = testCases.create(projectId, { kind: "tool", name: "Lookup", description: "", tags: [],
      isEnabled: true, target: { connectionId, toolName: "lookup" }, arguments: {}, assertions: [], timeoutMs: 10_000 });
    const pressureTests = createPressureTestService(projects, { createId });
    const pressureTest = pressureTests.create(projectId, {
      name: "Lookup pressure", description: "", target: { testCaseId: testCase.id }, inputs: {},
      load: { virtualUsers: 2, rampUpMs: 0, durationMs: 10_000, thinkTimeMs: 0, maxIterations: 3 },
      thresholds: { maxErrorRate: 0, maxP95DurationMs: 100, minRequestsPerSecond: 0, stopOnErrorRate: true },
    });
    let invocation = 0;
    const testExecutions = {
      start: vi.fn(() => {
        const id = `10000000-0000-4000-8000-${String(++invocation).padStart(12, "0")}`;
        const at = new Date().toISOString();
        projects.open(projectId).database.prepare(`INSERT INTO test_executions
          (id, project_id, test_case_id, test_case_revision, idempotency_key, request_hash, status,
           definition_snapshot_json, inputs_json, created_at, started_at, completed_at, duration_ms)
          VALUES (?, ?, ?, ?, ?, ?, 'PASSED', ?, '{}', ?, ?, ?, 10)`).run(
          id, projectId, testCase.id, testCase.revision, `mock-${invocation}`, "a".repeat(64),
          JSON.stringify(testCase), at, at, at,
        );
        return { id } as TestExecutionDetail;
      }),
      waitForTerminal: vi.fn(async (_projectId: string, executionId: string) => {
        const now = new Date().toISOString();
        return { id: executionId, status: "PASSED", createdAt: now, startedAt: now, completedAt: now,
          durationMs: 10, error: null } as TestExecutionDetail;
      }),
      close: vi.fn(async () => undefined),
    } as unknown as TestExecutionService;
    const service = createPressureTestExecutionService({ projects, pressureTests, testCases, testExecutions,
      inspectTarget: () => ({ status: "current", destructive: options.destructive === true }), createId });
    return { projects, connections, testCases, testCase, pressureTests, pressureTest, testExecutions, service };
  }

  it("runs bounded virtual users through Test Execution and persists aggregate samples", async () => {
    const { projects, connections, service, pressureTest, testExecutions } = fixture();
    try {
      const queued = service.start({ projectId, pressureTestId: pressureTest.id,
        idempotencyKey: "intent-1", request: {} });
      const completed = await service.waitForTerminal(projectId, queued.id);
      expect(completed.status).toBe("PASSED");
      expect(completed.summary).toMatchObject({ total: 3, passed: 3, failed: 0, errors: 0 });
      expect(service.samples(projectId, queued.id).items).toHaveLength(3);
      expect(testExecutions.start).toHaveBeenCalledTimes(3);
      expect(service.start({ projectId, pressureTestId: pressureTest.id,
        idempotencyKey: "intent-1", request: {} }).id).toBe(queued.id);
    } finally { await service.close(); await connections.close(); projects.close(); }
  });

  it("enforces one active execution and idempotency request identity", async () => {
    const { projects, connections, service, pressureTest, pressureTests, testCase } = fixture();
    try {
      const first = service.start({ projectId, pressureTestId: pressureTest.id,
        idempotencyKey: "same-intent", request: {} });
      expect(() => service.start({ projectId, pressureTestId: pressureTest.id,
        idempotencyKey: "another-intent", request: {} })).toThrow(PressureTestAlreadyRunningError);
      await service.waitForTerminal(projectId, first.id);
      pressureTests.update(projectId, pressureTest.id, { revision: 1, definition: {
        name: "Changed", description: "", target: { testCaseId: testCase.id }, inputs: {},
        load: { ...pressureTest.load, maxIterations: 4 }, thresholds: pressureTest.thresholds,
      } });
      expect(() => service.start({ projectId, pressureTestId: pressureTest.id,
        idempotencyKey: "same-intent", request: {} })).toThrow(PressureTestExecutionConflictError);
    } finally { await service.close(); await connections.close(); projects.close(); }
  });

  it("requires explicit confirmation before applying load to a destructive Tool", async () => {
    const { projects, connections, service, pressureTest } = fixture({ destructive: true });
    try {
      expect(() => service.start({ projectId, pressureTestId: pressureTest.id,
        idempotencyKey: "unsafe", request: {} })).toThrow(PressureTestDestructiveConfirmationRequiredError);
      const execution = service.start({ projectId, pressureTestId: pressureTest.id,
        idempotencyKey: "confirmed", request: { confirmDestructive: true } });
      expect((await service.waitForTerminal(projectId, execution.id)).status).toBe("PASSED");
    } finally { await service.close(); await connections.close(); projects.close(); }
  });
});
