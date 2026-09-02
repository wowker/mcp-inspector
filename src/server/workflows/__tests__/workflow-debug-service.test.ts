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
import { createWorkflowDebugService } from "../workflow-debug-service.js";

const projectId = "00000000-0000-4000-8000-000000001201";
const connectionId = "00000000-0000-4000-8000-000000001202";
const firstDuplicateId = "00000000-0000-4000-8000-000000001203";
const secondDuplicateId = "00000000-0000-4000-8000-000000001204";

describe("WorkflowDebugService", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-workflow-debug-")); roots.push(dataRoot);
    const projects = createProjectService({ dataRoot, createId: () => projectId }); projects.create("Debug");
    const session = new FakeMcpSession();
    session.call = async ({ name }) => name === "lookup"
      ? { content: [], structuredContent: { value: 7 } }
      : { content: [], structuredContent: {} };
    const connectionIds = [connectionId, firstDuplicateId, secondDuplicateId];
    const connections = createConnectionService(projects, {
      createId: () => connectionIds.shift() ?? crypto.randomUUID(),
      sessionFactory: async () => session,
    });
    connections.create(projectId, { name: "Current", url: "https://example.test/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 10_000 });
    let snapshot = 1_210;
    new ToolRepository(projects.open(projectId)).replaceCatalog(projectId, connectionId, ["main", "lookup"].map((name) => ({
      id: `00000000-0000-4000-8000-${String(snapshot++).padStart(12, "0")}`, name,
      contentHash: name === "main" ? "a".repeat(64) : "b".repeat(64),
      definitionJson: JSON.stringify({ name, inputSchema: { type: "object" },
        ...(name === "lookup" ? { annotations: { destructiveHint: true } } : {}) }),
    })), "2026-08-27T00:00:00.000Z");
    const tools = createToolService(projects, connections);
    const tabs = createTabService(projects, connections, { tools });
    let run = 1_220;
    const runs = createRunService(projects, connections, tabs, {
      createId: () => `00000000-0000-4000-8000-${String(run++).padStart(12, "0")}`,
    });
    const environment = createEnvironmentService(projects, connections);
    const debug = createWorkflowDebugService({ connections, tools, environment, runs });
    return { projects, connections, environment, runs, debug, session };
  }

  it("returns changed arguments, logs and staged variables without committing them", async () => {
    const value = fixture();
    try {
      value.environment.set(projectId, connectionId, "token", { value: "secret-value", secret: true });
      const result = await value.debug.run(projectId, connectionId, "main", {
        phase: "before", arguments: { a: 1 }, response: null, timeoutMs: 5_000,
        source: `export default function before(ctx) {
          const token = ctx.env.get("token", { scope: "server" });
          ctx.arguments.set("a", 9);
          ctx.env.set("candidate", token, { scope: "server", secret: true });
          ctx.log.info("token=" + token);
        }`,
      });
      expect(result.arguments).toEqual({ a: 9 });
      expect(JSON.stringify(result)).not.toContain("secret-value");
      expect(result.logs[0]?.message).toContain("[REDACTED]");
      expect(result.stagedEnvironment).toEqual([{ scope: "server", name: "candidate", value: "[REDACTED]", secret: true }]);
      expect(value.environment.resolve(projectId, connectionId).server).toEqual({ token: "secret-value" });

      let thrown: unknown;
      try {
        await value.debug.run(projectId, connectionId, "main", {
          phase: "before", arguments: {}, response: null, timeoutMs: 5_000,
          source: `export default function before(ctx) {
            ctx.assert.true(false, "failed with " + ctx.env.get("token", { scope: "server" }));
          }`,
        });
      } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain("[REDACTED]");
      expect((thrown as Error).message).not.toContain("secret-value");
    } finally {
      await value.debug.close(); await value.runs.close(); await value.connections.close(); value.projects.close();
    }
  });

  it("records helper calls as ordinary internal Runs and rejects secret-bearing arguments", async () => {
    const value = fixture();
    try {
      await value.connections.connect(projectId, connectionId);
      const result = await value.debug.run(projectId, connectionId, "main", {
        phase: "before", arguments: {}, response: null, timeoutMs: 5_000, allowDestructiveHelpers: true,
        source: `export default async function before(ctx) {
          const found = await ctx.tools.call({ server: "current", name: "lookup", arguments: {} });
          ctx.arguments.set("a", ctx.json.get(found, "$.structuredContent.value"));
        }`,
      });
      expect(result.arguments).toEqual({ a: 7 });
      expect(value.session.calls.map(({ name }) => name)).toEqual(["lookup"]);
      const helperRun = value.runs.list(projectId).runs[0]!;
      expect(value.runs.get(projectId, helperRun.id).tabId).toBeNull();

      await expect(value.debug.run(projectId, connectionId, "main", {
        phase: "before", arguments: {}, response: null, timeoutMs: 5_000,
        source: `export default async function before(ctx) {
          await ctx.tools.call({ server: "current", name: "lookup", arguments: {} });
        }`,
      })).rejects.toThrow("Tool call failed");
      expect(value.session.calls).toHaveLength(1);

      value.environment.set(projectId, connectionId, "token", { value: "secret-value", secret: true });
      await expect(value.debug.run(projectId, connectionId, "main", {
        phase: "before", arguments: {}, response: null, timeoutMs: 5_000, allowDestructiveHelpers: true,
        source: `export default async function before(ctx) {
          await ctx.tools.call({ server: "current", name: "lookup", arguments: { token: ctx.env.get("token", { scope: "server" }) } });
        }`,
      })).rejects.toThrow("Tool call failed");
      expect(value.session.calls).toHaveLength(1);
    } finally {
      await value.debug.close(); await value.runs.close(); await value.connections.close(); value.projects.close();
    }
  });

  it("rejects an ambiguous helper Server name instead of selecting one connection arbitrarily", async () => {
    const value = fixture();
    try {
      for (const id of [firstDuplicateId, secondDuplicateId]) {
        const created = value.connections.create(projectId, {
          name: "Duplicate", url: `https://${id}.example.test/mcp`, transport: "streamable-http",
          authMode: "none", timeoutMs: 10_000,
        });
        expect(created.id).toBe(id);
        new ToolRepository(value.projects.open(projectId)).replaceCatalog(projectId, id, [{
          id: id.replace(/20[34]$/, id.endsWith("3") ? "230" : "240"),
          name: "lookup", contentHash: id.endsWith("3") ? "c".repeat(64) : "d".repeat(64),
          definitionJson: JSON.stringify({ name: "lookup", inputSchema: { type: "object" } }),
        }], "2026-08-27T00:00:00.000Z");
        await value.connections.connect(projectId, id);
      }

      await expect(value.debug.run(projectId, connectionId, "main", {
        phase: "before", arguments: {}, response: null, timeoutMs: 5_000,
        source: `export default async function before(ctx) {
          await ctx.tools.call({ server: "Duplicate", name: "lookup", arguments: {} });
        }`,
      })).rejects.toThrow("Tool call failed");
      expect(value.session.calls).toHaveLength(0);
      expect(value.runs.list(projectId).runs).toHaveLength(0);
    } finally {
      await value.debug.close(); await value.runs.close(); await value.connections.close(); value.projects.close();
    }
  });
});
