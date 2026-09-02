import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeMcpSession } from "../../../../test-support/fake-mcp-session.js";
import { createConnectionService } from "../../connections/connection-service.js";
import { createEnvironmentService } from "../../environment/environment-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { createRunService } from "../../runs/run-service.js";
import { createTabService } from "../../tabs/tab-service.js";
import { ToolRepository } from "../../tools/tool-repository.js";
import { createToolService } from "../../tools/tool-service.js";
import { createWorkflowExecutionService } from "../../workflows/workflow-execution-service.js";
import { createWorkflowService } from "../../workflows/workflow-service.js";
import { createTestCaseService } from "../test-case-service.js";
import { TestExecutionConflictError, createTestExecutionService } from "../test-execution-service.js";

const projectId = "00000000-0000-4000-8000-000000001601";
const connectionId = "00000000-0000-4000-8000-000000001602";
const headerConnectionId = "00000000-0000-4000-8000-000000001603";

describe("TestExecutionService", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-test-execution-service-")); roots.push(dataRoot);
    let id = 1_610;
    const createId = () => `00000000-0000-4000-8000-${String(id++).padStart(12, "0")}`;
    let tick = 0;
    const now = () => new Date(1_788_220_800_000 + tick++ * 10);
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Automated execution");
    const session = new FakeMcpSession();
    const sessions = new Map([[connectionId, session]]);
    const connectionIds = [connectionId];
    session.call = async ({ arguments: args }) => ({
      content: [], structuredContent: { value: Number(args.a) + 1 },
    });
    const connections = createConnectionService(projects, {
      createId: () => connectionIds.shift()!,
      sessionFactory: async (connection) => sessions.get(connection.id)!,
    });
    connections.create(projectId, {
      name: "Bearer fixture", url: "https://same.example.test/mcp", transport: "streamable-http",
      authMode: "bearer", bearerToken: "{{API_TOKEN}}", timeoutMs: 10_000,
    });
    new ToolRepository(projects.open(projectId)).replaceCatalog(projectId, connectionId, [{
      id: createId(), name: "sum", contentHash: "a".repeat(64), definitionJson: JSON.stringify({
        name: "sum", inputSchema: { type: "object", required: ["a"], properties: { a: { type: "number" } } },
      }),
    }], now().toISOString());
    const tools = createToolService(projects, connections);
    const tabs = createTabService(projects, connections, { tools, createId });
    const runs = createRunService(projects, connections, tabs, { createId, now });
    const workflows = createWorkflowService(projects, tools);
    const environment = createEnvironmentService(projects, connections);
    environment.set(projectId, connectionId, "API_TOKEN", { value: "fixture-token", secret: true });
    const workflowExecutions = createWorkflowExecutionService({
      projects, connections, tabs, workflows, environment, runs, createId, now,
    });
    const testCases = createTestCaseService(projects, { createId, now });
    const executions = createTestExecutionService({
      projects, connections, testCases, runs, workflows, workflowExecutions, environment, createId, now,
    });
    return { projects, connections, session, sessions, connectionIds, tools, runs, workflows, workflowExecutions,
      environment, testCases, executions, createId, now };
  }

  async function close(value: ReturnType<typeof fixture>) {
    await value.executions.close(); await value.workflowExecutions.close();
    await value.runs.close(); await value.connections.close(); value.projects.close();
  }

  it("executes a Tool without a hidden Tab and persists passed assertions", async () => {
    const value = fixture();
    try {
      const testCase = value.testCases.create(projectId, {
        kind: "tool", name: "Sum", description: "", tags: [], isEnabled: true,
        target: { connectionId, toolName: "sum" }, arguments: { a: 1 }, timeoutMs: 10_000,
        assertions: [{ id: "value", source: "MCP_RESULT", path: "$.structuredContent.value", operator: "EQUALS", expected: 2 }],
      });
      await value.connections.connect(projectId, connectionId);
      const started = value.executions.start({ projectId, testCaseId: testCase.id, idempotencyKey: "run-once" });
      const completed = await value.executions.waitForTerminal(projectId, started.id);
      expect(completed).toMatchObject({
        status: "PASSED",
        definitionSnapshot: { id: testCase.id, revision: 1, target: { connectionId } },
        steps: [{ status: "PASSED", workflowExecutionId: null }],
        assertions: [{ assertionId: "value", status: "PASSED", actual: 2 }],
      });
      expect(value.runs.get(projectId, completed.steps[0].runId!).tabId).toBeNull();
      expect(JSON.stringify(completed)).not.toContain("fixture-token");
    } finally { await close(value); }
  });

  it("updates equality baselines only after explicit confirmation", async () => {
    const value = fixture();
    try {
      const testCase = value.testCases.create(projectId, {
        kind: "tool", name: "Explicit baseline", description: "", tags: [], isEnabled: true,
        target: { connectionId, toolName: "sum" }, arguments: { a: 1 }, timeoutMs: 10_000,
        assertions: [{ id: "value", source: "MCP_RESULT", path: "$.structuredContent.value", operator: "EQUALS", expected: 1 }],
      });
      await value.connections.connect(projectId, connectionId);
      const started = value.executions.start({ projectId, testCaseId: testCase.id, idempotencyKey: "baseline-run" });
      const completed = await value.executions.waitForTerminal(projectId, started.id);
      expect(completed).toMatchObject({ status: "FAILED", assertions: [{ actual: 2, expected: 1 }] });
      expect(() => value.executions.updateBaseline(projectId, completed.id, { revision: 1, confirm: false }))
        .toThrow("Baseline update requires explicit confirmation");
      expect(value.testCases.get(projectId, testCase.id)).toMatchObject({ revision: 1, assertions: [{ expected: 1 }] });
      expect(value.executions.updateBaseline(projectId, completed.id, { revision: 1, confirm: true }))
        .toMatchObject({ updatedAssertions: 1, testCase: { revision: 2, assertions: [{ expected: 2 }] } });
    } finally { await close(value); }
  });

  it("uses the existing workflow invocation seam and links its main Run", async () => {
    const value = fixture();
    try {
      value.workflows.update(projectId, connectionId, "sum", {
        revision: 1,
        before: { enabled: true, source: "export default function before(ctx) { ctx.arguments.set('a', 4); }" },
        after: { enabled: false, source: "" }, timeoutMs: 5_000,
      });
      const testCase = value.testCases.create(projectId, {
        kind: "tool", name: "Workflow sum", description: "", tags: [], isEnabled: true,
        target: { connectionId, toolName: "sum" }, arguments: {}, timeoutMs: 10_000,
        assertions: [{ id: "value", source: "MCP_RESULT", path: "$.structuredContent.value", operator: "EQUALS", expected: 5 }],
      });
      await value.connections.connect(projectId, connectionId);
      const started = value.executions.start({ projectId, testCaseId: testCase.id, idempotencyKey: "workflow-once" });
      const completed = await value.executions.waitForTerminal(projectId, started.id);
      expect(completed).toMatchObject({
        status: "PASSED", steps: [{ status: "PASSED", runId: expect.any(String), workflowExecutionId: expect.any(String) }],
      });
      expect(value.runs.get(projectId, completed.steps[0].runId!).request.arguments).toEqual({ a: 4 });
      expect(value.runs.get(projectId, completed.steps[0].runId!).tabId).toBeNull();
    } finally { await close(value); }
  });

  it("deduplicates one intent and rejects the same key after the definition changes", async () => {
    const value = fixture();
    try {
      const testCase = value.testCases.create(projectId, {
        kind: "tool", name: "Idempotent", description: "", tags: [], isEnabled: true,
        target: { connectionId, toolName: "sum" }, arguments: { a: 1 }, timeoutMs: 10_000, assertions: [],
      });
      await value.connections.connect(projectId, connectionId);
      const first = value.executions.start({ projectId, testCaseId: testCase.id, idempotencyKey: "same-intent" });
      expect(value.executions.start({ projectId, testCaseId: testCase.id, idempotencyKey: "same-intent" }).id).toBe(first.id);
      value.testCases.update(projectId, testCase.id, { revision: 1, definition: {
        kind: "tool", name: "Changed", description: "", tags: [], isEnabled: true,
        target: { connectionId, toolName: "sum" }, arguments: { a: 2 }, timeoutMs: 10_000, assertions: [],
      } });
      expect(() => value.executions.start({ projectId, testCaseId: testCase.id, idempotencyKey: "same-intent" }))
        .toThrow(TestExecutionConflictError);
      await value.executions.waitForTerminal(projectId, first.id);
      expect(value.session.calls).toHaveLength(1);
    } finally { await close(value); }
  });

  it("keeps authentication and execution identity isolated for connections sharing one URL", async () => {
    const value = fixture();
    try {
      const headerSession = new FakeMcpSession();
      headerSession.call = async () => ({ content: [], structuredContent: { connection: "header" } });
      value.sessions.set(headerConnectionId, headerSession);
      value.connectionIds.push(headerConnectionId);
      value.connections.create(projectId, {
        name: "Header fixture", url: "https://same.example.test/mcp", transport: "streamable-http",
        authMode: "none", headers: { "X-API-Key": "{{HEADER_TOKEN}}" }, timeoutMs: 10_000,
      });
      new ToolRepository(value.projects.open(projectId)).replaceCatalog(projectId, headerConnectionId, [{
        id: value.createId(), name: "sum", contentHash: "b".repeat(64), definitionJson: JSON.stringify({
          name: "sum", inputSchema: { type: "object", properties: {} },
        }),
      }], value.now().toISOString());
      const environment = createEnvironmentService(value.projects, value.connections);
      environment.set(projectId, headerConnectionId, "HEADER_TOKEN", { value: "header-secret", secret: true });
      const testCase = value.testCases.create(projectId, {
        kind: "tool", name: "Header identity", description: "", tags: [], isEnabled: true,
        target: { connectionId: headerConnectionId, toolName: "sum" }, arguments: {}, timeoutMs: 10_000,
        assertions: [{ id: "connection", source: "MCP_RESULT", path: "$.structuredContent.connection", operator: "EQUALS", expected: "header" }],
      });
      await value.connections.connect(projectId, connectionId);
      await value.connections.connect(projectId, headerConnectionId);
      const started = value.executions.start({ projectId, testCaseId: testCase.id, idempotencyKey: "header-only" });
      const completed = await value.executions.waitForTerminal(projectId, started.id);
      expect(completed.status).toBe("PASSED");
      expect(headerSession.calls).toHaveLength(1);
      expect(value.session.calls).toHaveLength(0);
      expect(completed.definitionSnapshot).toMatchObject({ target: { connectionId: headerConnectionId } });
    } finally { await close(value); }
  });

  it("executes a multi-step scenario with execution-scoped variables and inspectable Runs", async () => {
    const value = fixture();
    try {
      const testCase = value.testCases.create(projectId, {
        kind: "scenario", name: "Two sums", description: "", tags: [], isEnabled: true,
        inputs: [{ name: "initial", description: "", isRequired: true }], assertions: [], failurePolicy: "STOP",
        steps: [{ id: "first", name: "First", target: { connectionId, toolName: "sum" }, fixedArguments: {},
          mappings: [{ targetPath: "$.a", source: { kind: "SCENARIO_INPUT", name: "initial" }, isRequired: true }],
          extractors: [{ name: "next", source: "RESULT", path: "$.structuredContent.value", isRequired: true }],
          assertions: [], condition: null, polling: null, onFailure: "STOP" },
        { id: "second", name: "Second", target: { connectionId, toolName: "sum" }, fixedArguments: {},
          mappings: [{ targetPath: "$.a", source: { kind: "VARIABLE", name: "next" }, isRequired: true }],
          extractors: [], assertions: [{ id: "final", source: "MCP_RESULT", path: "$.structuredContent.value",
            operator: "EQUALS", expected: 3 }], condition: null, polling: null, onFailure: "STOP" }],
        cleanupSteps: [],
      });
      await value.connections.connect(projectId, connectionId);
      const started = value.executions.start({ projectId, testCaseId: testCase.id,
        idempotencyKey: "scenario-once", inputs: { initial: 1 } });
      const completed = await value.executions.waitForTerminal(projectId, started.id);
      expect(completed).toMatchObject({
        status: "PASSED", inputs: { initial: 1 },
        steps: [{ stepId: "first", status: "PASSED", resolvedArguments: { a: 1 }, runId: expect.any(String) },
          { stepId: "second", status: "PASSED", resolvedArguments: { a: 2 }, runId: expect.any(String) }],
        assertions: [{ assertionId: "final", status: "PASSED", actual: 3 }],
      });
      expect(completed.steps.every(({ runId }) => value.runs.get(projectId, runId!).tabId === null)).toBe(true);
      expect(value.environment.resolve(projectId, connectionId)).toMatchObject({ project: {}, server: { API_TOKEN: "fixture-token" } });
    } finally { await close(value); }
  });
});
