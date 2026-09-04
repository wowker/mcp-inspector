// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DebugTabSummary, InspectorApiClient, ProjectSummary, RunDetail, ToolDetailSummary } from "../api/api-client.js";
import { i18n } from "../i18n/index.js";
import { InspectorWorkbench } from "./InspectorWorkbench.js";

const project: ProjectSummary = {
  id: "00000000-0000-4000-8000-000000000701",
  name: "mcp-tool",
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
  lastOpenedAt: "2026-08-17T00:00:00.000Z",
};
const connection = {
  id: "00000000-0000-4000-8000-000000000702",
  projectId: project.id,
  name: "Supplier MCP",
  url: "https://mcp.example.test/mcp",
  transport: "streamable-http" as const,
  authMode: "oauth" as const,
  bearerToken: null,
  headers: {},
  redactSensitiveInfo: true,
  authorizationStatus: "required" as const,
  timeoutMs: 20_000,
  status: "disconnected" as const,
  lastProtocolVersion: null,
  lastServerInfo: null,
  lastError: null,
};

const historyTool: ToolDetailSummary = {
  tool: { projectId: project.id, connectionId: connection.id, name: "sum", status: "current", folderId: null,
    favorite: false, lastUsedAt: null,
    updatedAt: "2026-08-26T00:00:00.000Z", currentSnapshot: {
      id: "00000000-0000-4000-8000-000000000704", projectId: project.id, connectionId: connection.id,
      toolName: "sum", contentHash: "a".repeat(64), createdAt: "2026-08-26T00:00:00.000Z",
      definition: { name: "sum", inputSchema: { type: "object", properties: {
        a: { type: "number" }, b: { type: "number" },
      } } },
    } }, snapshots: [],
};
const historyRun: RunDetail = {
  id: "00000000-0000-4000-8000-000000000705", projectId: project.id, connectionId: connection.id,
  tabId: "00000000-0000-4000-8000-000000000706", toolName: "sum",
  toolSnapshotId: historyTool.tool.currentSnapshot.id, toolSnapshotHash: "a".repeat(64),
  idempotencyKey: "history-open", status: "succeeded", createdAt: "2026-08-26T00:00:00.000Z",
  startedAt: "2026-08-26T00:00:00.010Z", completedAt: "2026-08-26T00:00:00.020Z",
  durationMs: 10, networkDurationMs: 8, pinned: false, replayedFromRunId: null,
  protocolVersion: "2025-06-18", serverInfo: null,
  clientInfo: { name: "mcp-inspector", version: "0.1.0" },
  request: { arguments: { a: 40, b: 2 }, jsonrpc: {}, http: null },
  response: { result: { structuredContent: { answer: 42 } }, error: null, truncated: false, originalBytes: 32 },
  events: [],
};

function restoredTab(patch: Partial<DebugTabSummary> = {}): DebugTabSummary {
  return { id: "00000000-0000-4000-8000-000000000707", projectId: project.id, connectionId: connection.id,
    toolName: "sum", title: "sum", position: 0, pinned: false, inputMode: "form", arguments: {}, rawText: "",
    viewState: { editorScrollTop: 0, resultScrollTop: 0, splitRatio: 0.5 }, lastRunId: null, ...patch };
}

