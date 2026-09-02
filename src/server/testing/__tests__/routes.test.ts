import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { TestCaseDefinition } from "../../../shared/testing/test-case.js";
import { createTestCaseRoutes } from "../routes.js";
import { buildTestCaseCreationPreview } from "../../../shared/testing/creation-preview.js";
import type { TestCasePreviewService } from "../test-case-preview-service.js";
import {
  TestCaseRevisionConflictError,
  type TestCaseService,
} from "../test-case-service.js";

const projectId = "00000000-0000-4000-8000-000000000851";
const testCaseId = "00000000-0000-4000-8000-000000000852";
const connectionId = "00000000-0000-4000-8000-000000000853";
const mutation = {
  kind: "tool" as const,
  name: "List stores",
  description: "",
  tags: ["smoke"],
  isEnabled: true,
  target: { connectionId, toolName: "list_stores" },
  arguments: {},
  assertions: [],
  timeoutMs: 10_000,
};
const definition: TestCaseDefinition = {
  ...mutation,
  id: testCaseId,
  projectId,
  revision: 1,
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

function fixture(overrides: Partial<TestCaseService> = {}, previewOverrides: Partial<TestCasePreviewService> = {}) {
  const service: TestCaseService = {
    create: vi.fn(() => definition),
    list: vi.fn(() => ({ items: [], nextCursor: null })),
    get: vi.fn(() => definition),
    update: vi.fn(() => ({ ...definition, revision: 2 })),
    remove: vi.fn(),
    ...overrides,
  };
  const preview = buildTestCaseCreationPreview({
    source: { kind: "run", id: testCaseId }, connectionId, toolName: "list_stores", name: "baseline",
    argumentsValue: {}, toolStatus: "current",
  });
  const previews: TestCasePreviewService = {
    fromRun: vi.fn(() => preview),
    fromSavedItem: vi.fn(() => ({ ...preview, source: { kind: "saved-item" as const, id: testCaseId } })),
    ...previewOverrides,
  };
  const app = new Hono();
  app.route("/api/projects", createTestCaseRoutes(service, previews));
  return { app, service, previews };
}

describe("test case routes", () => {
  it("passes validated filters and cursor to the service", async () => {
    const { app, service } = fixture();
    const response = await app.request(`/api/projects/${projectId}/test-cases?kind=tool&connectionId=${connectionId}&tag=smoke&query=stores&limit=25&cursor=abc`);
    expect(response.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith(projectId, {
      kind: "tool", connectionId, tag: "smoke", query: "stores", limit: 25, cursor: "abc",
    });
  });

  it("creates, updates, reads, and deletes through the stable envelope", async () => {
    const { app, service } = fixture();
    const created = await app.request(`/api/projects/${projectId}/test-cases`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ testCase: definition });
    expect((await app.request(`/api/projects/${projectId}/test-cases/${testCaseId}`)).status).toBe(200);
    const updated = await app.request(`/api/projects/${projectId}/test-cases/${testCaseId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 1, definition: mutation }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({ testCase: { ...definition, revision: 2 } });
    const removed = await app.request(`/api/projects/${projectId}/test-cases/${testCaseId}`, { method: "DELETE" });
    expect(removed.status).toBe(204);
    expect(service.remove).toHaveBeenCalledWith(projectId, testCaseId);
  });

  it("returns stable validation and revision conflict errors", async () => {
    const invalid = await fixture().app.request(`/api/projects/${projectId}/test-cases?limit=nope`);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: {
      code: "TEST_CASE_INVALID", message: "Test case definition is invalid",
    } });
    const { app } = fixture({ update: vi.fn(() => { throw new TestCaseRevisionConflictError(); }) });
    const conflict = await app.request(`/api/projects/${projectId}/test-cases/${testCaseId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 1, definition: mutation }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: {
      code: "TEST_CASE_REVISION_CONFLICT", message: "Test case revision conflict",
    } });
  });

  it("creates source previews through POST bodies without placing source IDs in URLs", async () => {
    const { app, previews } = fixture();
    const response = await app.request(`/api/projects/${projectId}/test-cases/from-run`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: testCaseId }),
    });
    expect(response.status).toBe(200);
    expect(previews.fromRun).toHaveBeenCalledWith(projectId, testCaseId);
    expect(await response.json()).toMatchObject({ preview: { source: { kind: "run", id: testCaseId } } });
  });
});
