import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { TestSuiteDefinition } from "../../../shared/testing/test-suite.js";
import { createTestSuiteRoutes } from "../routes.js";
import { TestSuiteRevisionConflictError, type TestSuiteService } from "../test-suite-service.js";

const projectId = "00000000-0000-4000-8000-000000000961";
const suiteId = "00000000-0000-4000-8000-000000000962";
const testCaseId = "00000000-0000-4000-8000-000000000963";
const memberId = "00000000-0000-4000-8000-000000000964";
const mutation = { name: "Suite", description: "", tags: [], members: [
  { id: memberId, testCaseId, position: 0, isEnabled: true },
], executionPolicy: { concurrency: 1, stopOnFailure: false } };
const definition: TestSuiteDefinition = { ...mutation, id: suiteId, projectId, revision: 1,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };

function fixture(overrides: Partial<TestSuiteService> = {}) {
  const service: TestSuiteService = {
    create: vi.fn(() => definition), list: vi.fn(() => ({ items: [], nextCursor: null })),
    get: vi.fn(() => definition), update: vi.fn(() => ({ ...definition, revision: 2 })), remove: vi.fn(),
    ...overrides,
  };
  const app = new Hono(); app.route("/api/projects", createTestSuiteRoutes(service));
  return { app, service };
}

describe("test suite routes", () => {
  it("creates, reads, updates and deletes through stable envelopes", async () => {
    const { app, service } = fixture();
    const created = await app.request(`/api/projects/${projectId}/test-suites`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ testSuite: definition });
    expect((await app.request(`/api/projects/${projectId}/test-suites/${suiteId}`)).status).toBe(200);
    const updated = await app.request(`/api/projects/${projectId}/test-suites/${suiteId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 1, definition: mutation }),
    });
    expect(updated.status).toBe(200);
    expect((await app.request(`/api/projects/${projectId}/test-suites/${suiteId}`, { method: "DELETE" })).status).toBe(204);
    expect(service.remove).toHaveBeenCalledWith(projectId, suiteId);
  });

  it("returns a stable revision conflict", async () => {
    const { app } = fixture({ update: vi.fn(() => { throw new TestSuiteRevisionConflictError(); }) });
    const response = await app.request(`/api/projects/${projectId}/test-suites/${suiteId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 1, definition: mutation }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: {
      code: "TEST_SUITE_REVISION_CONFLICT", message: "Test suite revision conflict",
    } });
  });
});