function api(): InspectorApiClient {
  return {
    listProjects: vi.fn(), createProject: vi.fn(), openProject: vi.fn(),
    listConnections: vi.fn().mockResolvedValue([connection]),
    createConnection: vi.fn(), updateConnection: vi.fn(), exportConnection: vi.fn(), deleteConnection: vi.fn(),
    connectConnection: vi.fn().mockResolvedValue({ ...connection, status: "connected" }),
    disconnectConnection: vi.fn().mockResolvedValue(connection),
    listTools: vi.fn().mockResolvedValue([]), refreshTools: vi.fn().mockResolvedValue([]), getTool: vi.fn(), deleteTool: vi.fn(),
    listToolFolders: vi.fn().mockResolvedValue([]), createToolFolder: vi.fn(), renameToolFolder: vi.fn(),
    deleteToolFolder: vi.fn(), moveToolToFolder: vi.fn(), setToolFavorite: vi.fn(), markToolUsed: vi.fn(),
    getToolWorkflow: vi.fn(), updateToolWorkflow: vi.fn(), validateToolWorkflow: vi.fn(), debugToolWorkflow: vi.fn(),
    listEnvironmentVariables: vi.fn().mockResolvedValue([]), setEnvironmentVariable: vi.fn(), deleteEnvironmentVariable: vi.fn(),
    listEnvironmentProfiles: vi.fn().mockResolvedValue([]), createEnvironmentProfile: vi.fn(), updateEnvironmentProfile: vi.fn(), deleteEnvironmentProfile: vi.fn(),
    listEnvironmentProfileVariables: vi.fn().mockResolvedValue([]), setEnvironmentProfileVariable: vi.fn(), deleteEnvironmentProfileVariable: vi.fn(),
    getConnectionEnvironmentProfile: vi.fn(), setConnectionEnvironmentProfile: vi.fn(), previewConnectionEnvironmentProfile: vi.fn(),
    listTabs: vi.fn().mockResolvedValue([]), openTab: vi.fn(), replaceTabTool: vi.fn(), updateTab: vi.fn(),
    duplicateTab: vi.fn(), reorderTabs: vi.fn(), closeTab: vi.fn(), closeOtherTabs: vi.fn(), closeTabsRight: vi.fn(),
    startRun: vi.fn(), startWorkflowExecution: vi.fn(), getActiveWorkflowExecution: vi.fn().mockResolvedValue(null), getWorkflowExecution: vi.fn(), cancelWorkflowExecution: vi.fn(),
    getRunSummary: vi.fn(), getRun: vi.fn(),
    listRuns: vi.fn().mockResolvedValue({ runs: [], nextCursor: null }), setRunPinned: vi.fn(), deleteRun: vi.fn(), clearRunHistory: vi.fn(), openRunEventStream: vi.fn(),
    getReplayPreflight: vi.fn(), startReplay: vi.fn(),
    listComparisonRules: vi.fn().mockResolvedValue({ rules: [] }), replaceComparisonRules: vi.fn(), getRunComparison: vi.fn(),
    listSavedItems: vi.fn(), getSavedItem: vi.fn(), createSavedItem: vi.fn(), deleteSavedItem: vi.fn(),
    listTestCases: vi.fn().mockResolvedValue({ items: [], nextCursor: null }), getTestCase: vi.fn(), createTestCase: vi.fn(), updateTestCase: vi.fn(), deleteTestCase: vi.fn(),
    previewTestCaseFromRun: vi.fn(), previewTestCaseFromSavedItem: vi.fn(),
    listTestSuites: vi.fn().mockResolvedValue({ items: [] }), getTestSuite: vi.fn(), createTestSuite: vi.fn(), updateTestSuite: vi.fn(), deleteTestSuite: vi.fn(),
    startTestSuiteExecution: vi.fn(), getTestSuiteExecution: vi.fn(), cancelTestSuiteExecution: vi.fn(),
    startTestExecution: vi.fn(), listTestExecutions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }), updateTestExecutionBaseline: vi.fn(), getTestExecution: vi.fn(), cancelTestExecution: vi.fn(),
    exportAutomatedTests: vi.fn(), importAutomatedTests: vi.fn(),
  };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); void i18n.changeLanguage("zh-CN"); });

