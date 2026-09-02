import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateAssertion } from "../../../shared/testing/assertion-engine.js";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { createTestCaseService } from "../test-case-service.js";
import { TestExecutionRepository } from "../test-execution-repository.js";

const projectId = "00000000-0000-4000-8000-000000001501";
const connectionId = "00000000-0000-4000-8000-000000001502";
const executionId = "00000000-0000-4000-8000-000000001503";
const stepId = "00000000-0000-4000-8000-000000001504";

describe("TestExecutionRepository", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-test-execution-repository-")); roots.push(dataRoot);
    let id = 1_510;
    const createId = () => `00000000-0000-4000-8000-${String(id++).padStart(12, "0")}`;
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Test executions");
    const connections = createConnectionService(projects, { createId: () => connectionId });
    connections.create(projectId, {
      name: "Target", url: "https://example.test/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 10_000,
    });
    const testCases = createTestCaseService(projects, { createId });
    const testCase = testCases.create(projectId, {
      kind: "tool", name: "Sum", description: "", tags: [], isEnabled: true,
      target: { connectionId, toolName: "sum" }, arguments: { a: 1 }, timeoutMs: 10_000,
      assertions: [{ id: "value", source: "MCP_RESULT", path: "$.value", operator: "EQUALS", expected: 2 }],
    });
    return { projects, connections, testCase, repository: new TestExecutionRepository(projects.open(projectId)) };
  }

  it("atomically owns an idempotency key and returns the existing request hash", async () => {
    const { projects, connections, testCase, repository } = fixture();
    try {
      const input = { id: executionId, projectId, testCase, idempotencyKey: "intent-1",
        requestHash: "hash-a", inputs: {}, createdAt: "2026-09-01T00:00:00.000Z" };
      expect(repository.create(input)).toMatchObject({ created: true, requestHash: "hash-a" });
      expect(repository.create({ ...input, id: "00000000-0000-4000-8000-000000001599", requestHash: "hash-b" }))
        .toMatchObject({ created: false, requestHash: "hash-a", execution: { id: executionId } });
    } finally { await connections.close(); projects.close(); }
  });

  it("persists the invocation and assertion results in one guarded terminal transition", async () => {
    const { projects, connections, testCase, repository } = fixture();
    try {
      repository.create({ id: executionId, projectId, testCase, idempotencyKey: "intent-2",
        requestHash: "hash", inputs: {}, createdAt: "2026-09-01T00:00:00.000Z" });
      expect(repository.begin(projectId, executionId, stepId, "2026-09-01T00:00:01.000Z", { a: 1 })).toBe(true);
      expect(repository.linkInvocation(projectId, executionId, stepId, {
        runId: null, workflowExecutionId: null,
      })).toBe(true);
      const result = evaluateAssertion(testCase.assertions[0], { sources: { MCP_RESULT: { value: 2 } } }, {
        createId: () => "00000000-0000-4000-8000-000000001505", now: () => 1,
      });
      expect(repository.complete(projectId, executionId, stepId, {
        status: "PASSED", stepStatus: "PASSED", completedAt: "2026-09-01T00:00:02.000Z",
        durationMs: 2_000, error: null, assertions: [result],
      })).toBe(true);
      expect(repository.complete(projectId, executionId, stepId, {
        status: "ERROR", stepStatus: "ERROR", completedAt: "2026-09-01T00:00:03.000Z",
        durationMs: 3_000, error: { code: "LATE", message: "late" }, assertions: [],
      })).toBe(false);
      expect(repository.get(projectId, executionId)).toMatchObject({
        status: "PASSED", steps: [{ id: stepId, status: "PASSED", resolvedArguments: { a: 1 } }],
        assertions: [{ assertionId: "value", status: "PASSED", actual: 2 }],
      });
    } finally { await connections.close(); projects.close(); }
  });

  it("recovers queued and running executions as interrupted", async () => {
    const { projects, connections, testCase, repository } = fixture();
    try {
      repository.create({ id: executionId, projectId, testCase, idempotencyKey: "intent-3",
        requestHash: "hash", inputs: {}, createdAt: "2026-09-01T00:00:00.000Z" });
      expect(repository.interruptActive(projectId, "2026-09-01T00:00:04.000Z")).toBe(1);
      expect(repository.get(projectId, executionId)).toMatchObject({
        status: "INTERRUPTED", error: { code: "PROCESS_RESTARTED" }, durationMs: 4_000,
      });
    } finally { await connections.close(); projects.close(); }
  });

  it("lists execution reports in stable reverse chronological order", async () => {
    const { projects, connections, testCase, repository } = fixture();
    try {
      repository.create({ id: executionId, projectId, testCase, idempotencyKey: "report-1",
        requestHash: "hash-1", inputs: {}, createdAt: "2026-09-01T00:00:00.000Z" });
      repository.create({ id: "00000000-0000-4000-8000-000000001507", projectId, testCase,
        idempotencyKey: "report-2", requestHash: "hash-2", inputs: {}, createdAt: "2026-09-01T00:00:01.000Z" });

      const first = repository.list(projectId, 1, null);
      expect(first.items).toEqual([expect.objectContaining({
        id: "00000000-0000-4000-8000-000000001507", testCaseName: "Sum", testCaseKind: "tool",
      })]);
      expect(first.next).toEqual({ createdAt: "2026-09-01T00:00:01.000Z", id: "00000000-0000-4000-8000-000000001507" });
      expect(repository.list(projectId, 1, first.next).items).toEqual([
        expect.objectContaining({ id: executionId, testCaseName: "Sum" }),
      ]);
    } finally { await connections.close(); projects.close(); }
  });

  it("persists all scenario attempts and assertions in one terminal transition", async () => {
    const { projects, connections, testCase, repository } = fixture();
    try {
      repository.create({ id: executionId, projectId, testCase, idempotencyKey: "scenario-intent",
        requestHash: "hash", inputs: { storeId: "s-1" }, createdAt: "2026-09-01T00:00:00.000Z" });
      expect(repository.beginExecution(projectId, executionId, "2026-09-01T00:00:01.000Z")).toBe(true);
      expect(repository.completeScenario(projectId, executionId, {
        status: "PASSED", completedAt: "2026-09-01T00:00:03.000Z", durationMs: 3_000, error: null,
        steps: [{ id: stepId, stepId: "inspect", position: 0, attempt: 1, status: "FAILED",
          runId: null, workflowExecutionId: null, argumentsValue: { orderId: "o-1" }, error: null, assertions: [] },
        { id: "00000000-0000-4000-8000-000000001506", stepId: "inspect", position: 0, attempt: 2,
          status: "PASSED", runId: null, workflowExecutionId: null, argumentsValue: { orderId: "o-1" },
          error: null, assertions: [] }],
        assertions: [],
      })).toBe(true);
      expect(repository.get(projectId, executionId)).toMatchObject({
        status: "PASSED", inputs: { storeId: "s-1" },
        steps: [{ stepId: "inspect", attempt: 1, status: "FAILED" },
          { stepId: "inspect", attempt: 2, status: "PASSED" }],
      });
    } finally { await connections.close(); projects.close(); }
  });
});
