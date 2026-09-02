import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api-client.js";
import { buildTestCaseCreationPreview } from "../../../shared/testing/creation-preview.js";

const projectId = "00000000-0000-4000-8000-000000000861";
const testCaseId = "00000000-0000-4000-8000-000000000862";
const connectionId = "00000000-0000-4000-8000-000000000863";
const mutation = {
  kind: "tool" as const, name: "List stores", description: "", tags: ["smoke"], isEnabled: true,
  target: { connectionId, toolName: "list_stores" }, arguments: {}, assertions: [], timeoutMs: 10_000,
};
const definition = {
  ...mutation, id: testCaseId, projectId, revision: 1,
  createdAt: "2026-08-31T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z",
};
const summary = {
  id: testCaseId, projectId, kind: "tool", name: "List stores", description: "", tags: ["smoke"],
  revision: 1, isEnabled: true, targetConnectionIds: [connectionId],
  createdAt: definition.createdAt, updatedAt: definition.updatedAt,
};
const executionId = "00000000-0000-4000-8000-000000000864";
const execution = {
  id: executionId, projectId, testCaseId, testCaseRevision: 1, status: "QUEUED",
  createdAt: definition.createdAt, startedAt: null, completedAt: null, durationMs: null, error: null,
  definitionSnapshot: definition, inputs: {}, steps: [], assertions: [],
};
const suiteId = "00000000-0000-4000-8000-000000000865";
const suiteMemberId = "00000000-0000-4000-8000-000000000866";
const suiteMutation = { name: "Suite", description: "", tags: [], members: [
  { id: suiteMemberId, testCaseId, position: 0, isEnabled: true },
], executionPolicy: { concurrency: 2, stopOnFailure: false } };
const suite = { ...suiteMutation, id: suiteId, projectId, revision: 1,
  createdAt: definition.createdAt, updatedAt: definition.updatedAt };
const suiteSummary = { id: suiteId, projectId, name: "Suite", description: "", tags: [], revision: 1,
  memberCount: 1, executionPolicy: suiteMutation.executionPolicy,
  createdAt: definition.createdAt, updatedAt: definition.updatedAt };
const suiteExecutionId = "00000000-0000-4000-8000-000000000867";
const suiteExecution = { id: suiteExecutionId, projectId, suiteId, suiteRevision: 1, status: "QUEUED",
  suiteSnapshot: suite, summary: null, error: null, createdAt: definition.createdAt, startedAt: null,
  completedAt: null, durationMs: null, items: [] };

