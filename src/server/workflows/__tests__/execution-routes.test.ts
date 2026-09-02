import { describe, expect, it, vi } from "vitest";
import { createWorkflowExecutionRoutes } from "../execution-routes.js";
import type { WorkflowExecutionService } from "../workflow-execution-service.js";

const projectId = "00000000-0000-4000-8000-000000001181";
const executionId = "00000000-0000-4000-8000-000000001182";
const detail = {
  id: executionId, projectId, connectionId: "00000000-0000-4000-8000-000000001183",
  tabId: "00000000-0000-4000-8000-000000001184", toolName: "sum",
  toolSnapshotId: "00000000-0000-4000-8000-000000001185", idempotencyKey: "key", status: "queued" as const,
  initialArguments: {}, finalArguments: null, workflowSnapshot: {}, response: null, error: null,
  createdAt: "2026-08-27T00:00:00.000Z", startedAt: null, completedAt: null, durationMs: null,
  runs: [], events: [],
};

describe("workflow execution routes", () => {
  it("binds the URL project, returns 202, and exposes get/cancel", async () => {
    const start = vi.fn().mockReturnValue(detail); const get = vi.fn().mockReturnValue(detail);
    const cancel = vi.fn().mockReturnValue(true);
    const service = { start, startInvocation: vi.fn(), get, waitForTerminal: vi.fn(),
      activeForTab: vi.fn().mockReturnValue(null), cancel, close: vi.fn() } satisfies WorkflowExecutionService;
    const app = createWorkflowExecutionRoutes(service);

    const started = await app.request(`/${projectId}/workflow-executions`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        projectId: "00000000-0000-4000-8000-000000001199", connectionId: detail.connectionId, tabId: detail.tabId,
        idempotencyKey: "key", arguments: {},
      }) });
    expect(started.status).toBe(202);
    expect(start).toHaveBeenCalledWith({ projectId, connectionId: detail.connectionId, tabId: detail.tabId, idempotencyKey: "key", arguments: {} });
    expect(await (await app.request(`/${projectId}/workflow-executions/${executionId}`)).json())
      .toEqual({ execution: detail });
    expect((await app.request(`/${projectId}/workflow-executions/${executionId}/cancel`, { method: "POST" })).status).toBe(200);
    expect(cancel).toHaveBeenCalledWith(projectId, executionId);
  });

  it("rejects invalid JSON without invoking the service", async () => {
    const service = { start: vi.fn(), startInvocation: vi.fn(), get: vi.fn(), waitForTerminal: vi.fn(),
      activeForTab: vi.fn(), cancel: vi.fn(), close: vi.fn() } satisfies WorkflowExecutionService;
    const response = await createWorkflowExecutionRoutes(service).request(`/${projectId}/workflow-executions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    });
    expect(response.status).toBe(400);
    expect(service.start).not.toHaveBeenCalled();
  });
});
