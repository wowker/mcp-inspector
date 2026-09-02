import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AutomatedTestsExportEnvelope, ImportAutomatedTestsResult } from "../../../shared/testing/test-transfer.js";
import { ProjectNotFoundError } from "../../projects/project-service.js";
import { createTestTransferRoutes } from "../test-transfer-routes.js";
import { InvalidTestTransferError, type TestTransferService } from "../test-transfer-service.js";

const projectId = "00000000-0000-4000-8000-000000002101";
const exportedAt = "2026-09-01T00:00:00.000Z";
const envelope: AutomatedTestsExportEnvelope = {
  format: "mcp-inspector-automated-tests", version: 1, exportedAt,
  sourceProject: { id: projectId, name: "Source" }, connections: [],
  data: { testCases: [], testSuites: [] },
};
const result: ImportAutomatedTestsResult = {
  importedTestCases: 0, importedTestSuites: 0, skippedTestCases: 0, skippedTestSuites: 0,
  testCaseIds: {}, testSuiteIds: {},
};

function fixture(overrides: Partial<TestTransferService> = {}) {
  const service: TestTransferService = {
    exportProject: vi.fn(() => envelope), importProject: vi.fn(() => result), ...overrides,
  };
  const app = new Hono(); app.route("/api/projects", createTestTransferRoutes(service));
  return { app, service };
}

describe("test transfer routes", () => {
  it("exports definitions within the project boundary", async () => {
    const { app, service } = fixture();
    const response = await app.request(`/api/projects/${projectId}/automated-tests/export`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(envelope);
    expect(service.exportProject).toHaveBeenCalledWith(projectId);
  });

  it("imports only the explicitly confirmed envelope", async () => {
    const request = { envelope, bindings: {}, conflictPolicy: "COPY", confirm: true } as const;
    const { app, service } = fixture();
    const response = await app.request(`/api/projects/${projectId}/automated-tests/import`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(service.importProject).toHaveBeenCalledWith(projectId, request);
  });

  it("returns a stable client error for an invalid import", async () => {
    const { app } = fixture({ importProject: vi.fn(() => { throw new InvalidTestTransferError(); }) });
    const response = await app.request(`/api/projects/${projectId}/automated-tests/import`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "TEST_TRANSFER_INVALID" } });
  });

  it("maps a missing project without leaking storage details", async () => {
    const { app } = fixture({ exportProject: vi.fn(() => { throw new ProjectNotFoundError(); }) });
    const response = await app.request(`/api/projects/${projectId}/automated-tests/export`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } });
  });
});
