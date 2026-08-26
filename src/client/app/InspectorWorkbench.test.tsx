// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DebugTabSummary, InspectorApiClient, ProjectSummary, RunDetail, ToolDetailSummary } from "../api/api-client.js";
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
  durationMs: 10, networkDurationMs: 8, protocolVersion: "2025-06-18", serverInfo: null,
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
    deleteToolFolder: vi.fn(), moveToolToFolder: vi.fn(),
    listTabs: vi.fn().mockResolvedValue([]), openTab: vi.fn(), replaceTabTool: vi.fn(), updateTab: vi.fn(),
    duplicateTab: vi.fn(), reorderTabs: vi.fn(), closeTab: vi.fn(), closeOtherTabs: vi.fn(), closeTabsRight: vi.fn(),
    startRun: vi.fn(), getRunSummary: vi.fn(), getRun: vi.fn(),
    listRuns: vi.fn().mockResolvedValue({ runs: [], nextCursor: null }), openRunEventStream: vi.fn(),
    listSavedItems: vi.fn(), getSavedItem: vi.fn(), createSavedItem: vi.fn(), deleteSavedItem: vi.fn(),
  };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("InspectorWorkbench", () => {
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
    for (const label of ["Servers", "Tools", "运行历史"]) {
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
    expect(screen.queryByText("目录已就绪", { exact: true })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Supplier MCP" }));
    expect(await screen.findByRole("tabpanel", { name: "Supplier MCP" })).toBeVisible();
    expect(client.listTools).toHaveBeenCalledWith(project.id, connection.id);
    expect(client.refreshTools).not.toHaveBeenCalled();
  });

  it("keeps the active Server Tool catalog permanently visible and full-height", async () => {
    const user = userEvent.setup();
    const client = api();
    vi.mocked(client.listConnections).mockResolvedValue([{ ...connection, status: "connected" }]);
    render(<InspectorWorkbench api={client} project={project} version="0.1.0" />);

    await user.click(await screen.findByRole("tab", { name: "Supplier MCP" }));
    const catalog = await screen.findByRole("complementary", { name: "Tool 目录" });
    expect(catalog).not.toHaveAttribute("hidden");
    expect(screen.getByRole("tree", { name: "MCP Tools" })).toBeVisible();
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
