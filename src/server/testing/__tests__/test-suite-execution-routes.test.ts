import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { TestSuiteExecutionService } from "../test-suite-execution-service.js";
import { createTestSuiteExecutionRoutes } from "../test-suite-execution-routes.js";

const projectId = "00000000-0000-4000-8000-000000000991";
const suiteId = "00000000-0000-4000-8000-000000000992";
const executionId = "00000000-0000-4000-8000-000000000993";
const execution: any = { id: executionId, projectId, suiteId, suiteRevision: 1, status: "QUEUED",
  suiteSnapshot: { id: suiteId, projectId, name: "Suite", description: "", tags: [], revision: 1,
    members: [], executionPolicy: { concurrency: 1, stopOnFailure: false },
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
  summary: null, error: null, createdAt: "2026-09-01T00:00:00.000Z", startedAt: null,
  completedAt: null, durationMs: null, items: [] };

describe("test suite execution routes", () => {
  it("keeps idempotency in the header and exposes get/cancel", async () => {
    const service: TestSuiteExecutionService = { start: vi.fn(() => execution), get: vi.fn(() => execution),
      cancel: vi.fn(() => true), close: vi.fn(async () => undefined) };
    const app = new Hono(); app.route("/api/projects", createTestSuiteExecutionRoutes(service));
    const started = await app.request(`/api/projects/${projectId}/test-suites/${suiteId}/executions`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "intent" }, body: "{}",
    });
    expect(started.status).toBe(202);
    expect(service.start).toHaveBeenCalledWith({ projectId, suiteId, idempotencyKey: "intent", request: {} });
    expect((await app.request(`/api/projects/${projectId}/test-suite-executions/${executionId}`)).status).toBe(200);
    expect((await app.request(`/api/projects/${projectId}/test-suite-executions/${executionId}/cancel`, { method: "POST" })).status).toBe(200);
  });
});
