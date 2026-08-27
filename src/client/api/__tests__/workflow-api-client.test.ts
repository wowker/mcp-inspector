import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api-client.js";

const projectId = "00000000-0000-4000-8000-000000000621";
const connectionId = "00000000-0000-4000-8000-000000000622";
const workflow = {
  projectId, connectionId, toolName: "catalog/read item", revision: 1,
  before: { enabled: false, source: "" }, after: { enabled: false, source: "" },
  timeoutMs: 5_000,
  createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z",
};
const tabId = "00000000-0000-4000-8000-000000000623";
const executionId = "00000000-0000-4000-8000-000000000624";
const snapshotId = "00000000-0000-4000-8000-000000000625";
const execution = {
  id: executionId, projectId, connectionId, tabId, toolName: workflow.toolName,
  toolSnapshotId: snapshotId, idempotencyKey: "workflow-key", status: "queued",
  initialArguments: { sku: "A" }, finalArguments: null, workflowSnapshot: workflow,
  response: null, error: null, createdAt: "2026-08-27T00:00:00.000Z",
  startedAt: null, completedAt: null, durationMs: null, runs: [],
  events: [{ executionId, sequence: 1, kind: "workflow-status",
    occurredAt: "2026-08-27T00:00:00.000Z", payload: { status: "queued" } }],
};

describe("workflow API client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("URL-encodes the Tool and sends authenticated revision-safe updates", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ workflow }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    const client = createApiClient("session");
    await expect(client.getToolWorkflow(projectId, connectionId, workflow.toolName)).resolves.toEqual(workflow);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("catalog%2Fread%20item/workflow"), expect.objectContaining({
      headers: expect.objectContaining({ "X-MCP-Inspector-Session": "session" }),
    }));

    const updated = { ...workflow, revision: 2, before: { enabled: true, source: "export default async function before(ctx) {}" } };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ workflow: updated }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await expect(client.updateToolWorkflow(projectId, connectionId, workflow.toolName, {
      revision: 1, before: updated.before, after: updated.after, timeoutMs: updated.timeoutMs,
    })).resolves.toEqual(updated);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("/workflow"), expect.objectContaining({ method: "PUT" }));
  });

  it.each([
    ["foreign owner", { ...workflow, projectId: "00000000-0000-4000-8000-000000000699" }],
    ["wrong Tool", { ...workflow, toolName: "other" }],
    ["unknown field", { ...workflow, secret: "leak" }],
    ["invalid timeout", { ...workflow, timeoutMs: 60_001 }],
  ])("rejects a malformed successful %s response", async (_label, malformed) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ workflow: malformed }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await expect(createApiClient("session").getToolWorkflow(projectId, connectionId, workflow.toolName))
      .rejects.toThrow("Invalid workflow response");
  });

  it("validates scripts without executing them", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ validation: { valid: true, error: null } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    const client = createApiClient("session");
    await expect(client.validateToolWorkflow(projectId, connectionId, workflow.toolName, {
      phase: "before", source: "export default async function before(ctx) {}",
    })).resolves.toEqual({ valid: true, error: null });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/workflow/validate"), expect.objectContaining({
      method: "POST", body: expect.stringContaining('"phase":"before"'),
    }));

    const syntaxError = {
      code: "SYNTAX_ERROR", message: "Script contains invalid JavaScript", phase: "after",
      line: 1, column: 40, excerpt: null,
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ validation: { valid: false, error: syntaxError } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await expect(client.validateToolWorkflow(projectId, connectionId, workflow.toolName, {
      phase: "after", source: "export default function after( {",
    })).resolves.toEqual({ valid: false, error: syntaxError });
  });

  it("trial-runs a script with an abort signal and defensively decodes its result", async () => {
    const result = { phase: "before", arguments: { sku: "B" }, variables: {}, stagedEnvironment: [],
      logs: [{ level: "info", message: "prepared", line: 2, column: 3 }] };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    const controller = new AbortController();
    await expect(createApiClient("session").debugToolWorkflow(projectId, connectionId, workflow.toolName, {
      phase: "before", source: "export default function before() {}", arguments: { sku: "A" },
      response: null, timeoutMs: 5_000,
    }, controller.signal)).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/workflow/debug"), expect.objectContaining({
      method: "POST", signal: controller.signal,
    }));

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: { ...result, phase: "after" } }), { status: 200 }));
    await expect(createApiClient("session").debugToolWorkflow(projectId, connectionId, workflow.toolName, {
      phase: "before", source: "export default function before() {}", arguments: {}, response: null, timeoutMs: 5_000,
    })).rejects.toThrow("Invalid workflow debug response");
  });

  it("starts, reads, and cancels a project-owned workflow execution", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ execution }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ execution }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ cancelled: true }), { status: 200 }));
    const client = createApiClient("session");
    await expect(client.startWorkflowExecution(projectId, connectionId, tabId, "workflow-key", { sku: "A" }))
      .resolves.toEqual(execution);
    await expect(client.getWorkflowExecution(projectId, executionId)).resolves.toEqual(execution);
    await expect(client.cancelWorkflowExecution(projectId, executionId)).resolves.toBeUndefined();
  });

  it("loads the active workflow for a Tab or returns null", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ execution }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ execution: null }), { status: 200 }));
    const client = createApiClient("session");
    await expect(client.getActiveWorkflowExecution(projectId, tabId)).resolves.toEqual(execution);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining(`active?tabId=${tabId}`), expect.any(Object));
    await expect(client.getActiveWorkflowExecution(projectId, tabId)).resolves.toBeNull();
  });

  it.each([
    ["foreign execution", { ...execution, projectId: "00000000-0000-4000-8000-000000000699" }],
    ["foreign event", { ...execution, events: [{ ...execution.events[0], executionId: snapshotId }] }],
    ["event gap", { ...execution, events: [{ ...execution.events[0], sequence: 2 }] }],
  ])("rejects a malformed successful %s envelope", async (_label, malformed) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ execution: malformed }), { status: 200 }));
    await expect(createApiClient("session").getWorkflowExecution(projectId, executionId))
      .rejects.toThrow("Invalid workflow execution response");
  });
});
