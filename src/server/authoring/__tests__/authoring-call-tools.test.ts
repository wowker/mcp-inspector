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
import type { AuthoringDraftValidator } from "../authoring-draft-validator.js";
import type { AuthoringAssetService } from "../authoring-asset-service.js";
import type { AuthoringDraftExecutionService } from "../authoring-draft-execution-service.js";

const projectId = "00000000-0000-4000-8000-000000005001";
const connectionId = "00000000-0000-4000-8000-000000005002";
const callId = "00000000-0000-4000-8000-000000005003";
const runId = "00000000-0000-4000-8000-000000005004";
const draftId = "00000000-0000-4000-8000-000000005005";
const executionId = "00000000-0000-4000-8000-000000005008";
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
    const validator: AuthoringDraftValidator = { validate: vi.fn(() => ({
      id: "00000000-0000-4000-8000-000000005006", projectId, draftId, draftRevision: 1,
      definitionDigest: "b".repeat(64), toolSchemaHashes: {}, validationDigest: "c".repeat(64),
      status: "VALID" as const, issues: [], createdAt: detail.createdAt,
    })) };
    const assets: AuthoringAssetService = {
      list: vi.fn(() => ({ items: [], nextCursor: null })),
      get: vi.fn(() => ({ id: "00000000-0000-4000-8000-000000005007", revision: 1 })),
    };
    const executionSummary = { id: executionId, projectId, draftId, draftRevision: 1,
      definitionDigest: "b".repeat(64), validationDigest: "c".repeat(64), status: "QUEUED" as const,
      createdAt: detail.createdAt, startedAt: null, completedAt: null, durationMs: null };
    const executions: AuthoringDraftExecutionService = {
      start: vi.fn(() => executionSummary),
      get: vi.fn(() => ({ ...executionSummary, status: "PASSED" as const, inputs: {}, testCases: [],
        error: null, startedAt: detail.startedAt, completedAt: detail.completedAt, durationMs: 1 })),
      list: vi.fn(() => ({ items: [executionSummary] })),
      waitForTerminal: vi.fn(), cancel: vi.fn(() => true), close: vi.fn(),
    };
    const server = createAuthoringMcpServer({
      appVersion: "3.0.0-test", endpoint: endpoint.toString(), calls, drafts, validator, assets, executions,
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
    return { client, calls, drafts, validator, assets, executions };
  }

  it("calls a downstream Tool and returns traceable call and Run identities", async () => {
    const { client, calls } = await fixture();
    expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
      "inspector_get_capabilities", "inspector_call_tool", "inspector_list_tool_calls", "inspector_get_tool_call",
      "inspector_create_draft", "inspector_create_draft_from_call", "inspector_list_drafts",
      "inspector_get_draft", "inspector_replace_draft",
      "inspector_validate_draft", "inspector_execute_draft", "inspector_get_draft_execution",
      "inspector_cancel_draft_execution", "inspector_list_test_assets", "inspector_get_test_asset",
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

  it("validates exact Draft revisions and discovers existing test assets", async () => {
    const { client, validator, assets } = await fixture();
    const validated = await client.callTool({ name: "inspector_validate_draft", arguments: {
      projectId, draftId, revision: 1,
    } });
    expect(validated.structuredContent).toMatchObject({ ok: true, data: { status: "VALID", draftId } });
    await client.callTool({ name: "inspector_list_test_assets", arguments: { projectId, limit: 10 } });
    await client.callTool({ name: "inspector_get_test_asset", arguments: {
      projectId, kind: "TEST_CASE", assetId: "00000000-0000-4000-8000-000000005007", revision: 1,
    } });
    expect(validator.validate).toHaveBeenCalledWith({ projectId, draftId, revision: 1 });
    expect(assets.get).toHaveBeenCalledWith(projectId, "TEST_CASE",
      "00000000-0000-4000-8000-000000005007", 1);
  });

  it("starts, reads, and cancels asynchronous Draft trial execution", async () => {
    const { client, executions } = await fixture();
    const started = await client.callTool({ name: "inspector_execute_draft", arguments: {
      projectId, draftId, revision: 1, validationDigest: "c".repeat(64),
      idempotencyKey: "execute-once", inputs: {},
    } });
    expect(started.structuredContent).toMatchObject({ ok: true, data: { id: executionId, status: "QUEUED" } });
    const fetched = await client.callTool({ name: "inspector_get_draft_execution", arguments: {
      projectId, executionId,
    } });
    expect(fetched.structuredContent).toMatchObject({ ok: true, data: { id: executionId, status: "PASSED" } });
    const cancelled = await client.callTool({ name: "inspector_cancel_draft_execution", arguments: {
      projectId, executionId,
    } });
    expect(cancelled.structuredContent).toMatchObject({ ok: true, data: { executionId, cancelled: true } });
    expect(executions.start).toHaveBeenCalledWith(expect.objectContaining({ validationDigest: "c".repeat(64) }));
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
