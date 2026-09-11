// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient } from "../../../api/api-client.js";
import { i18n } from "../../../i18n/index.js";
import { AuthoringPage } from "../AuthoringPage.js";

const firstProjectId = "00000000-0000-4000-8000-000000000801";
const secondProjectId = "00000000-0000-4000-8000-000000000802";
const draftId = "00000000-0000-4000-8000-000000000803";
const callId = "00000000-0000-4000-8000-000000000804";
const executionId = "00000000-0000-4000-8000-000000000806";
const formalCaseId = "00000000-0000-4000-8000-000000000807";
const connectionId = "00000000-0000-4000-8000-000000000805";
const now = "2026-09-10T00:00:00.000Z";
const emptyDefinition = { version: 1 as const, testCases: [], suites: [], sourceAssets: [], evidence: [] };

function api(overrides: Partial<InspectorApiClient> = {}): InspectorApiClient {
  return {
    getAuthoringSettings: vi.fn().mockResolvedValue({
      settings: { enabled: true, configured: true, tokenHint: "author…", tokenCreatedAt: now,
        tokenRotatedAt: null, updatedAt: now },
      endpoint: "http://127.0.0.1:8500/mcp/authoring",
    }),
    enableAuthoring: vi.fn().mockResolvedValue({
      settings: { enabled: true, configured: true, tokenHint: "author…", tokenCreatedAt: now,
        tokenRotatedAt: null, updatedAt: now },
      endpoint: "http://127.0.0.1:8500/mcp/authoring",
      token: "a".repeat(43),
    }),
    rotateAuthoringToken: vi.fn(), disableAuthoring: vi.fn(),
    listConnections: vi.fn().mockResolvedValue([{ id: connectionId, projectId: firstProjectId,
      name: "Catalog Server", url: "http://127.0.0.1:9000/mcp", transport: "streamable-http",
      authMode: "none", bearerToken: null, headers: {}, redactSensitiveInfo: true,
      authorizationStatus: "not-required", timeoutMs: 10_000, status: "connected",
      lastProtocolVersion: "2025-06-18", lastServerInfo: null, lastError: null }]),
    getAuthoringPolicy: vi.fn().mockResolvedValue({ projectId: firstProjectId, connectionId,
      mode: "FULL_ACCESS", allowedTools: [], deniedTools: [], requireCleanupForDraftMutations: true,
      maxCallsPerMinute: 60, maxConcurrentCalls: 1, maxCallDurationMs: 30_000,
      revision: 1, createdAt: now, updatedAt: now }),
    listTools: vi.fn().mockResolvedValue([{ projectId: firstProjectId, connectionId, name: "catalog.search",
      status: "current", folderId: null, favorite: false, lastUsedAt: null, updatedAt: now,
      currentSnapshot: { id: formalCaseId, projectId: firstProjectId, connectionId,
        toolName: "catalog.search", contentHash: "d".repeat(64), createdAt: now,
        definition: { name: "catalog.search", description: "搜索商品目录",
          annotations: { readOnlyHint: true }, inputSchema: { type: "object" } } } }]),
    listAuthoringDrafts: vi.fn().mockResolvedValue({ items: [{ id: draftId, projectId: firstProjectId,
      revision: 1, state: "ACTIVE", goal: "创建订单回归测试", testCaseCount: 1, suiteCount: 0,
      createdAt: now, updatedAt: now }], nextCursor: null }),
    getAuthoringDraft: vi.fn().mockResolvedValue({ version: 1, id: draftId, projectId: firstProjectId,
      revision: 1, state: "ACTIVE", goal: "创建订单回归测试", definitionDigest: "a".repeat(64),
      definition: emptyDefinition, createdAt: now, updatedAt: now }),
    replaceAuthoringDraft: vi.fn(), validateAuthoringDraft: vi.fn(),
    executeAuthoringDraft: vi.fn(), getAuthoringDraftExecution: vi.fn(),
    cancelAuthoringDraftExecution: vi.fn(), applyAuthoringDraft: vi.fn(),
    listAuthoringCalls: vi.fn().mockResolvedValue({ items: [{ callId, projectId: firstProjectId,
      connectionId, toolName: "create_order",
      context: { kind: "STANDALONE", label: "diagnose" }, purpose: "DIAGNOSTIC", status: "SUCCEEDED",
      runId: null, mayHaveSideEffects: false, createdAt: now, startedAt: now, completedAt: now, durationMs: 12 }],
      nextCursor: null }),
    getAuthoringCall: vi.fn().mockResolvedValue({ id: callId, projectId: firstProjectId,
      connectionId, toolName: "create_order",
      toolSnapshotId: null, toolSchemaHash: "b".repeat(64), context: { kind: "STANDALONE", label: "diagnose" },
      purpose: "DIAGNOSTIC", status: "SUCCEEDED", runId: null, idempotencyKey: "one",
      arguments: { orderId: "100" }, mayHaveSideEffects: false, response: { ok: true }, error: null,
      createdAt: now, startedAt: now, completedAt: now, durationMs: 12 }),
    ...overrides,
  } as InspectorApiClient;
}

beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("AuthoringPage", () => {
  it("renders the Stitch overview from authoritative service and policy data", async () => {
    render(<AuthoringPage api={api()} projectId={firstProjectId} active />);

    expect(await screen.findByRole("tab", { name: "概览" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Streamable HTTP 端点" })).toBeVisible();
    expect(screen.getByLabelText("Streamable HTTP 地址")).toHaveValue("http://127.0.0.1:8500/mcp/authoring");
    expect((await screen.findAllByText("Catalog Server"))[0]).toBeVisible();
    expect(screen.getByText("FULL_ACCESS")).toBeVisible();
    expect(await screen.findByText("1 / 1 个 Tool 可用")).toBeVisible();
    expect(screen.getByText(/1 个 Draft/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /一键写入/u })).not.toBeInTheDocument();
  });

  it("shows authoritative service state and only reveals a newly issued token once", async () => {
    const user = userEvent.setup();
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
    const settingsResult = {
      settings: { enabled: false, configured: false, tokenHint: null, tokenCreatedAt: null,
        tokenRotatedAt: null, updatedAt: null }, endpoint: "http://127.0.0.1:8500/mcp/authoring",
    };
    const settingsPromise = Promise.resolve(settingsResult);
    const client = api({ getAuthoringSettings: vi.fn().mockReturnValue(settingsPromise) });
    render(<AuthoringPage api={client} projectId={firstProjectId} active />);

    await act(async () => { await settingsPromise; });
    expect(await screen.findByText("未启用")).toBeVisible();
    expect(screen.getByDisplayValue("http://127.0.0.1:8500/mcp/authoring")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "启用服务" }));
    expect(await screen.findByText("请立即保存此 Token，关闭或刷新后将不再显示。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "复制 Token" }));
    expect(clipboard.writeText).toHaveBeenCalledWith("a".repeat(43));
    await user.click(screen.getByRole("button", { name: "复制客户端配置" }));
    expect(clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining("http://127.0.0.1:8500/mcp/authoring"));
  });

  it("lists drafts and calls without loading call history into another workspace", async () => {
    const user = userEvent.setup();
    const client = api();
    render(<AuthoringPage api={client} projectId={firstProjectId} active />);

    await user.click(await screen.findByRole("tab", { name: "Drafts" }));
    await user.click(await screen.findByRole("button", { name: /创建订单回归测试/ }));
    expect((await screen.findByLabelText("Draft 定义 JSON") as HTMLTextAreaElement).value).toContain('"version": 1');
    await user.click(screen.getByRole("tab", { name: "调用记录" }));
    await user.click(await screen.findByRole("button", { name: /create_order/ }));
    expect((await screen.findByRole("heading", { name: "调用参数" })).parentElement).toHaveTextContent('"orderId": "100"');
    expect(screen.getByRole("heading", { name: "响应结果" }).parentElement).toHaveTextContent('"ok": true');
  });

  it("preserves unsaved draft state while hidden and clears it for a different project", async () => {
    const user = userEvent.setup();
    const client = api();
    const view = render(<AuthoringPage api={client} projectId={firstProjectId} active />);
    await user.click(await screen.findByRole("tab", { name: "Drafts" }));
    await user.click(await screen.findByRole("button", { name: /创建订单回归测试/ }));
    const goal = await screen.findByLabelText("Draft 目标");
    await user.clear(goal);
    await user.type(goal, "尚未保存的编辑");
    await user.type(screen.getByRole("searchbox", { name: "搜索当前列表" }), "创建");

    await user.click(screen.getByRole("tab", { name: "概览" }));
    await user.click(screen.getByRole("tab", { name: "Drafts" }));
    expect(screen.getByLabelText("Draft 目标")).toHaveValue("尚未保存的编辑");

    view.rerender(<AuthoringPage api={client} projectId={firstProjectId} active={false} />);
    view.rerender(<AuthoringPage api={client} projectId={firstProjectId} active />);
    expect(screen.getByLabelText("Draft 目标")).toHaveValue("尚未保存的编辑");
    expect(screen.getByRole("searchbox", { name: "搜索当前列表" })).toHaveValue("创建");

    vi.mocked(client.listAuthoringDrafts).mockResolvedValueOnce({ items: [], nextCursor: null });
    vi.mocked(client.listAuthoringCalls).mockResolvedValueOnce({ items: [], nextCursor: null });
    view.rerender(<AuthoringPage api={client} projectId={secondProjectId} active />);
    await waitFor(() => expect(client.listAuthoringDrafts).toHaveBeenLastCalledWith(secondProjectId));
    await user.click(screen.getByRole("tab", { name: "Drafts" }));
    expect(screen.queryByDisplayValue("尚未保存的编辑")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索当前列表" })).toHaveValue("");
  });

  it("supports keyboard navigation between workspace views", async () => {
    render(<AuthoringPage api={api()} projectId={firstProjectId} active />);
    const overview = await screen.findByRole("tab", { name: "概览" });
    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Drafts" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("tab", { name: "Drafts" }), { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "调用记录" })).toHaveFocus());
    expect(screen.getByRole("tab", { name: "调用记录" })).toHaveAttribute("aria-selected", "true");
  });

  it("validates, trial-runs, applies, and opens a stable formal asset mapping", async () => {
    const user = userEvent.setup();
    const validation = { id: callId, projectId: firstProjectId, draftId, draftRevision: 1,
      definitionDigest: "a".repeat(64), toolSchemaHashes: {}, validationDigest: "c".repeat(64),
      status: "VALID" as const, issues: [], createdAt: now };
    const client = api({
      validateAuthoringDraft: vi.fn().mockResolvedValue(validation),
      executeAuthoringDraft: vi.fn().mockResolvedValue({ id: executionId, projectId: firstProjectId, draftId,
        draftRevision: 1, definitionDigest: "a".repeat(64), validationDigest: "c".repeat(64),
        status: "PASSED", createdAt: now, startedAt: now, completedAt: now, durationMs: 1 }),
      applyAuthoringDraft: vi.fn().mockResolvedValue({ applyId: callId, projectId: firstProjectId, draftId,
        draftRevision: 1, validationDigest: "c".repeat(64), appliedAt: now,
        assets: [{ draftLocalId: "case-1", kind: "TEST_CASE", formalAssetId: formalCaseId, revision: 1 }] }),
    });
    const onOpenAsset = vi.fn();
    render(<AuthoringPage api={client} projectId={firstProjectId} active onOpenAsset={onOpenAsset} />);
    await user.click(await screen.findByRole("tab", { name: "Drafts" }));
    await user.click(await screen.findByRole("button", { name: /创建订单回归测试/ }));
    expect(screen.getByRole("button", { name: "试运行" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "验证" }));
    await screen.findByText("当前修订通过确定性验证。");
    await user.click(screen.getByRole("button", { name: "试运行" }));
    expect(await screen.findByText(/试运行结果 · PASSED/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "保存到自动化测试" }));
    await user.click(await screen.findByRole("button", { name: `${formalCaseId} · r1` }));
    expect(onOpenAsset).toHaveBeenCalledWith(expect.objectContaining({ formalAssetId: formalCaseId }));
  });
});