describe("InspectorWorkbench", () => {
  it("separates the local service status from footer controls so long versions cannot cover actions", () => {
    const { container } = render(<InspectorWorkbench api={api()} project={project}
      version="2.0.2-rc.1+desktop.long-build" />);

    const footer = container.querySelector(".workbench-sidebar__footer");
    expect(footer?.querySelector(".workbench-sidebar__service-row")).toHaveTextContent(
      "本地服务 v2.0.2-rc.1+desktop.long-build",
    );
    expect(footer?.querySelector(".sidebar-controls")).toContainElement(
      screen.getByRole("button", { name: "切换到深色主题" }),
    );
    expect(screen.getByText("本地服务 v2.0.2-rc.1+desktop.long-build")).toHaveAttribute(
      "title", "本地服务 v2.0.2-rc.1+desktop.long-build",
    );
  });

  it("uses an accessible compact language picker in a narrow sidebar", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      media: "(max-width: 900px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    render(<InspectorWorkbench api={api()} project={project} version="2.0.2" />);

    const picker = screen.getByRole("button", { name: "界面语言" });
    expect(screen.queryByRole("combobox", { name: "界面语言" })).not.toBeInTheDocument();
    await user.click(picker);
    expect(screen.getByRole("option", { name: "简体中文" })).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(document.documentElement).toHaveAttribute("lang", "en-US");
    expect(screen.getByRole("button", { name: "Interface language" })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens structured module help beside each supported page title", async () => {
    const user = userEvent.setup();
    render(<InspectorWorkbench api={api()} project={project} version="2.0.2" />);

    const modules = [
      { navigation: "环境变量", trigger: "了解环境变量", title: "环境变量", description: "集中管理连接认证与脚本可复用的配置值。" },
      { navigation: "自动化测试", trigger: "了解自动化测试", title: "自动化测试", description: "配置可重复执行的 Tool 参数、断言和超时策略。" },
      { navigation: "测试套件", trigger: "了解测试套件", title: "测试套件", description: "组合单 Tool 与场景用例，并以有限并发执行。" },
      { navigation: "测试报告", trigger: "了解测试报告", title: "测试报告", description: "查看执行历史、断言结果与完整调用追溯。" },
      { navigation: "运行历史", trigger: "了解运行历史", title: "运行历史", description: "查看项目内所有 Tool 调用，按时间回溯请求、响应和协议轨迹。" },
    ] as const;

    for (const module of modules) {
      await user.click(screen.getByRole("button", { name: module.navigation }));
      const title = await screen.findByRole("heading", { name: module.title, level: 1 });
      const trigger = screen.getByRole("button", { name: module.trigger });
      expect(title.parentElement).toContainElement(trigger);
      await user.click(trigger);
      const dialog = screen.getByRole("dialog", { name: module.title });
      expect(dialog).toHaveTextContent(module.description);
      for (const section of ["模块用途", "如何配置", "如何使用", "产生效果"]) {
        expect(within(dialog).getByRole("heading", { name: section, level: 3 })).toBeVisible();
      }
      await user.click(within(dialog).getByRole("button", { name: `关闭${module.title}说明` }));
      expect(trigger).toHaveFocus();
    }
  });

  it("switches locale in place without rebuilding the active Server workspace", async () => {
    await i18n.changeLanguage("zh-CN");
    const user = userEvent.setup();
    const client = api();
    vi.mocked(client.listConnections).mockResolvedValue([{ ...connection, status: "connected" }]);
    render(<InspectorWorkbench api={client} project={project} version="0.1.0" />);

    await user.click(await screen.findByRole("tab", { name: "Supplier MCP" }));
    const language = screen.getByRole("combobox", { name: "界面语言" });
    await user.selectOptions(language, "en-US");

    expect(screen.getByRole("button", { name: "Environment" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Run history" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Supplier MCP" })).toHaveAttribute("aria-selected", "true");
    expect(client.listTabs).toHaveBeenCalledTimes(1);
    expect(document.documentElement).toHaveAttribute("lang", "en-US");
    expect(localStorage.getItem("mcp-inspector.locale")).toBe("en-US");
    expect(document.cookie).toContain("mcp_inspector_locale=en-US");

    await user.click(screen.getByRole("button", { name: "Environment" }));
    await user.click(await screen.findByRole("button", { name: "Learn about Environment variables" }));
    expect(screen.getByRole("heading", { name: "How to configure", level: 3 })).toBeVisible();

    await i18n.changeLanguage("zh-CN");
  });

  it("offers an accessible control for switching the application theme", async () => {
    const user = userEvent.setup();
    render(<InspectorWorkbench api={api()} project={project} version="0.1.0" />);

    const themeToggle = screen.getByRole("button", { name: "切换到深色主题" });
    await user.click(themeToggle);

    expect(screen.getByRole("button", { name: "切换到浅色主题" })).toBeVisible();
    expect(document.documentElement).toHaveAttribute("data-color-mode", "dark");
  });

  it("fills the viewport and switches between Servers and Tools from a collapsible sidebar", async () => {
    const user = userEvent.setup();
    const { container } = render(<InspectorWorkbench api={api()} project={project} version="0.1.0" />);

    expect(await screen.findByRole("heading", { name: "Servers", level: 1 })).toBeVisible();
    expect(screen.queryByRole("button", { name: "添加 Server" })).not.toBeInTheDocument();
    expect(container.querySelector(".project-identity")).not.toBeInTheDocument();
    expect(container.querySelector(".server-tabbar__actions")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "工作台导航" })).toBeVisible();
    for (const label of ["Servers", "Tools", "环境变量", "自动化测试", "运行历史"]) {
      const icon = screen.getByRole("button", { name: label }).querySelector(".workbench-nav-icon");
      expect(icon).toBeVisible();
      expect(icon).toHaveAttribute("width", "18");
      expect(icon).toHaveAttribute("height", "18");
    }
    await user.click(screen.getByRole("button", { name: "收起侧边栏" }));
    expect(screen.getByRole("button", { name: "展开侧边栏" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.getByRole("tabpanel", { name: "Tools" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Tools", level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText("选择 Tool，编辑参数并查看完整调用轨迹。")).not.toBeInTheDocument();
    expect(screen.getByText("选择一个已连接的 Server 开始调试")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "环境变量" }));
    expect(await screen.findByRole("heading", { name: "环境变量", level: 1 })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "自动化测试" }));
    expect(await screen.findByRole("heading", { name: "自动化测试", level: 1 })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "运行历史" }));
    expect(await screen.findByRole("heading", { name: "运行历史", level: 1 })).toBeVisible();
    expect(screen.getByText("选择一条运行记录")).toBeVisible();
  });

  it("adds and activates a Server tab after connecting, then scopes the Tools page to it", async () => {
    const user = userEvent.setup();
    const client = api();
    render(<InspectorWorkbench api={client} project={project} version="0.1.0" />);

    await user.click(await screen.findByRole("button", { name: "连接 Supplier MCP" }));
    const serverTab = await screen.findByRole("tab", { name: "Supplier MCP" });
    expect(serverTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Tools" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("tabpanel", { name: "Supplier MCP" })).toBeVisible();
    expect(client.listTools).toHaveBeenCalledWith(project.id, connection.id);
    expect(client.refreshTools).toHaveBeenCalledTimes(1);

    vi.mocked(client.listConnections).mockResolvedValue([{ ...connection, status: "connected" }]);
    await user.click(screen.getByRole("button", { name: "Servers" }));
    await screen.findByRole("heading", { name: "Servers", level: 1 });
    await user.click(screen.getByRole("button", { name: "Tools" }));
    expect(await screen.findByRole("tabpanel", { name: "Supplier MCP" })).toBeVisible();
    expect(client.refreshTools).toHaveBeenCalledTimes(1);
  });

  it("disconnects a closed Server tab and does not restore it while switching Servers and Tools", async () => {
    const user = userEvent.setup();
    const client = api();
    const connected = { ...connection, status: "connected" as const, authorizationStatus: "authorized" as const };
    const disconnected = { ...connected, status: "disconnected" as const };
    vi.mocked(client.listConnections).mockResolvedValueOnce([connected]).mockResolvedValue([disconnected]);
    vi.mocked(client.disconnectConnection).mockResolvedValue(disconnected);
    render(<InspectorWorkbench api={client} project={project} version="2.0.5" />);

    await user.click(await screen.findByRole("tab", { name: "Supplier MCP" }));
    const trigger = screen.getByRole("button", { name: "Supplier MCP Server 操作" });
    await user.click(trigger);
    expect(screen.getByRole("menu", { name: "Supplier MCP Server 操作" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Supplier MCP Server 操作" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "关闭 Server 页签" }));
    await waitFor(() => expect(client.disconnectConnection).toHaveBeenCalledWith(project.id, connection.id));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Supplier MCP" })).not.toBeInTheDocument());
    expect(screen.getByText("选择一个已连接的 Server 开始调试")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Servers" }));
    expect(await screen.findByText("已授权")).toBeVisible();
    expect(screen.getByText("待连接")).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Supplier MCP" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.queryByRole("tab", { name: "Supplier MCP" })).not.toBeInTheDocument();
    expect(screen.getByText("选择一个已连接的 Server 开始调试")).toBeVisible();
  });

  it("loads the saved catalog without refreshing when entering Tools from the sidebar", async () => {
    const user = userEvent.setup();
    const client = api();
    vi.mocked(client.listConnections).mockResolvedValue([{ ...connection, status: "connected" }]);
    render(<InspectorWorkbench api={client} project={project} version="0.1.0" />);

    expect(await screen.findByRole("tab", { name: "Supplier MCP" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Servers", level: 1 })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Tools" }));

    expect(await screen.findByRole("tabpanel", { name: "Supplier MCP" })).toBeVisible();
    expect(client.refreshTools).not.toHaveBeenCalled();
    expect(screen.queryByText("已连接，目录未就绪")).not.toBeInTheDocument();
  });

  it("opens a catalog Tool click in a new Tab instead of replacing the active Tab", async () => {
    const user = userEvent.setup();
    const client = api();
    const connected = { ...connection, status: "connected" as const };
    const existing = restoredTab({ toolName: "sum", title: "sum" });
    const nextTool = {
      ...historyTool.tool,
      name: "get_price",
      currentSnapshot: {
        ...historyTool.tool.currentSnapshot,
        toolName: "get_price",
        definition: { ...historyTool.tool.currentSnapshot.definition, name: "get_price" },
      },
    };
    const opened = restoredTab({
      id: "00000000-0000-4000-8000-000000000709",
      toolName: "get_price",
      title: "get_price",
      position: 1,
    });
    vi.mocked(client.listConnections).mockResolvedValue([connected]);
    vi.mocked(client.listTools).mockResolvedValue([nextTool]);
    vi.mocked(client.listTabs).mockResolvedValue([existing]);
    vi.mocked(client.markToolUsed).mockResolvedValue(nextTool);
    vi.mocked(client.openTab).mockResolvedValue(opened);
    vi.mocked(client.getTool).mockImplementation(async (_projectId, _connectionId, toolName) => ({
      ...historyTool,
      tool: {
        ...(toolName === "get_price" ? nextTool : historyTool.tool),
        currentSnapshot: toolName === "get_price" ? nextTool.currentSnapshot : historyTool.tool.currentSnapshot,
      },
    }));
    render(<InspectorWorkbench api={client} project={project} version="0.1.0" />);

    await user.click(await screen.findByRole("tab", { name: "Supplier MCP" }));
    await user.click(await screen.findByRole("button", { name: "get_price" }));

    await screen.findByRole("tab", { name: "get_price" });
    expect(client.openTab).toHaveBeenCalledWith(project.id, connection.id, "get_price");
    expect(client.replaceTabTool).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "sum" })).toBeVisible();
  });

  it("does not reopen the last Tool intent after navigating away and back", async () => {
    const user = userEvent.setup();
    const client = api();
    const connected = { ...connection, status: "connected" as const };
    const opened = restoredTab({ toolName: "sum", title: "sum" });
    let persistedTabs: DebugTabSummary[] = [];
    vi.mocked(client.listConnections).mockResolvedValue([connected]);
    vi.mocked(client.listTools).mockResolvedValue([historyTool.tool]);
    vi.mocked(client.listTabs).mockImplementation(async () => persistedTabs);
    vi.mocked(client.openTab).mockImplementation(async () => { persistedTabs = [opened]; return opened; });
    vi.mocked(client.getTool).mockResolvedValue(historyTool);
    vi.mocked(client.markToolUsed).mockResolvedValue(historyTool.tool);
    render(<InspectorWorkbench api={client} project={project} version="2.0.3" />);

    await user.click(await screen.findByRole("tab", { name: "Supplier MCP" }));
    await user.click(await screen.findByRole("button", { name: "sum" }));
    await screen.findByRole("tab", { name: "sum" });
    expect(client.openTab).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "自动化测试" }));
    await screen.findByRole("heading", { name: "自动化测试" });
    await user.click(screen.getByRole("button", { name: "Tools" }));
    await screen.findByRole("tab", { name: "sum" });
    expect(client.openTab).toHaveBeenCalledTimes(1);
  });

  it("preserves Tool debug, test-case, and suite drafts while switching between their navigation pages", async () => {
    const user = userEvent.setup();
    const client = api();
    const connected = { ...connection, status: "connected" as const };
    const current = restoredTab({ arguments: { a: 1, b: 2 }, rawText: '{\n  "a": 1,\n  "b": 2\n}' });
    vi.mocked(client.listConnections).mockResolvedValue([connected]);
    vi.mocked(client.listTabs).mockResolvedValue([current]);
    vi.mocked(client.getTool).mockResolvedValue(historyTool);
    vi.mocked(client.updateTab).mockImplementation(async (_projectId, _tabId, patch) => ({ ...current, ...patch }));
    render(<InspectorWorkbench api={client} project={project} version="2.1.1" />);

    await user.click(await screen.findByRole("tab", { name: "Supplier MCP" }));
    const toolsSlot = document.querySelector<HTMLElement>(".workbench-page-slot:not([hidden])")!;
    fireEvent.change(await within(toolsSlot).findByLabelText("a"), { target: { value: "73" } });

    await user.click(screen.getByRole("button", { name: "自动化测试" }));
    const testingSlot = document.querySelector<HTMLElement>(".workbench-page-slot:not([hidden])")!;
    await user.click(await within(testingSlot).findByRole("button", { name: "新建测试用例" }));
    await user.type(within(testingSlot).getByLabelText("名称"), "保留中的用例草稿");

    await user.click(screen.getByRole("button", { name: "测试套件" }));
    const suitesSlot = document.querySelector<HTMLElement>(".workbench-page-slot:not([hidden])")!;
    await user.click(await within(suitesSlot).findByRole("button", { name: "新建测试套件" }));
    await user.type(within(suitesSlot).getByLabelText("名称"), "保留中的套件草稿");

    await user.click(screen.getByRole("button", { name: "自动化测试" }));
    expect(within(document.querySelector<HTMLElement>(".workbench-page-slot:not([hidden])")!)
      .getByLabelText("名称")).toHaveValue("保留中的用例草稿");
    await user.click(screen.getByRole("button", { name: "Tools" }));
    expect(within(document.querySelector<HTMLElement>(".workbench-page-slot:not([hidden])")!)
      .getByLabelText("a")).toHaveValue(73);
    expect(client.listTabs).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "测试套件" }));
    expect(within(document.querySelector<HTMLElement>(".workbench-page-slot:not([hidden])")!)
      .getByLabelText("名称")).toHaveValue("保留中的套件草稿");
  });

  it("keeps Tool intent sequences monotonic after earlier intents are cleared", async () => {
    const user = userEvent.setup();
    const client = api();
    const connected = { ...connection, status: "connected" as const };
    const first = restoredTab({ toolName: "sum", title: "sum" });
    const second = restoredTab({ id: "00000000-0000-4000-8000-000000000710", toolName: "sum", title: "sum (2)", position: 1 });
    vi.mocked(client.listConnections).mockResolvedValue([connected]);
    vi.mocked(client.listTools).mockResolvedValue([historyTool.tool]);
    vi.mocked(client.listTabs).mockResolvedValue([]);
    vi.mocked(client.openTab).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    vi.mocked(client.getTool).mockResolvedValue(historyTool);
    vi.mocked(client.markToolUsed).mockResolvedValue(historyTool.tool);
    render(<InspectorWorkbench api={client} project={project} version="2.0.3" />);

    await user.click(await screen.findByRole("tab", { name: "Supplier MCP" }));
    const toolButton = await screen.findByRole("button", { name: "sum" });
    await user.click(toolButton);
    await screen.findByRole("tab", { name: /^sum$/ });
    await user.click(toolButton);
    await screen.findByRole("tab", { name: "sum (2)" });

    expect(client.openTab).toHaveBeenCalledTimes(2);
  });

  it("returns to Servers after OAuth authorization and waits for a later connection before opening Tools", async () => {
    class FakeBroadcastChannel {
      static instance: FakeBroadcastChannel | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage = vi.fn(); close = vi.fn();
      constructor(readonly name: string) { FakeBroadcastChannel.instance = this; }
      emit(data: unknown) { this.onmessage?.(new MessageEvent("message", { data })); }
    }
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    vi.spyOn(window, "focus").mockImplementation(() => undefined);
    const authorized = { ...connection, authorizationStatus: "authorized" as const };
    const client = api(); vi.mocked(client.listConnections).mockResolvedValue([authorized]);
    render(<InspectorWorkbench api={client} project={project} version="0.1.0" />);
    await screen.findByRole("heading", { name: "Servers", level: 1 });

    FakeBroadcastChannel.instance?.emit({ type: "oauth-complete", connectionId: "00000000-0000-4000-8000-000000000799" });
    expect(screen.getByRole("heading", { name: "Servers", level: 1 })).toBeVisible();
    expect(FakeBroadcastChannel.instance?.postMessage).not.toHaveBeenCalled();
    FakeBroadcastChannel.instance?.emit({ type: "oauth-complete", connectionId: connection.id });

    expect(await screen.findByRole("heading", { name: "Servers", level: 1 })).toBeVisible();
    expect(await screen.findByText("已授权")).toBeVisible();
    expect(screen.getByText("待连接")).toBeVisible();
    expect(screen.queryByRole("tabpanel", { name: "Supplier MCP" })).not.toBeInTheDocument();
    expect(FakeBroadcastChannel.instance?.postMessage).toHaveBeenCalledWith({
      type: "oauth-ready", connectionId: connection.id,
    });
  });

  it("restores tabs for Servers that are already connected without leaving management", async () => {
    const user = userEvent.setup();
    const client = api();
    const second = { ...connection, id: "00000000-0000-4000-8000-000000000703", name: "Warehouse MCP", status: "connected" as const };
    vi.mocked(client.listConnections).mockResolvedValue([{ ...connection, status: "connected" }, second]);
    render(<InspectorWorkbench api={client} project={project} version="0.1.0" />);

    const firstTab = await screen.findByRole("tab", { name: "Supplier MCP" });
    expect(firstTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("heading", { name: "Servers", level: 1 })).toBeVisible();
    firstTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Warehouse MCP" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Warehouse MCP" })).toBeVisible();
    expect(client.listTools).toHaveBeenCalledWith(project.id, second.id);
    expect(client.listTools).not.toHaveBeenCalledWith(project.id, connection.id);
    expect(client.refreshTools).not.toHaveBeenCalled();
    expect(screen.queryByText("目录已更新。", { exact: true })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Supplier MCP" }));
    expect(await screen.findByRole("tabpanel", { name: "Supplier MCP" })).toBeVisible();
    expect(client.listTools).toHaveBeenCalledWith(project.id, connection.id);
    expect(client.refreshTools).not.toHaveBeenCalled();
  });

  it("keeps Tool Tabs isolated when two Servers share the same URL but use different authorization", async () => {
    const user = userEvent.setup();
    const client = api();
    const oauth = { ...connection, name: "OAuth MCP", status: "connected" as const };
    const bearer = { ...connection, id: "00000000-0000-4000-8000-000000000703", name: "Bearer MCP",
      authMode: "bearer" as const, bearerToken: "secret", authorizationStatus: "not-required" as const,
      status: "connected" as const };
    const oauthTab = restoredTab({ title: "oauth_sum", connectionId: oauth.id });
    const bearerTab = restoredTab({ id: "00000000-0000-4000-8000-000000000708", title: "bearer_sum",
      connectionId: bearer.id });
    vi.mocked(client.listConnections).mockResolvedValue([oauth, bearer]);
    vi.mocked(client.listTabs).mockImplementation(async (_projectId, requestedConnectionId) =>
      requestedConnectionId === oauth.id ? [oauthTab] : requestedConnectionId === bearer.id ? [bearerTab] : []);
    vi.mocked(client.getTool).mockImplementation(async (_projectId, requestedConnectionId) => ({
      ...historyTool, tool: { ...historyTool.tool, connectionId: requestedConnectionId,
        currentSnapshot: { ...historyTool.tool.currentSnapshot, connectionId: requestedConnectionId } },
    }));
    render(<InspectorWorkbench api={client} project={project} version="0.1.0" />);

    await user.click(await screen.findByRole("tab", { name: "OAuth MCP" }));
    expect(await screen.findByRole("tab", { name: "oauth_sum" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "bearer_sum" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Bearer MCP" }));
    expect(await screen.findByRole("tab", { name: "bearer_sum" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "oauth_sum" })).not.toBeInTheDocument();
    expect(client.listTabs).toHaveBeenCalledWith(project.id, oauth.id);
    expect(client.listTabs).toHaveBeenCalledWith(project.id, bearer.id);
  });

  it("keeps the active Server Tool catalog permanently visible and full-height", async () => {
    const user = userEvent.setup();
    const client = api();
    vi.mocked(client.listConnections).mockResolvedValue([{ ...connection, status: "connected" }]);
    render(<InspectorWorkbench api={client} project={project} version="0.1.0" />);

    await user.click(await screen.findByRole("tab", { name: "Supplier MCP" }));
    const catalog = await screen.findByRole("complementary", { name: "Tool 目录" });
    expect(catalog).not.toHaveAttribute("hidden");
    expect(screen.getByRole("list", { name: "MCP Tools" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "隐藏 Tool 目录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "显示 Tool 目录" })).not.toBeInTheDocument();
  });

  it("resizes the Tool catalog with an accessible separator", async () => {
    const user = userEvent.setup();
    const client = api();
    vi.mocked(client.listConnections).mockResolvedValue([{ ...connection, status: "connected" }]);
    const { container } = render(<InspectorWorkbench api={client} project={project} version="0.1.0" />);

    await user.click(await screen.findByRole("tab", { name: "Supplier MCP" }));
    const separator = screen.getByRole("separator", { name: "调整 Tool 目录宽度" });
    expect(separator).toHaveAttribute("aria-valuenow", "300");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "312");
    expect(container.querySelector(".tools-layout")).toHaveStyle("--tool-catalog-width: 312px");
  });

  it.each([
    ["尚未打开", "disconnected"],
    ["已经打开", "connected"],
  ] as const)("opens history for a Server that is %s and restores it into one new debug Tab", async (_label, status) => {
    const user = userEvent.setup();
    const client = api();
    vi.mocked(client.listConnections).mockResolvedValue([{ ...connection, status }]);
    vi.mocked(client.listTools).mockResolvedValue([historyTool.tool]);
    vi.mocked(client.listRuns).mockResolvedValue({ runs: [historyRun], nextCursor: null });
    vi.mocked(client.getRun).mockResolvedValue(historyRun);
    vi.mocked(client.getTool).mockResolvedValue(historyTool);
    vi.mocked(client.openTab).mockResolvedValue(restoredTab());
    vi.mocked(client.updateTab).mockImplementation(async (_project, _tab, patch) => restoredTab(patch));
    render(<InspectorWorkbench api={client} project={project} version="0.1.0" />);

    await screen.findByRole("heading", { name: "Servers", level: 1 });
    await user.click(screen.getByRole("button", { name: "运行历史" }));
    await user.click(await screen.findByRole("button", { name: `打开运行 ${historyRun.id}` }));
    await user.click(await screen.findByRole("button", { name: "打开调试" }));

    const serverTabs = await screen.findAllByRole("tab", { name: "Supplier MCP" });
    expect(serverTabs).toHaveLength(1);
    expect(serverTabs[0]).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("tab", { name: "sum" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("a")).toHaveValue(40);
    expect(screen.getByLabelText("b")).toHaveValue(2);
    expect(await screen.findByLabelText(`运行 ${historyRun.id} 详情`)).toBeVisible();
  });
});
