import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { InstallationSettingsRepository } from "../../registry/installation-settings-repository.js";
import { createAuthoringAuthService } from "../authoring-auth-service.js";
import type { AuthoringCallService } from "../authoring-call-service.js";
import { createAuthoringMcpServer } from "../authoring-mcp-server.js";
import type { AuthoringDraftService } from "../authoring-draft-service.js";

const projectId = "00000000-0000-4000-8000-000000005001";
const connectionId = "00000000-0000-4000-8000-000000005002";
const callId = "00000000-0000-4000-8000-000000005003";
const runId = "00000000-0000-4000-8000-000000005004";
const draftId = "00000000-0000-4000-8000-000000005005";
const endpoint = new URL("http://127.0.0.1:8500/mcp/authoring");

const detail = {
  id: callId, projectId, connectionId, toolName: "sum", toolSnapshotId: null,
  toolSchemaHash: "a".repeat(64), context: { kind: "STANDALONE" as const, label: "Diagnosis" },
  purpose: "DIAGNOSTIC" as const, status: "SUCCEEDED" as const, runId,
  idempotencyKey: "call-once", arguments: { authorization: "[REDACTED]", a: 2 },
  mayHaveSideEffects: false, response: { structuredContent: { total: 2 } }, error: null,
  createdAt: "2026-09-10T00:00:00.000Z", startedAt: "2026-09-10T00:00:00.001Z",
  completedAt: "2026-09-10T00:00:00.002Z", durationMs: 1,
};

describe("Authoring call MCP tools", () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-authoring-call-tools-"));
    const repository = new InstallationSettingsRepository({ dataRoot });
    const auth = createAuthoringAuthService({ repository });
    const enabled = await auth.enable();
    const calls: AuthoringCallService = {
      call: vi.fn(async () => detail),
      get: vi.fn(() => detail),
      list: vi.fn(() => ({ items: [{
        callId, projectId, connectionId, toolName: "sum", context: detail.context,
        purpose: detail.purpose, status: detail.status, runId, mayHaveSideEffects: false,
        createdAt: detail.createdAt, startedAt: detail.startedAt, completedAt: detail.completedAt,
        durationMs: detail.durationMs,
      }], nextCursor: null })),
    };
    const draftResult = { draftId, revision: 1, definitionDigest: "b".repeat(64) };
    const drafts: AuthoringDraftService = {
      create: vi.fn(() => draftResult),
      createFromCall: vi.fn(() => draftResult),
      list: vi.fn(() => ({ items: [], nextCursor: null })),
      get: vi.fn(() => ({ version: 1 as const, id: draftId, projectId, revision: 1, state: "ACTIVE" as const,
        goal: "Diagnosis", definitionDigest: "b".repeat(64),
        definition: { version: 1 as const, testCases: [], suites: [], sourceAssets: [], evidence: [] },
        createdAt: detail.createdAt, updatedAt: detail.createdAt })),
      replace: vi.fn(() => ({ ...draftResult, revision: 2 })),
    };
    const server = createAuthoringMcpServer({
      appVersion: "3.0.0-test", endpoint: endpoint.toString(), calls, drafts,
    });
    const app = createApp({
      sessionToken: "browser-session", allowedOrigin: endpoint.origin, version: "3.0.0-test",
      authoringAuth: auth, authoringMcp: server,
    });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${enabled.token}` } },
      fetch: async (input, init) => app.fetch(input instanceof Request ? input : new Request(input, init)),
    });
    const client = new Client({ name: "call-tools-test", version: "1" });
    await client.connect(transport);
    cleanups.push(async () => {
      await client.close().catch(() => undefined);
      await server.close();
      repository.close();
      rmSync(dataRoot, { recursive: true, force: true });
    });
    return { client, calls, drafts };
  }

  it("calls a downstream Tool and returns traceable call and Run identities", async () => {
    const { client, calls } = await fixture();
    expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
      "inspector_get_capabilities", "inspector_call_tool", "inspector_list_tool_calls", "inspector_get_tool_call",
      "inspector_create_draft", "inspector_create_draft_from_call", "inspector_list_drafts",
      "inspector_get_draft", "inspector_replace_draft",
    ]);
    const result = await client.callTool({ name: "inspector_call_tool", arguments: {
      projectId, connectionId, toolName: "sum", toolSchemaHash: "a".repeat(64), arguments: { a: 2 },
      context: { kind: "STANDALONE", label: "Diagnosis" }, purpose: "DIAGNOSTIC", idempotencyKey: "call-once",
    } });
    expect(result.structuredContent).toMatchObject({ ok: true, data: {
      callId, runId, status: "SUCCEEDED", arguments: { authorization: "[REDACTED]" },
    } });
    expect(calls.call).toHaveBeenCalledOnce();
  });

  it("creates, reads, lists, and fully replaces revisioned Draft Bundles", async () => {
    const { client, drafts } = await fixture();
    const created = await client.callTool({ name: "inspector_create_draft", arguments: {
      projectId, goal: "Diagnosis", idempotencyKey: "draft-create",
    } });
    expect(created.structuredContent).toMatchObject({ ok: true, data: { draftId, revision: 1 } });
    await client.callTool({ name: "inspector_create_draft_from_call", arguments: {
      projectId, callId, goal: "From call", idempotencyKey: "draft-call",
    } });
    await client.callTool({ name: "inspector_list_drafts", arguments: { projectId } });
    const fetched = await client.callTool({ name: "inspector_get_draft", arguments: { projectId, draftId } });
    expect(fetched.structuredContent).toMatchObject({ ok: true, data: { id: draftId, state: "ACTIVE" } });
    const replaced = await client.callTool({ name: "inspector_replace_draft", arguments: {
      projectId, draftId, expectedRevision: 1, goal: "Updated", idempotencyKey: "draft-replace",
      definition: { version: 1, testCases: [], suites: [], sourceAssets: [], evidence: [] },
    } });
    expect(replaced.structuredContent).toMatchObject({ ok: true, data: { draftId, revision: 2 } });
    expect(drafts.createFromCall).toHaveBeenCalledWith(expect.objectContaining({ callId }));
    expect(drafts.replace).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1 }));
  });

  it("lists summaries and gets sanitized detail without project identity substitution", async () => {
    const { client, calls } = await fixture();
    const listed = await client.callTool({ name: "inspector_list_tool_calls", arguments: { projectId, limit: 10 } });
    expect(listed.structuredContent).toMatchObject({ ok: true, data: {
      items: [{ callId, projectId, runId }], nextCursor: null,
    } });
    const fetched = await client.callTool({ name: "inspector_get_tool_call", arguments: { projectId, callId } });
    expect(fetched.structuredContent).toMatchObject({ ok: true, data: { callId, projectId, runId } });
    expect(JSON.stringify(fetched.structuredContent)).not.toContain("raw-secret");
    expect(calls.get).toHaveBeenCalledWith(projectId, callId);
  });
});
