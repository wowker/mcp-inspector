// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogToolSummary, InspectorApiClient } from "../../../api/api-client.js";
import { AppToaster } from "../../../app/AppToaster.js";
import { ConnectionPanel } from "../ConnectionPanel.js";
import { i18n } from "../../../i18n/index.js";

const projectId = "00000000-0000-4000-8000-000000000401";
const connection = {
  id: "00000000-0000-4000-8000-000000000402",
  projectId,
  name: "Catalog MCP",
  url: "https://mcp.example.test/mcp",
  transport: "streamable-http" as const,
  authMode: "none" as const,
  bearerToken: null,
  headers: {},
  redactSensitiveInfo: true,
  authorizationStatus: "not-required" as const,
  timeoutMs: 10_000,
  status: "disconnected" as const,
  lastProtocolVersion: null,
  lastServerInfo: null,
  lastError: null,
};

const secondProjectId = "00000000-0000-4000-8000-000000000403";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function api(overrides: Partial<InspectorApiClient> = {}): InspectorApiClient {
  return {
    listProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    openProject: vi.fn(),
    listConnections: vi.fn().mockResolvedValue([connection]),
    createConnection: vi.fn().mockResolvedValue(connection),
    updateConnection: vi.fn().mockResolvedValue(connection),
    exportConnection: vi.fn().mockResolvedValue(new Blob(["{}"], { type: "application/json" })),
    deleteConnection: vi.fn().mockResolvedValue(undefined),
    connectConnection: vi.fn().mockResolvedValue({ ...connection, status: "connected" }),
    disconnectConnection: vi.fn().mockResolvedValue(connection),
    listTools: vi.fn().mockResolvedValue([]),
    refreshTools: vi.fn().mockResolvedValue([]),
    getTool: vi.fn(),
    deleteTool: vi.fn().mockResolvedValue(undefined),
    listToolFolders: vi.fn().mockResolvedValue([]),
    createToolFolder: vi.fn(),
    renameToolFolder: vi.fn(),
    deleteToolFolder: vi.fn(),
    moveToolToFolder: vi.fn(), setToolFavorite: vi.fn(), markToolUsed: vi.fn(),
    getToolWorkflow: vi.fn(), updateToolWorkflow: vi.fn(), validateToolWorkflow: vi.fn(), debugToolWorkflow: vi.fn(),
    listEnvironmentVariables: vi.fn(), setEnvironmentVariable: vi.fn(), deleteEnvironmentVariable: vi.fn(),
    listEnvironmentProfiles: vi.fn().mockResolvedValue([]), createEnvironmentProfile: vi.fn(), updateEnvironmentProfile: vi.fn(), deleteEnvironmentProfile: vi.fn(),
    listEnvironmentProfileVariables: vi.fn().mockResolvedValue([]), setEnvironmentProfileVariable: vi.fn(), deleteEnvironmentProfileVariable: vi.fn(),
    getConnectionEnvironmentProfile: vi.fn(), setConnectionEnvironmentProfile: vi.fn(), previewConnectionEnvironmentProfile: vi.fn(),
    listTabs: vi.fn().mockResolvedValue([]),
    openTab: vi.fn(), replaceTabTool: vi.fn(), updateTab: vi.fn(), duplicateTab: vi.fn(),
    reorderTabs: vi.fn(), closeTab: vi.fn(), closeOtherTabs: vi.fn(), closeTabsRight: vi.fn(),
    startRun: vi.fn(), startWorkflowExecution: vi.fn(), getActiveWorkflowExecution: vi.fn(), getWorkflowExecution: vi.fn(), cancelWorkflowExecution: vi.fn(),
    getRunSummary: vi.fn(), getRun: vi.fn(), listRuns: vi.fn(), setRunPinned: vi.fn(), openRunEventStream: vi.fn(),
    getReplayPreflight: vi.fn(), startReplay: vi.fn(),
    listComparisonRules: vi.fn().mockResolvedValue({ rules: [] }), replaceComparisonRules: vi.fn(), getRunComparison: vi.fn(),
    listSavedItems: vi.fn(), getSavedItem: vi.fn(), createSavedItem: vi.fn(), deleteSavedItem: vi.fn(),
    listTestCases: vi.fn(), getTestCase: vi.fn(), createTestCase: vi.fn(), updateTestCase: vi.fn(), deleteTestCase: vi.fn(),
    listTestSuites: vi.fn(), getTestSuite: vi.fn(), createTestSuite: vi.fn(), updateTestSuite: vi.fn(), deleteTestSuite: vi.fn(),
    startTestSuiteExecution: vi.fn(), getTestSuiteExecution: vi.fn(), cancelTestSuiteExecution: vi.fn(),
    startTestExecution: vi.fn(), listTestExecutions: vi.fn(), updateTestExecutionBaseline: vi.fn(), getTestExecution: vi.fn(), cancelTestExecution: vi.fn(),
    exportAutomatedTests: vi.fn(), importAutomatedTests: vi.fn(),
    previewTestCaseFromRun: vi.fn(), previewTestCaseFromSavedItem: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("ConnectionPanel", () => {
  it("persists Tool favorites and recent use without blocking Tool selection", async () => {
    const connected = { ...connection, status: "connected" as const };
    const savedTool: CatalogToolSummary = {
      projectId, connectionId: connection.id, name: "catalog/read", status: "current", folderId: null,
      favorite: false, lastUsedAt: null, updatedAt: "2026-08-17T12:00:00.000Z",
      currentSnapshot: {
        id: "00000000-0000-4000-8000-000000000411", projectId, connectionId: connection.id,
        toolName: "catalog/read", contentHash: "a".repeat(64), createdAt: "2026-08-17T12:00:00.000Z",
        definition: { name: "catalog/read", inputSchema: { type: "object" } },
      },
    };
    const setToolFavorite = vi.fn().mockResolvedValue({ ...savedTool, favorite: true });
    const markToolUsed = vi.fn().mockResolvedValue({ ...savedTool, lastUsedAt: "2026-08-17T12:01:00.000Z" });
    const onSelectTool = vi.fn();
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({
      listConnections: vi.fn().mockResolvedValue([connected]),
      listTools: vi.fn().mockResolvedValue([savedTool]), setToolFavorite, markToolUsed,
    })} projectId={projectId} mode="tools" connectionFilterId={connection.id} onSelectTool={onSelectTool} />);

    await user.click(await screen.findByRole("button", { name: "收藏 catalog/read" }));
    expect(setToolFavorite).toHaveBeenCalledWith(projectId, connection.id, "catalog/read", true);
    await user.click(screen.getByRole("button", { name: "catalog/read" }));
    await waitFor(() => expect(onSelectTool).toHaveBeenCalledWith(expect.objectContaining({ name: "catalog/read" })));
    expect(markToolUsed).toHaveBeenCalledWith(projectId, connection.id, "catalog/read");
  });

  it("renders the complete Server management flow in English without rebuilding connection state", async () => {
    await i18n.changeLanguage("en-US");
    const listConnections = vi.fn().mockResolvedValue([connection]);
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({ listConnections })} projectId={projectId} mode="servers" />);

    expect(await screen.findByRole("heading", { name: "Connection management" })).toBeVisible();
    expect(screen.getByRole("table", { name: "Connection list" })).toBeVisible();
    expect(screen.getByText("Disconnected")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Add connection" }));
    expect(screen.getByRole("dialog", { name: "Add connection" })).toBeVisible();
    expect(screen.getByLabelText("Connection name")).toBeVisible();
    expect(screen.getByLabelText("Authentication")).toBeVisible();
    expect(listConnections).toHaveBeenCalledTimes(1);

    await i18n.changeLanguage("zh-CN");
  });

  it("keeps an OAuth Server on Servers after authorization and enters Tools only after a later connect", async () => {
    const authorized = { ...connection, authMode: "oauth" as const, authorizationStatus: "authorized" as const };
    const connected = { ...authorized, status: "connected" as const };
    const connectConnection = vi.fn().mockResolvedValueOnce(authorized).mockResolvedValueOnce(connected);
    const onConnectionConnected = vi.fn();
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({ listConnections: vi.fn().mockResolvedValue([authorized]), connectConnection })}
      projectId={projectId} mode="servers" onConnectionConnected={onConnectionConnected} />);

    await user.click(await screen.findByRole("button", { name: "连接 Catalog MCP" }));
    expect(await screen.findByText("已授权")).toBeVisible();
    expect(screen.getByText("待连接")).toBeVisible();
    expect(onConnectionConnected).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "连接 Catalog MCP" }));
    expect(onConnectionConnected).toHaveBeenCalledWith(connected);
  });

  it("presents saved connections in a table and opens an accessible add dialog", async () => {
    const user = userEvent.setup();
    render(<ConnectionPanel api={api()} projectId={projectId} />);

    expect(await screen.findByRole("table", { name: "连接列表" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "连接名称" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "MCP URL" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "状态" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "请求超时" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "操作" })).toBeVisible();
    expect(screen.queryByLabelText("连接名称")).not.toBeInTheDocument();

    const addButton = screen.getByRole("button", { name: "添加连接" });
    await user.click(addButton);
    const dialog = screen.getByRole("dialog", { name: "添加连接" });
    expect(dialog).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "信息脱敏" })).toBeChecked();
    expect(screen.getByLabelText("连接名称")).toHaveFocus();
    const closeButton = screen.getByRole("button", { name: "关闭添加连接弹窗" });
    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "保存连接" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "保存连接" }), { key: "Tab" });
    expect(closeButton).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "添加连接" })).not.toBeInTheDocument();
    expect(addButton).toHaveFocus();
  });

  it("persists an explicit choice to show sensitive HTTP headers", async () => {
    const updateConnection = vi.fn().mockResolvedValue({ ...connection, redactSensitiveInfo: false });
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({ updateConnection })} projectId={projectId} />);

    await user.click(await screen.findByRole("button", { name: "编辑 Catalog MCP" }));
    const redaction = screen.getByRole("checkbox", { name: "信息脱敏" });
    expect(redaction).toBeChecked();
    await user.click(redaction);
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect(updateConnection).toHaveBeenCalledWith(projectId, connection.id, expect.objectContaining({
      redactSensitiveInfo: false,
    }));
  });

  it("lists saved configurations as disconnected and presents fixed transport/auth modes", async () => {
    render(<ConnectionPanel api={api()} projectId={projectId} />);

    expect(await screen.findByRole("heading", { name: "连接管理" })).toBeVisible();
    expect(screen.getByText("Catalog MCP")).toBeVisible();
    expect(screen.getByText("未连接")).toBeVisible();
    expect(screen.getByText("Streamable HTTP")).toBeVisible();
    expect(screen.getByText("无认证")).toBeVisible();
    expect(screen.getByRole("button", { name: "连接 Catalog MCP" })).toBeVisible();
  });

  it("exports one Server from the action immediately after edit and confirms the download", async () => {
    const exportConnection = vi.fn().mockResolvedValue(new Blob(["{}"], { type: "application/json" }));
    const createObjectURL = vi.fn(() => "blob:server-export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<><AppToaster /><ConnectionPanel api={api({ exportConnection })} projectId={projectId} /></>);

    const edit = await screen.findByRole("button", { name: "编辑 Catalog MCP" });
    const actions = edit.parentElement!;
    const buttons = [...actions.querySelectorAll<HTMLButtonElement>("button")];
    const exportButton = screen.getByRole("button", { name: "导出 Catalog MCP" });
    expect(buttons.indexOf(exportButton as HTMLButtonElement)).toBe(
      buttons.indexOf(edit as HTMLButtonElement) + 1,
    );
    await user.click(exportButton);

    expect(exportConnection).toHaveBeenCalledWith(projectId, connection.id);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect((await screen.findByText("Catalog MCP 已导出")).closest("[data-sonner-toast]")).toHaveAttribute("data-type", "success");
  });

  it("performs exactly one Tool refresh after connect and can disconnect explicitly", async () => {
    const connectConnection = vi.fn().mockResolvedValue({ ...connection, status: "connected" });
    const refreshTools = vi.fn().mockResolvedValue([]);
    const disconnectConnection = vi.fn().mockResolvedValue(connection);
    const user = userEvent.setup();
    render(<><AppToaster /><ConnectionPanel api={api({ connectConnection, refreshTools, disconnectConnection })} projectId={projectId} /></>);
    await screen.findByText("Catalog MCP");

    await user.click(screen.getByRole("button", { name: "连接 Catalog MCP" }));
    await waitFor(() => expect(refreshTools).toHaveBeenCalledTimes(1));
    expect(refreshTools).toHaveBeenCalledWith(projectId, connection.id);
    expect((await screen.findByText("Catalog MCP 的 Tool 目录已更新。")).closest("[data-sonner-toast]")).toHaveAttribute("data-type", "success");
    expect(screen.queryByText("已连接，目录未就绪")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "断开 Catalog MCP" }));
    expect(disconnectConnection).toHaveBeenCalledWith(projectId, connection.id);
  });

  it("shows a failed state and editable diagnostic immediately when connect fails", async () => {
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({
      connectConnection: vi.fn().mockRejectedValue(new Error("Unable to connect to MCP server")),
    })} projectId={projectId} />);
    await screen.findByText("Catalog MCP");

    await user.click(screen.getByRole("button", { name: "连接 Catalog MCP" }));

    expect(await screen.findByText("失败")).toBeVisible();
    expect(screen.getAllByText("Unable to connect to MCP server")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "编辑 Catalog MCP" })).toBeEnabled();
  });

  it("keeps a successful transport connected when its automatic refresh fails", async () => {
    const refreshTools = vi.fn().mockRejectedValue(new Error("目录刷新失败"));
    const disconnectConnection = vi.fn().mockResolvedValue(connection);
    const user = userEvent.setup();
    render(<><AppToaster /><ConnectionPanel api={api({ refreshTools, disconnectConnection })} projectId={projectId} /></>);
    await screen.findByText("Catalog MCP");
    await user.click(screen.getByRole("button", { name: "连接 Catalog MCP" }));

    const failure = await screen.findByText("Catalog MCP 的 Tool 目录刷新失败：目录刷新失败");
    expect(failure.closest("[data-sonner-toast]")).toHaveAttribute("data-type", "error");
    expect(screen.getByRole("button", { name: "断开 Catalog MCP" })).toBeVisible();
    expect(screen.queryByText("已连接，目录未就绪")).not.toBeInTheDocument();
    expect(disconnectConnection).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "刷新 Catalog MCP Tools" }));
    expect(refreshTools).toHaveBeenCalledTimes(2);
    await screen.findByText("Catalog MCP 的 Tool 目录刷新失败：目录刷新失败");
    await user.click(screen.getByRole("button", { name: "断开 Catalog MCP" }));
    await waitFor(() => expect(screen.queryByText("Catalog MCP 的 Tool 目录刷新失败：目录刷新失败")).not.toBeInTheDocument());
  });

  it("synchronously invalidates an in-flight refresh when disconnecting", async () => {
    const pendingRefresh = deferred<Awaited<ReturnType<InspectorApiClient["refreshTools"]>>>();
    const connected = { ...connection, status: "connected" as const };
    const refreshTools = vi.fn()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(pendingRefresh.promise);
    const user = userEvent.setup();
    render(<><AppToaster /><ConnectionPanel api={api({
      connectConnection: vi.fn().mockResolvedValue(connected),
      disconnectConnection: vi.fn().mockResolvedValue(connection),
      refreshTools,
    })} projectId={projectId} /></>);
    await screen.findByText("Catalog MCP");
    await user.click(screen.getByRole("button", { name: "连接 Catalog MCP" }));
    await waitFor(() => expect(refreshTools).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "刷新 Catalog MCP Tools" }));
    expect(screen.getByRole("button", { name: "刷新 Catalog MCP Tools" })).toHaveTextContent("刷新中");
    expect(screen.getByText("正在刷新 Catalog MCP 的 Tool 目录…").closest("[data-sonner-toast]")).toHaveAttribute("data-type", "loading");

    await user.click(screen.getByRole("button", { name: "断开 Catalog MCP" }));

    expect(screen.getByRole("button", { name: "刷新 Catalog MCP Tools" })).toHaveTextContent("刷新");
    await waitFor(() => expect(screen.queryByText(/Tool 目录/)).not.toBeInTheDocument());
    await act(async () => pendingRefresh.resolve([]));
    expect(screen.queryByText(/Tool 目录/)).not.toBeInTheDocument();
  });

  it("invalidates an in-flight refresh before deleting its connection", async () => {
    const pendingRefresh = deferred<Awaited<ReturnType<InspectorApiClient["refreshTools"]>>>();
    const connected = { ...connection, status: "connected" as const };
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({
      listConnections: vi.fn().mockResolvedValue([connected]),
      refreshTools: vi.fn().mockReturnValue(pendingRefresh.promise),
    })} projectId={projectId} />);
    await screen.findByRole("button", { name: "刷新 Catalog MCP Tools" });
    await user.click(screen.getByRole("button", { name: "刷新 Catalog MCP Tools" }));
    await user.click(screen.getByRole("button", { name: "删除 Catalog MCP" }));
    await user.click(screen.getByRole("button", { name: "确认删除 Catalog MCP" }));
    expect(screen.queryByRole("button", { name: "折叠 Catalog MCP" })).not.toBeInTheDocument();

    await act(async () => pendingRefresh.resolve([]));
    expect(screen.queryByRole("button", { name: "折叠 Catalog MCP" })).not.toBeInTheDocument();
  });

  it("does not refresh or restore a connection deleted during connect", async () => {
    const pendingConnect = deferred<Awaited<ReturnType<InspectorApiClient["connectConnection"]>>>();
    const refreshTools = vi.fn();
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({
      connectConnection: vi.fn().mockReturnValue(pendingConnect.promise),
      refreshTools,
    })} projectId={projectId} />);
    await screen.findByRole("button", { name: "连接 Catalog MCP" });
    await user.click(screen.getByRole("button", { name: "连接 Catalog MCP" }));
    await user.click(screen.getByRole("button", { name: "删除 Catalog MCP" }));
    await user.click(screen.getByRole("button", { name: "确认删除 Catalog MCP" }));
    await act(async () => pendingConnect.resolve({ ...connection, status: "connected" }));

    expect(refreshTools).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "断开 Catalog MCP" })).not.toBeInTheDocument();
  });

  it("saves a local configuration without implying it connected", async () => {
    const createConnection = vi.fn().mockResolvedValue(connection);
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({
      listConnections: vi.fn().mockResolvedValue([]),
      createConnection,
    })} projectId={projectId} />);

    await screen.findByRole("heading", { name: "连接管理" });
    await user.click(screen.getByRole("button", { name: "添加连接" }));
    await user.type(screen.getByLabelText("连接名称"), "Catalog MCP");
    await user.type(screen.getByLabelText("MCP URL"), "https://mcp.example.test/mcp");
    await user.clear(screen.getByLabelText("请求超时（毫秒）"));
    await user.type(screen.getByLabelText("请求超时（毫秒）"), "10000");
    await user.click(screen.getByRole("button", { name: "保存连接" }));

    expect(createConnection).toHaveBeenCalledWith(projectId, {
      name: "Catalog MCP",
      url: "https://mcp.example.test/mcp",
      transport: "streamable-http",
      authMode: "none",
      redactSensitiveInfo: true,
      timeoutMs: 10_000,
    });
    expect(await screen.findByText("未连接")).toBeVisible();
    expect(screen.queryByText(/已连接|连接成功/)).not.toBeInTheDocument();
  });

  it("saves OAuth automatic authorization from the connection dialog", async () => {
    const createConnection = vi.fn().mockResolvedValue({ ...connection, authMode: "oauth" });
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({ listConnections: vi.fn().mockResolvedValue([]), createConnection })} projectId={projectId} />);
    await screen.findByRole("heading", { name: "连接管理" });
    await user.click(screen.getByRole("button", { name: "添加连接" }));
    await user.type(screen.getByLabelText("连接名称"), "OAuth MCP");
    await user.type(screen.getByLabelText("MCP URL"), "https://mcp.example.test/mcp");
    await user.selectOptions(screen.getByLabelText("认证方式"), "oauth");
    await user.click(screen.getByRole("button", { name: "保存连接" }));
    expect(createConnection).toHaveBeenCalledWith(projectId, expect.objectContaining({ authMode: "oauth" }));
    expect(await screen.findByText("OAuth")).toBeVisible();
  });

  it("saves Bearer Token authentication, toggles visibility, and preserves custom headers", async () => {
    const bearerConnection = {
      ...connection,
      authMode: "bearer" as const,
      bearerToken: "opaque.test-token_123",
      headers: { "X-Tenant": "supplier-eu" },
    };
    const createConnection = vi.fn().mockResolvedValue(bearerConnection);
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({
      listConnections: vi.fn().mockResolvedValue([]), createConnection,
    })} projectId={projectId} />);

    await screen.findByRole("heading", { name: "连接管理" });
    await user.click(screen.getByRole("button", { name: "添加连接" }));
    await user.type(screen.getByLabelText("连接名称"), "Bearer MCP");
    await user.type(screen.getByLabelText("MCP URL"), "https://mcp.example.test/mcp");
    await user.selectOptions(screen.getByLabelText("认证方式"), "bearer");
    const tokenInput = screen.getByLabelText("Bearer Token");
    await user.type(tokenInput, "opaque.test-token_123");
    expect(tokenInput).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "显示 Bearer Token" }));
    expect(tokenInput).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "添加 Header" }));
    await user.type(screen.getByLabelText("Header 名称 1"), "X-Tenant");
    await user.type(screen.getByLabelText("Header 值 1"), "supplier-eu");
    await user.click(screen.getByRole("button", { name: "保存连接" }));

    expect(createConnection).toHaveBeenCalledWith(projectId, expect.objectContaining({
      authMode: "bearer",
      bearerToken: "opaque.test-token_123",
      headers: { "X-Tenant": "supplier-eu" },
    }));
    expect(await screen.findByText("Bearer Token")).toBeVisible();
  });

  it("adds, removes, and edits custom authentication headers in the connection dialog", async () => {
    const withHeaders = {
      ...connection,
      headers: { Authorization: "Bearer local-secret", "X-Tenant": "supplier-eu" },
    };
    const updateConnection = vi.fn().mockResolvedValue(withHeaders);
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({
      listConnections: vi.fn().mockResolvedValue([withHeaders]), updateConnection,
    })} projectId={projectId} />);

    await user.click(await screen.findByRole("button", { name: "编辑 Catalog MCP" }));
    expect(screen.getByLabelText("Header 名称 1")).toHaveValue("Authorization");
    expect(screen.getByLabelText("Header 值 1")).toHaveValue("Bearer local-secret");
    expect(screen.getByLabelText("Header 值 1")).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "显示 Header Authorization" }));
    expect(screen.getByLabelText("Header 值 1")).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "隐藏 Header Authorization" }));
    expect(screen.getByLabelText("Header 值 1")).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "删除 Header Authorization" }));
    await user.click(screen.getByRole("button", { name: "添加 Header" }));
    await user.type(screen.getByLabelText("Header 名称 2"), "X-API-Key");
    await user.type(screen.getByLabelText("Header 值 2"), "replacement-secret");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect(updateConnection).toHaveBeenCalledWith(projectId, connection.id, expect.objectContaining({
      headers: { "X-Tenant": "supplier-eu", "X-API-Key": "replacement-secret" },
    }));
  });

  it("edits a failed saved connection and keeps the form recoverable", async () => {
    const failed = { ...connection, status: "failed" as const,
      lastError: { code: "MCP_CONNECT_FAILED", message: "Unable to connect to MCP server" } };
    const updated = { ...connection, name: "Fixed MCP", url: "https://fixed.example.test/mcp", timeoutMs: 20_000 };
    const updateConnection = vi.fn().mockRejectedValueOnce(new Error("database is busy")).mockResolvedValueOnce(updated);
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({
      listConnections: vi.fn().mockResolvedValue([failed]), updateConnection,
    })} projectId={projectId} />);

    await screen.findByText("Catalog MCP");
    expect(screen.getByText("Unable to connect to MCP server")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "编辑 Catalog MCP" }));
    expect(screen.getByRole("dialog", { name: "编辑连接" })).toBeVisible();
    expect(screen.getByLabelText("连接名称")).toHaveValue("Catalog MCP");
    expect(screen.getByLabelText("MCP URL")).toHaveValue("https://mcp.example.test/mcp");
    await user.clear(screen.getByLabelText("连接名称"));
    await user.type(screen.getByLabelText("连接名称"), "Fixed MCP");
    await user.clear(screen.getByLabelText("MCP URL"));
    await user.type(screen.getByLabelText("MCP URL"), "https://fixed.example.test/mcp");
    await user.clear(screen.getByLabelText("请求超时（毫秒）"));
    await user.type(screen.getByLabelText("请求超时（毫秒）"), "20000");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("database is busy");
    expect(screen.getByLabelText("连接名称")).toHaveValue("Fixed MCP");

    await user.click(screen.getByRole("button", { name: "保存修改" }));
    expect(updateConnection).toHaveBeenLastCalledWith(projectId, connection.id, {
      name: "Fixed MCP", url: "https://fixed.example.test/mcp", authMode: "none", timeoutMs: 20_000,
      headers: {}, redactSensitiveInfo: true,
    });
    expect(await screen.findByText("Fixed MCP")).toBeVisible();
    expect(screen.getByText("https://fixed.example.test/mcp")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "编辑连接" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("连接名称")).not.toBeInTheDocument();
  });

  it("cancels editing without changing the saved connection", async () => {
    const updateConnection = vi.fn();
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({ updateConnection })} projectId={projectId} />);
    await screen.findByText("Catalog MCP");
    await user.click(screen.getByRole("button", { name: "编辑 Catalog MCP" }));
    await user.clear(screen.getByLabelText("连接名称"));
    await user.type(screen.getByLabelText("连接名称"), "Discard me");
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(updateConnection).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "编辑连接" })).not.toBeInTheDocument();
    expect(screen.getByText("Catalog MCP")).toBeVisible();
    expect(screen.queryByLabelText("连接名称")).not.toBeInTheDocument();
  });

  it("requires confirmation before delete and keeps errors actionable", async () => {
    const deleteConnection = vi.fn().mockRejectedValueOnce(new Error("database is busy"));
    const connected = { ...connection, status: "connected" as const };
    const savedTool: CatalogToolSummary = {
      projectId, connectionId: connection.id, name: "offline/tool", status: "current", folderId: null,
      favorite: false, lastUsedAt: null,
      updatedAt: "2026-08-17T12:00:00.000Z",
      currentSnapshot: {
        id: "00000000-0000-4000-8000-000000000410", projectId,
        connectionId: connection.id, toolName: "offline/tool", contentHash: "a".repeat(64),
        definition: { name: "offline/tool", inputSchema: { type: "object" } },
        createdAt: "2026-08-17T12:00:00.000Z",
      },
    };
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({
      listConnections: vi.fn().mockResolvedValue([connected]),
      listTools: vi.fn().mockResolvedValue([savedTool]),
      deleteConnection,
    })} projectId={projectId} />);
    await screen.findByText("Catalog MCP");
    expect(await screen.findByRole("button", { name: "offline/tool" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "删除 Catalog MCP" }));
    expect(deleteConnection).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "删除连接" })).toHaveTextContent("确认删除 Catalog MCP？");
    await user.click(screen.getByRole("button", { name: "确认删除 Catalog MCP" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("database is busy");
    expect(screen.getByText("Catalog MCP")).toBeVisible();
    expect(screen.getByRole("button", { name: "offline/tool" })).toBeVisible();
  });

  it("retries the initial list after an accessible load error", async () => {
    const listConnections = vi.fn()
      .mockRejectedValueOnce(new Error("database is busy"))
      .mockResolvedValueOnce([connection]);
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({ listConnections })} projectId={projectId} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("database is busy");
    await user.click(screen.getByRole("button", { name: "重试加载连接配置" }));

    expect(await screen.findByText("Catalog MCP")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(listConnections).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale list completion after switching projects", async () => {
    const oldList = deferred<typeof connection[]>();
    const newConnection = {
      ...connection,
      id: "00000000-0000-4000-8000-000000000404",
      projectId: secondProjectId,
      name: "Orders MCP",
    };
    const listConnections = vi.fn()
      .mockReturnValueOnce(oldList.promise)
      .mockResolvedValueOnce([newConnection]);
    const client = api({ listConnections });
    const { rerender } = render(<ConnectionPanel api={client} projectId={projectId} />);

    rerender(<ConnectionPanel api={client} projectId={secondProjectId} />);
    expect(await screen.findByText("Orders MCP")).toBeVisible();
    await act(async () => oldList.resolve([connection]));

    await waitFor(() => expect(screen.queryByText("Catalog MCP")).not.toBeInTheDocument());
    expect(screen.getByText("Orders MCP")).toBeVisible();
  });

  it("clears a previous project error when switching projects", async () => {
    const newConnection = {
      ...connection,
      projectId: secondProjectId,
      name: "Orders MCP",
    };
    const client = api({
      listConnections: vi.fn()
        .mockRejectedValueOnce(new Error("first project failed"))
        .mockResolvedValueOnce([newConnection]),
    });
    const { rerender } = render(<ConnectionPanel api={client} projectId={projectId} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("first project failed");

    rerender(<ConnectionPanel api={client} projectId={secondProjectId} />);
    expect(await screen.findByText("Orders MCP")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("replaces the project-scoped panel synchronously with clean local state", async () => {
    const newList = deferred<typeof connection[]>();
    const client = api({
      listConnections: vi.fn()
        .mockResolvedValueOnce([connection])
        .mockReturnValueOnce(newList.promise),
    });
    const user = userEvent.setup();
    const { rerender } = render(<ConnectionPanel api={client} projectId={projectId} />);
    await screen.findByText("Catalog MCP");
    await user.click(screen.getByRole("button", { name: "添加连接" }));
    await user.type(screen.getByLabelText("连接名称"), "draft name");
    await user.type(screen.getByLabelText("MCP URL"), "https://draft.example/mcp");
    await user.click(screen.getByRole("button", { name: "删除 Catalog MCP" }));
    const oldRegion = screen.getByRole("region", { name: "连接管理" });

    rerender(<ConnectionPanel api={client} projectId={secondProjectId} />);

    const newRegion = screen.getByRole("region", { name: "连接管理" });
    expect(newRegion).not.toBe(oldRegion);
    expect(screen.queryByText("Catalog MCP")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("连接名称")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载连接配置");

    await act(async () => newList.resolve([]));
  });

  it("does not apply a stale create completion and resets the form on project switch", async () => {
    const pendingCreate = deferred<typeof connection>();
    const newConnection = {
      ...connection,
      id: "00000000-0000-4000-8000-000000000405",
      projectId: secondProjectId,
      name: "Orders MCP",
    };
    const client = api({
      listConnections: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([newConnection]),
      createConnection: vi.fn().mockReturnValue(pendingCreate.promise),
    });
    const user = userEvent.setup();
    const { rerender } = render(<ConnectionPanel api={client} projectId={projectId} />);
    await screen.findByText("还没有连接配置。");
    await user.click(screen.getByRole("button", { name: "添加连接" }));
    await user.type(screen.getByLabelText("连接名称"), "Catalog MCP");
    await user.type(screen.getByLabelText("MCP URL"), "https://mcp.example.test/mcp");
    await user.click(screen.getByRole("button", { name: "保存连接" }));

    rerender(<ConnectionPanel api={client} projectId={secondProjectId} />);
    expect(await screen.findByText("Orders MCP")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => pendingCreate.resolve(connection));

    await waitFor(() => expect(screen.queryByText("Catalog MCP")).not.toBeInTheDocument());
    expect(screen.getByText("Orders MCP")).toBeVisible();
  });

  it("does not reuse an old async scope after switching A to B to A", async () => {
    const pendingOldCreate = deferred<typeof connection>();
    const ordersConnection = {
      ...connection,
      id: "00000000-0000-4000-8000-000000000406",
      projectId: secondProjectId,
      name: "Orders MCP",
    };
    const freshCatalogConnection = {
      ...connection,
      id: "00000000-0000-4000-8000-000000000407",
      name: "Fresh Catalog MCP",
    };
    const client = api({
      listConnections: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([ordersConnection])
        .mockResolvedValueOnce([freshCatalogConnection]),
      createConnection: vi.fn().mockReturnValue(pendingOldCreate.promise),
    });
    const user = userEvent.setup();
    const { rerender } = render(<ConnectionPanel api={client} projectId={projectId} />);
    await screen.findByText("还没有连接配置。");
    await user.click(screen.getByRole("button", { name: "添加连接" }));
    await user.type(screen.getByLabelText("连接名称"), "Catalog MCP");
    await user.type(screen.getByLabelText("MCP URL"), "https://mcp.example.test/mcp");
    await user.click(screen.getByRole("button", { name: "保存连接" }));

    rerender(<ConnectionPanel api={client} projectId={secondProjectId} />);
    expect(await screen.findByText("Orders MCP")).toBeVisible();
    rerender(<ConnectionPanel api={client} projectId={projectId} />);
    expect(await screen.findByText("Fresh Catalog MCP")).toBeVisible();
    await act(async () => pendingOldCreate.resolve(connection));

    await waitFor(() => expect(screen.queryByText("Catalog MCP")).not.toBeInTheDocument());
    expect(screen.getByText("Fresh Catalog MCP")).toBeVisible();
  });

  it("does not apply a stale delete completion to the new project", async () => {
    const pendingDelete = deferred<void>();
    const sameIdInNewProject = {
      ...connection,
      projectId: secondProjectId,
      name: "Orders MCP",
    };
    const client = api({
      listConnections: vi.fn()
        .mockResolvedValueOnce([connection])
        .mockResolvedValueOnce([sameIdInNewProject]),
      deleteConnection: vi.fn().mockReturnValue(pendingDelete.promise),
    });
    const user = userEvent.setup();
    const { rerender } = render(<ConnectionPanel api={client} projectId={projectId} />);
    await screen.findByText("Catalog MCP");
    await user.click(screen.getByRole("button", { name: "删除 Catalog MCP" }));
    await user.click(screen.getByRole("button", { name: "确认删除 Catalog MCP" }));

    rerender(<ConnectionPanel api={client} projectId={secondProjectId} />);
    expect(await screen.findByText("Orders MCP")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "删除连接" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除 Orders MCP" })).toBeEnabled();
    await act(async () => pendingDelete.resolve());

    expect(await screen.findByText("Orders MCP")).toBeVisible();
  });

  it("never applies an old project's delayed Tool catalog to the new scope", async () => {
    const oldCatalog = deferred<Awaited<ReturnType<InspectorApiClient["listTools"]>>>();
    const ordersConnection = {
      ...connection,
      id: "00000000-0000-4000-8000-000000000408",
      projectId: secondProjectId,
      name: "Orders MCP",
    };
    const staleTool: CatalogToolSummary = {
      projectId,
      connectionId: connection.id,
      name: "stale/tool",
      status: "current" as const, folderId: null, favorite: false, lastUsedAt: null,
      updatedAt: "2026-08-17T12:00:00.000Z",
      currentSnapshot: {
        id: "00000000-0000-4000-8000-000000000409",
        projectId,
        connectionId: connection.id,
        toolName: "stale/tool",
        contentHash: "a".repeat(64),
        definition: { name: "stale/tool", inputSchema: { type: "object" } },
        createdAt: "2026-08-17T12:00:00.000Z",
      },
    };
    const client = api({
      listConnections: vi.fn()
        .mockResolvedValueOnce([connection])
        .mockResolvedValueOnce([ordersConnection]),
      listTools: vi.fn()
        .mockReturnValueOnce(oldCatalog.promise)
        .mockResolvedValueOnce([]),
    });
    const { rerender } = render(<ConnectionPanel api={client} projectId={projectId} />);
    await screen.findByRole("button", { name: "连接 Catalog MCP" });

    rerender(<ConnectionPanel api={client} projectId={secondProjectId} />);
    await screen.findByRole("button", { name: "连接 Orders MCP" });
    await act(async () => oldCatalog.resolve([staleTool]));

    expect(screen.queryByRole("button", { name: "stale/tool" })).not.toBeInTheDocument();
  });
});
