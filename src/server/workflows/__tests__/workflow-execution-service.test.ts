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
import { createWorkflowExecutionService } from "../workflow-execution-service.js";
import { createWorkflowService } from "../workflow-service.js";

const projectId = "00000000-0000-4000-8000-000000001101";
const connectionId = "00000000-0000-4000-8000-000000001102";

describe("WorkflowExecutionService", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture(afterSource = `export default function after(ctx) {
    ctx.env.set("lastTotal", ctx.json.get(ctx.response, "$.structuredContent.total"), { scope: "project" });
    ctx.log.info("stored total");
  }`) {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-workflow-execution-")); roots.push(dataRoot);
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Workflows");
    const session = new FakeMcpSession();
    session.call = async ({ name, arguments: args }) => name === "lookup"
      ? { content: [], structuredContent: { value: 3 } }
      : { content: [], structuredContent: { total: Number(args.a) * 2 } };
    const connections = createConnectionService(projects, {
      createId: () => connectionId,
      sessionFactory: async () => session,
    });
    connections.create(projectId, {
      name: "Current", url: "https://example.test/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 10_000,
    });
    let snapshot = 1_110;
    const nextSnapshot = () => `00000000-0000-4000-8000-${String(snapshot++).padStart(12, "0")}`;
    new ToolRepository(projects.open(projectId)).replaceCatalog(projectId, connectionId, [
      { id: nextSnapshot(), name: "main", contentHash: "a".repeat(64), definitionJson: JSON.stringify({
        name: "main", inputSchema: { type: "object", required: ["a"], properties: { a: { type: "number" } } },
      }) },
      { id: nextSnapshot(), name: "lookup", contentHash: "b".repeat(64), definitionJson: JSON.stringify({
        name: "lookup", inputSchema: { type: "object" },
      }) },
    ], "2026-08-27T00:00:00.000Z");
    const tools = createToolService(projects, connections);
    const tabId = "00000000-0000-4000-8000-000000001120";
    const tabs = createTabService(projects, connections, { tools, createId: () => tabId });
    const tab = tabs.open({ projectId, connectionId, toolName: "main" });
    const workflowService = createWorkflowService(projects, tools);
    workflowService.update(projectId, connectionId, "main", {
      revision: 1,
      before: { enabled: true, source: `export default async function before(ctx) {
        const found = await ctx.tools.call({ server: "current", name: "lookup", arguments: {} });
        ctx.arguments.set("a", ctx.json.get(found, "$.structuredContent.value"));
        ctx.log.info("resolved input", { a: ctx.arguments.get("a") });
      }` },
      after: { enabled: true, source: afterSource },
      timeoutMs: 5_000,
    });
    const environment = createEnvironmentService(projects, connections);
    let runId = 1_130;
    const runs = createRunService(projects, connections, tabs, {
      createId: () => `00000000-0000-4000-8000-${String(runId++).padStart(12, "0")}`,
    });
    const executionId = "00000000-0000-4000-8000-000000001140";
    const executions = createWorkflowExecutionService({
      projects, connections, tabs, workflows: workflowService, environment, runs,
      createId: () => executionId,
    });
    return { projects, connections, environment, runs, executions, session, tab, workflowService };
  }

  async function terminal(executions: ReturnType<typeof createWorkflowExecutionService>, id: string) {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const execution = executions.get(projectId, id);
      if (["succeeded", "failed", "cancelled", "interrupted"].includes(execution.status)) return execution;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Workflow did not finish");
  }

  it("runs before helper, main and after with durable child Runs and atomic variables", async () => {
    const fixtureValue = fixture();
    const { projects, connections, environment, runs, executions, session, tab } = fixtureValue;
    try {
      expect(() => executions.start({ projectId, connectionId: "00000000-0000-4000-8000-000000001199",
        tabId: tab.id, idempotencyKey: "wrong-server", arguments: { a: 1 } })).toThrow(/different connection/i);
      await connections.connect(projectId, connectionId);
      const started = executions.start({ projectId, connectionId, tabId: tab.id, idempotencyKey: "flow-1", arguments: {} });
      const completed = await terminal(executions, started.id);
      expect(completed.status).toBe("succeeded");
      expect(completed.finalArguments).toEqual({ a: 3 });
      expect(completed.response).toEqual({ content: [], structuredContent: { total: 6 } });
      expect(completed.runs.map(({ phase }) => phase)).toEqual(["helper-before", "main"]);
      expect(runs.get(projectId, completed.runs[0].runId).tabId).toBeNull();
      expect(runs.get(projectId, completed.runs[1].runId).tabId).toBe(tab.id);
      expect(environment.resolve(projectId, connectionId).project).toEqual({ lastTotal: 6 });
      expect(completed.events.filter(({ kind }) => kind === "script-log")).toHaveLength(2);
      expect(session.calls.map(({ name }) => name)).toEqual(["lookup", "main"]);
    } finally {
      await executions.close(); await runs.close(); await connections.close(); projects.close();
    }
  });

  it("validates final arguments after the before script and never starts an invalid main Run", async () => {
    const fixtureValue = fixture();
    const { projects, connections, runs, executions, session, tab, workflowService } = fixtureValue;
    try {
      workflowService.update(projectId, connectionId, "main", {
        revision: 2,
        before: { enabled: true, source: "export default function before() {}" },
        after: { enabled: false, source: "" }, timeoutMs: 5_000,
      });
      await connections.connect(projectId, connectionId);
      const started = executions.start({ projectId, connectionId, tabId: tab.id,
        idempotencyKey: "flow-invalid-final-arguments", arguments: {} });
      const completed = await terminal(executions, started.id);

      expect(completed.status).toBe("failed");
      expect(completed.finalArguments).toEqual({});
      expect(completed.error).toEqual({
        code: "INVALID_ARGUMENTS",
        message: "前置脚本执行后的参数不符合 Tool Schema：/a 请输入必填参数",
      });
      expect(session.calls).toHaveLength(0);
      expect(runs.list(projectId).runs).toHaveLength(0);
    } finally {
      await executions.close(); await runs.close(); await connections.close(); projects.close();
    }
  });

  it("does not commit staged variables when a later after assertion fails", async () => {
    const fixtureValue = fixture(`export default function after(ctx) {
      ctx.env.set("shouldNotExist", 1, { scope: "server" });
      ctx.assert.equal(1, 2, "expected failure");
    }`);
    const { projects, connections, environment, runs, executions, tab } = fixtureValue;
    try {
      await connections.connect(projectId, connectionId);
      const started = executions.start({ projectId, connectionId, tabId: tab.id, idempotencyKey: "flow-fail", arguments: { a: 1 } });
      const completed = await terminal(executions, started.id);
      expect(completed.status).toBe("failed");
      expect(completed.error).toMatchObject({ code: "RUNTIME_ERROR" });
      expect(environment.resolve(projectId, connectionId).server).toEqual({});
    } finally {
      await executions.close(); await runs.close(); await connections.close(); projects.close();
    }
  });

  it("deduplicates canonically equivalent arguments and rejects a changed idempotent request", async () => {
    const fixtureValue = fixture();
    const { projects, connections, runs, executions, session, tab } = fixtureValue;
    try {
      await connections.connect(projectId, connectionId);
      const first = executions.start({ projectId, connectionId, tabId: tab.id, idempotencyKey: "flow-dedup",
        arguments: { nested: { b: 2, a: 1 }, a: 1 } });
      const duplicate = executions.start({ projectId, connectionId, tabId: tab.id, idempotencyKey: "flow-dedup",
        arguments: { a: 1, nested: { a: 1, b: 2 } } });
      expect(duplicate.id).toBe(first.id);
      expect(() => executions.start({ projectId, connectionId, tabId: tab.id, idempotencyKey: "flow-dedup",
        arguments: { a: 2, nested: { a: 1, b: 2 } } })).toThrow(/idempotency conflict/i);
      await terminal(executions, first.id);
      expect(session.calls.map(({ name }) => name)).toEqual(["lookup", "main"]);
    } finally {
      await executions.close(); await runs.close(); await connections.close(); projects.close();
    }
  });

  it("redacts secret environment values from parent logs and terminal records", async () => {
    const fixtureValue = fixture();
    const { projects, connections, environment, runs, executions, tab, workflowService } = fixtureValue;
    try {
      environment.set(projectId, connectionId, "apiToken", { value: "very-secret-token", secret: true });
      workflowService.update(projectId, connectionId, "main", {
        revision: 2,
        before: { enabled: true, source: `export default function before(ctx) {
          const token = ctx.env.get("apiToken", { scope: "server" });
          ctx.log.info("using " + token, { token });
          ctx.arguments.set("a", 2);
        }` },
        after: { enabled: false, source: "" }, timeoutMs: 5_000,
      });
      await connections.connect(projectId, connectionId);
      const started = executions.start({ projectId, connectionId, tabId: tab.id, idempotencyKey: "flow-secret", arguments: { a: 1 } });
      const completed = await terminal(executions, started.id);
      expect(JSON.stringify(completed)).not.toContain("very-secret-token");
      expect(JSON.stringify(completed.events)).toContain("[REDACTED]");
    } finally {
      await executions.close(); await runs.close(); await connections.close(); projects.close();
    }
  });

  it("blocks secret environment values from being persisted in main Tool arguments", async () => {
    const fixtureValue = fixture();
    const { projects, connections, environment, runs, executions, tab, workflowService, session } = fixtureValue;
    try {
      environment.set(projectId, connectionId, "apiToken", { value: "very-secret-token", secret: true });
      workflowService.update(projectId, connectionId, "main", {
        revision: 2,
        before: { enabled: true, source: `export default function before(ctx) {
          ctx.arguments.set("token", ctx.env.get("apiToken", { scope: "server" }));
        }` },
        after: { enabled: false, source: "" }, timeoutMs: 5_000,
      });
      await connections.connect(projectId, connectionId);
      const started = executions.start({ projectId, connectionId, tabId: tab.id, idempotencyKey: "flow-secret-argument", arguments: { a: 1 } });
      const completed = await terminal(executions, started.id);
      expect(completed.status).toBe("failed");
      expect(JSON.stringify(completed)).not.toContain("very-secret-token");
      expect(session.calls).toHaveLength(0);
      expect(runs.list(projectId).runs).toHaveLength(0);
    } finally {
      await executions.close(); await runs.close(); await connections.close(); projects.close();
    }
  });
});
