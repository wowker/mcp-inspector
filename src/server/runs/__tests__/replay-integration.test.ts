import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeMcpSession } from "../../../../test-support/fake-mcp-session.js";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { createTabService } from "../../tabs/tab-service.js";
import { ToolRepository } from "../../tools/tool-repository.js";
import { createToolService } from "../../tools/tool-service.js";
import { createReplayExecutionService } from "../replay-execution-service.js";
import { createReplayPreflightService } from "../replay-preflight-service.js";
import { createRunService } from "../run-service.js";

const projectId = "00000000-0000-4000-8000-000000000841";
const oauthConnectionId = "00000000-0000-4000-8000-000000000842";
const bearerConnectionId = "00000000-0000-4000-8000-000000000843";
const snapshotId = "00000000-0000-4000-8000-000000000844";
const sourceRunId = "00000000-0000-4000-8000-000000000845";
const replayRunId = "00000000-0000-4000-8000-000000000846";
const duplicateCandidateRunId = "00000000-0000-4000-8000-000000000847";

describe("replay integration", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it("reuses exact arguments and the source connection identity even when another auth mode has the same URL", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-replay-")); roots.push(dataRoot);
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Replay");
    const oauthSession = new FakeMcpSession();
    const bearerSession = new FakeMcpSession();
    const factoryConnections: Array<{ id: string; authMode: string }> = [];
    const connectionIds = [oauthConnectionId, bearerConnectionId];
    const connections = createConnectionService(projects, {
      createId: () => connectionIds.shift()!,
      sessionFactory: async (connection) => {
        factoryConnections.push({ id: connection.id, authMode: connection.authMode });
        return connection.id === oauthConnectionId ? oauthSession : bearerSession;
      },
    });
    const url = "https://same.example.test/mcp";
    connections.create(projectId, {
      name: "oauth", url, transport: "streamable-http", authMode: "oauth", timeoutMs: 10_000,
    });
    connections.create(projectId, {
      name: "bearer", url, transport: "streamable-http", authMode: "bearer", bearerToken: "token-b",
      timeoutMs: 10_000,
    });
    new ToolRepository(projects.open(projectId)).replaceCatalog(projectId, oauthConnectionId, [{
      id: snapshotId, name: "update_item", contentHash: "a".repeat(64),
      definitionJson: JSON.stringify({
        name: "update_item", annotations: { readOnlyHint: true },
        inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, nested: { type: "object" } } },
      }),
    }], "2026-09-01T00:00:00.000Z");
    const tools = createToolService(projects, connections);
    const tabs = createTabService(projects, connections, { tools });
    const runIds = [sourceRunId, replayRunId, duplicateCandidateRunId];
    const runs = createRunService(projects, connections, tabs, { createId: () => runIds.shift()! });
    try {
      const exactArguments = { id: "source-value", nested: { keep: [1, 2, 3] } };
      const source = runs.startInvocation({
        projectId, connectionId: oauthConnectionId, toolName: "update_item",
        idempotencyKey: "source", arguments: exactArguments,
      });
      await runs.waitForTerminal(projectId, source.id);

      const preflight = createReplayPreflightService({ runs, connections, tools });
      const execution = createReplayExecutionService({ preflight, runs });
      const preview = preflight.inspect(projectId, source.id);
      const request = {
        idempotencyKey: "replay", preflightDigest: preview.digest,
        confirmSchemaDrift: false, confirmSideEffects: false,
      };
      const replay = execution.start(projectId, source.id, request);
      const duplicate = execution.start(projectId, source.id, request);
      expect(duplicate.id).toBe(replay.id);
      const completed = await runs.waitForTerminal(projectId, replay.id);

      expect(completed.replayedFromRunId).toBe(source.id);
      expect(completed.tabId).toBeNull();
      expect(completed.request.arguments).toEqual(exactArguments);
      expect(runs.get(projectId, source.id).pinned).toBe(false);
      expect(oauthSession.calls).toEqual([
        { name: "update_item", arguments: exactArguments },
        { name: "update_item", arguments: exactArguments },
      ]);
      expect(bearerSession.calls).toEqual([]);
      expect(factoryConnections).toEqual([{ id: oauthConnectionId, authMode: "oauth" }]);
    } finally {
      await runs.close();
      await connections.close();
      projects.close();
    }
  });
});
