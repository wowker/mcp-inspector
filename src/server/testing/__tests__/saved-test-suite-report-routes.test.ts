import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { SavedTestSuiteReportService } from "../saved-test-suite-report-service.js";
import { createSavedTestSuiteReportRoutes } from "../saved-test-suite-report-routes.js";

const projectId = "00000000-0000-4000-8000-000000004101";
const suiteId = "00000000-0000-4000-8000-000000004102";
const suiteExecutionId = "00000000-0000-4000-8000-000000004103";
const reportId = "00000000-0000-4000-8000-000000004104";
const report = {
  id: reportId,
  projectId,
  suiteId,
  suiteExecutionId,
  name: "Release baseline",
  versionLabel: "1.0",
  note: null,
  revision: 1,
  createdAt: "2026-09-04T09:00:00.000Z",
  updatedAt: "2026-09-04T09:00:00.000Z",
};

describe("saved test suite report routes", () => {
  it("lists, creates, reads, updates, and deletes within the project boundary", async () => {
    const service: SavedTestSuiteReportService = {
      list: vi.fn(() => ({ items: [report], nextCursor: null })),
      create: vi.fn(() => report),
      get: vi.fn(() => report),
      update: vi.fn(() => ({ ...report, revision: 2 })),
      remove: vi.fn(),
    };
    const app = new Hono();
    app.route("/api/projects", createSavedTestSuiteReportRoutes(service));

    const listed = await app.request(`/api/projects/${projectId}/test-suite-reports?suiteId=${suiteId}&limit=25`);
    expect(listed.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith(projectId, { suiteId, limit: 25 });

    const input = { suiteId, suiteExecutionId, name: "Release baseline", versionLabel: "1.0", note: null };
    const created = await app.request(`/api/projects/${projectId}/test-suite-reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "save-report-1" },
      body: JSON.stringify(input),
    });
    expect(created.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith(projectId, "save-report-1", input);

    expect((await app.request(`/api/projects/${projectId}/test-suite-reports/${reportId}`)).status).toBe(200);
    const updated = await app.request(`/api/projects/${projectId}/test-suite-reports/${reportId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 1, name: "Updated" }),
    });
    expect(updated.status).toBe(200);
    expect((await app.request(`/api/projects/${projectId}/test-suite-reports/${reportId}`, { method: "DELETE" })).status)
      .toBe(204);
  });
});