describe("test case API client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("lists, reads, creates, updates, and deletes test definitions", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [summary], nextCursor: "next" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ testCase: definition }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ testCase: definition }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ testCase: { ...definition, revision: 2 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = createApiClient("session");
    await expect(api.listTestCases(projectId, {
      kind: "tool", connectionId, tag: "smoke", query: "stores", cursor: "first", limit: 25,
    })).resolves.toEqual({ items: [summary], nextCursor: "next" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `kind=tool&connectionId=${connectionId}&tag=smoke&query=stores&cursor=first&limit=25`,
    );
    await expect(api.getTestCase(projectId, testCaseId)).resolves.toEqual(definition);
    await expect(api.createTestCase(projectId, mutation)).resolves.toEqual(definition);
    await expect(api.updateTestCase(projectId, testCaseId, { revision: 1, definition: mutation }))
      .resolves.toEqual({ ...definition, revision: 2 });
    await api.deleteTestCase(projectId, testCaseId);
    expect(fetchMock.mock.calls[4]?.[1]).toEqual(expect.objectContaining({ method: "DELETE" }));
  });

  it("rejects foreign project identities and invalid revision transitions", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ ...summary, projectId: connectionId }], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ testCase: { ...definition, revision: 3 } }), { status: 200 }));
    const api = createApiClient("session");
    await expect(api.listTestCases(projectId)).rejects.toThrow("Invalid test case response");
    await expect(api.updateTestCase(projectId, testCaseId, { revision: 1, definition: mutation }))
      .rejects.toThrow("Invalid test case response");
  });

  it("requests safe Run and saved-item creation previews with IDs in POST bodies", async () => {
    const preview = buildTestCaseCreationPreview({
      source: { kind: "run", id: testCaseId }, connectionId, toolName: "list_stores", name: "baseline",
      argumentsValue: {}, toolStatus: "current",
    });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ preview }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ preview: { ...preview, source: { kind: "saved-item", id: testCaseId } } }), { status: 200 }));
    const api = createApiClient("session");
    await expect(api.previewTestCaseFromRun(projectId, testCaseId)).resolves.toEqual(preview);
    await expect(api.previewTestCaseFromSavedItem(projectId, testCaseId)).resolves.toMatchObject({ source: { kind: "saved-item" } });
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain(testCaseId);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: "POST", body: JSON.stringify({ id: testCaseId }) }));
  });

  it("starts, reads, and cancels a test execution without placing the idempotency key in the URL", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ execution }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ execution }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ cancelled: true }), { status: 200 }));
    const api = createApiClient("session");
    await expect(api.startTestExecution(projectId, testCaseId, "intent-1", { confirmDestructive: true })).resolves.toEqual(execution);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain("intent-1");
    expect(options).toEqual(expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ "Idempotency-Key": "intent-1" }),
      body: JSON.stringify({ confirmDestructive: true }),
    }));
    await expect(api.getTestExecution(projectId, executionId)).resolves.toEqual(execution);
    await expect(api.cancelTestExecution(projectId, executionId)).resolves.toBeUndefined();
  });

  it("lists validated test execution report summaries", async () => {
    const report = { id: executionId, projectId, testCaseId, testCaseRevision: 1,
      testCaseName: "List stores", testCaseKind: "tool", status: "PASSED",
      assertionSummary: { total: 1, passed: 1, failed: 0, error: 0 },
      createdAt: definition.createdAt, startedAt: definition.createdAt,
      completedAt: definition.updatedAt, durationMs: 12, error: null };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [report], nextCursor: "next" }), { status: 200 }));
    const api = createApiClient("session");
    await expect(api.listTestExecutions(projectId, { limit: 25 })).resolves.toEqual({ items: [report], nextCursor: "next" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("test-executions?limit=25");
  });

  it("updates a baseline with an explicit confirmation body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ testCase: { ...definition, revision: 2 }, updatedAssertions: 1 }), { status: 200 }));
    const api = createApiClient("session");
    await expect(api.updateTestExecutionBaseline(projectId, executionId, { revision: 1, confirm: true }))
      .resolves.toMatchObject({ testCase: { revision: 2 }, updatedAssertions: 1 });
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: "POST", body: JSON.stringify({ revision: 1, confirm: true }),
    }));
  });

  it("lists, reads, creates, updates, and deletes test suites", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [suiteSummary], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ testSuite: suite }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ testSuite: suite }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ testSuite: { ...suite, revision: 2 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = createApiClient("session");
    await expect(api.listTestSuites(projectId)).resolves.toEqual({ items: [suiteSummary], nextCursor: null });
    await expect(api.getTestSuite(projectId, suiteId)).resolves.toEqual(suite);
    await expect(api.createTestSuite(projectId, suiteMutation)).resolves.toEqual(suite);
    await expect(api.updateTestSuite(projectId, suiteId, { revision: 1, definition: suiteMutation }))
      .resolves.toEqual({ ...suite, revision: 2 });
    await api.deleteTestSuite(projectId, suiteId);
    expect(fetchMock.mock.calls[4]?.[1]).toEqual(expect.objectContaining({ method: "DELETE" }));
  });

  it("starts, reads, and cancels a suite execution with header-only idempotency", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ execution: suiteExecution }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ execution: suiteExecution }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ cancelled: true }), { status: 200 }));
    const api = createApiClient("session");
    await expect(api.startTestSuiteExecution(projectId, suiteId, "suite-intent", {})).resolves.toEqual(suiteExecution);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("suite-intent");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ "Idempotency-Key": "suite-intent" }),
    }));
    await expect(api.getTestSuiteExecution(projectId, suiteExecutionId)).resolves.toEqual(suiteExecution);
    await expect(api.cancelTestSuiteExecution(projectId, suiteExecutionId)).resolves.toBeUndefined();
  });

  it("exports and imports the versioned automated-test envelope", async () => {
    const envelope = { format: "mcp-inspector-automated-tests", version: 1, exportedAt: definition.createdAt,
      sourceProject: { id: projectId, name: "Project" }, connections: [{ alias: "server-1", sourceConnectionId: connectionId, name: "API" }],
      data: { testCases: [definition], testSuites: [suite] } } as const;
    const result = { importedTestCases: 1, importedTestSuites: 1, skippedTestCases: 0, skippedTestSuites: 0,
      testCaseIds: { [testCaseId]: testCaseId }, testSuiteIds: { [suiteId]: suiteId } };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(envelope), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }));
    const api = createApiClient("session");
    await expect(api.exportAutomatedTests(projectId)).resolves.toEqual(envelope);
    const input = { envelope, bindings: { "server-1": connectionId }, conflictPolicy: "COPY", confirm: true };
    await expect(api.importAutomatedTests(projectId, input)).resolves.toEqual(result);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ method: "POST", body: JSON.stringify(input) }));
  });
});
