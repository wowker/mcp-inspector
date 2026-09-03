import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { TestExecutionDetail, TestExecutionReportPage } from "../../../shared/testing/test-execution.js";
import { createTestExecutionRoutes } from "../test-execution-routes.js";
import { TestExecutionConflictError, TestExecutionNotFoundError, type TestExecutionService } from "../test-execution-service.js";

const projectId = "00000000-0000-4000-8000-000000000901";
const testCaseId = "00000000-0000-4000-8000-000000000902";
const executionId = "00000000-0000-4000-8000-000000000903";
const execution = { id: executionId, projectId, testCaseId, status: "QUEUED" } as TestExecutionDetail;

function fixture(overrides: Partial<TestExecutionService> = {}) {
  const service: TestExecutionService = {
    start: vi.fn(() => execution), get: vi.fn(() => execution), list: vi.fn(() => ({ items: [], nextCursor: null })), cancel: vi.fn(() => true),
    updateBaseline: vi.fn(() => ({ testCase: execution.definitionSnapshot, updatedAssertions: 1 })),
    waitForTerminal: vi.fn(async () => execution), close: vi.fn(async () => undefined), ...overrides,
  };
  const app = new Hono(); app.route("/api/projects", createTestExecutionRoutes(service));
  return { app, service };
}

describe("test execution routes", () => {
  it("starts with the idempotency key in a header and returns the execution envelope", async () => {
    const { app, service } = fixture();
    const response = await app.request(`/api/projects/${projectId}/test-cases/${testCaseId}/executions`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "execute-once" },
      body: JSON.stringify({ confirmDestructive: true }),
    });
    expect(response.status).toBe(202);
    expect(service.start).toHaveBeenCalledWith({ projectId, testCaseId, idempotencyKey: "execute-once", confirmDestructive: true });
    expect(await response.json()).toEqual({ execution });
  });

  it("rejects a missing idempotency key and maps conflicts", async () => {
    expect((await fixture().app.request(`/api/projects/${projectId}/test-cases/${testCaseId}/executions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    })).status).toBe(400);
    const conflict = await fixture({ start: vi.fn(() => { throw new TestExecutionConflictError(); }) }).app.request(
      `/api/projects/${projectId}/test-cases/${testCaseId}/executions`,
      { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "same" }, body: "{}" },
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "TEST_EXECUTION_CONFLICT" } });
  });

  it("gets and cancels within the project boundary", async () => {
    const { app, service } = fixture();
    expect((await app.request(`/api/projects/${projectId}/test-executions/${executionId}`)).status).toBe(200);
    expect((await app.request(`/api/projects/${projectId}/test-executions/${executionId}/cancel`, { method: "POST" })).status).toBe(200);
    expect(service.cancel).toHaveBeenCalledWith(projectId, executionId);
    const missing = await fixture({ get: vi.fn(() => { throw new TestExecutionNotFoundError(); }) }).app.request(
      `/api/projects/${projectId}/test-executions/${executionId}`,
    );
    expect(missing.status).toBe(404);
  });

  it("lists report summaries within the project boundary", async () => {
    const page: TestExecutionReportPage = { items: [{ id: executionId, projectId, testCaseId, testCaseRevision: 1,
      testCaseName: "Create product", testCaseKind: "tool", status: "PASSED", assertionSummary: {
        total: 1, passed: 1, failed: 0, error: 0,
      }, createdAt: "2026-09-01T00:00:00.000Z", startedAt: "2026-09-01T00:00:00.000Z",
      completedAt: "2026-09-01T00:00:01.000Z", durationMs: 1000, error: null }], nextCursor: null };
    const { app, service } = fixture({ list: vi.fn(() => page) });
    const response = await app.request(`/api/projects/${projectId}/test-executions?limit=25`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page);
    expect(service.list).toHaveBeenCalledWith(projectId, { limit: 25, cursor: undefined });
  });

  it("passes a validated test case filter to execution history", async () => {
    const { app, service } = fixture();
    const response = await app.request(`/api/projects/${projectId}/test-executions?testCaseId=${testCaseId}&limit=25`);
    expect(response.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith(projectId, { testCaseId, limit: 25, cursor: undefined });
  });

  it("updates a baseline only through an explicit confirmation body", async () => {
    const { app, service } = fixture();
    const response = await app.request(`/api/projects/${projectId}/test-executions/${executionId}/baseline`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: 1, confirm: true }),
    });
    expect(response.status).toBe(200);
    expect(service.updateBaseline).toHaveBeenCalledWith(projectId, executionId, { revision: 1, confirm: true });
  });
});
