import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { PressureTestDefinition, PressureTestExecution } from "../../../shared/testing/pressure-test.js";
import { createPressureTestExecutionRoutes } from "../pressure-test-execution-routes.js";
import {
  PressureTestAlreadyRunningError,
  type PressureTestExecutionService,
} from "../pressure-test-execution-service.js";
import { createPressureTestRoutes } from "../routes.js";
import type { PressureTestService } from "../pressure-test-service.js";

const projectId = "00000000-0000-4000-8000-000000005501";
const pressureTestId = "00000000-0000-4000-8000-000000005502";
const testCaseId = "00000000-0000-4000-8000-000000005503";
const executionId = "00000000-0000-4000-8000-000000005504";
const at = "2026-09-04T00:00:00.000Z";
const mutation = {
  name: "Pressure", description: "", target: { testCaseId }, inputs: {},
  load: { virtualUsers: 2, rampUpMs: 0, durationMs: 1_000, thinkTimeMs: 0, maxIterations: 2 },
  thresholds: { maxErrorRate: 0, maxP95DurationMs: 100, minRequestsPerSecond: 1, stopOnErrorRate: true },
};
const definition: PressureTestDefinition = { ...mutation, id: pressureTestId, projectId, revision: 1,
  createdAt: at, updatedAt: at };
const execution: PressureTestExecution = { id: executionId, projectId, pressureTestId,
  pressureTestRevision: 1, definitionSnapshot: definition,
  targetSnapshot: { id: testCaseId, name: "Target", kind: "tool", revision: 1 }, status: "QUEUED",
  summary: null, error: null, createdAt: at, startedAt: null, completedAt: null, durationMs: null };

describe("pressure test routes", () => {
  it("exposes revisioned definition CRUD with pagination", async () => {
    const service: PressureTestService = {
      create: vi.fn(() => definition), list: vi.fn(() => ({ items: [definition], nextCursor: null })),
      get: vi.fn(() => definition), update: vi.fn(() => ({ ...definition, revision: 2 })), remove: vi.fn(),
    };
    const app = new Hono(); app.route("/api/projects", createPressureTestRoutes(service));
    const list = await app.request(`/api/projects/${projectId}/pressure-tests?limit=25`);
    expect(list.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith(projectId, { limit: 25 });
    const created = await app.request(`/api/projects/${projectId}/pressure-tests`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ pressureTest: definition });
    expect((await app.request(`/api/projects/${projectId}/pressure-tests/${pressureTestId}`, { method: "DELETE" })).status)
      .toBe(204);
  });

  it("maps active-run conflicts and keeps idempotency in the header", async () => {
    const service = {
      start: vi.fn(() => { throw new PressureTestAlreadyRunningError(); }),
      get: vi.fn(() => execution), list: vi.fn(() => ({ items: [], nextCursor: null })),
      samples: vi.fn(() => ({ items: [], nextCursor: null })), waitForTerminal: vi.fn(),
      cancel: vi.fn(() => true), close: vi.fn(async () => undefined),
    } as PressureTestExecutionService;
    const app = new Hono(); app.route("/api/projects", createPressureTestExecutionRoutes(service));
    const response = await app.request(`/api/projects/${projectId}/pressure-tests/${pressureTestId}/executions`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "intent" }, body: "{}",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: {
      code: "PRESSURE_TEST_ALREADY_RUNNING", message: "A pressure test is already running in this project",
    } });
    expect(service.start).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "intent" }));
  });
});
