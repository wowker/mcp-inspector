// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient, ProjectSummary } from "../api/api-client.js";
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
  headers: {},
  timeoutMs: 20_000,
  status: "disconnected" as const,
  lastProtocolVersion: null,
  lastServerInfo: null,
  lastError: null,
};

function api(): InspectorApiClient {
  return {
    listProjects: vi.fn(), createProject: vi.fn(), openProject: vi.fn(),
    listConnections: vi.fn().mockResolvedValue([connection]),
    createConnection: vi.fn(), updateConnection: vi.fn(), deleteConnection: vi.fn(),
    connectConnection: vi.fn().mockResolvedValue({ ...connection, status: "connected" }),
    disconnectConnection: vi.fn().mockResolvedValue(connection),
    listTools: vi.fn().mockResolvedValue([]), refreshTools: vi.fn().mockResolvedValue([]), getTool: vi.fn(), deleteTool: vi.fn(),
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
  });

  it("refreshes the active Server catalog when entering Tools from the sidebar", async () => {
    const user = userEvent.setup();
    const client = api();
    vi.mocked(client.listConnections).mockResolvedValue([{ ...connection, status: "connected" }]);
    render(<InspectorWorkbench api={client} project={project} version="0.1.0" />);

    expect(await screen.findByRole("tab", { name: "Supplier MCP" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Servers", level: 1 })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Tools" }));

    expect(await screen.findByRole("tabpanel", { name: "Supplier MCP" })).toBeVisible();
    expect(client.refreshTools).toHaveBeenCalledTimes(1);
    expect(client.refreshTools).toHaveBeenCalledWith(project.id, connection.id);
    expect(await screen.findByText("Supplier MCP 的 Tool 目录已就绪")).toHaveClass("catalog-toast");
    expect(screen.queryByText("已连接，目录未就绪")).not.toBeInTheDocument();
  });

  it("moves to Tools and acknowledges an OAuth callback from the authorization tab", async () => {
    class FakeBroadcastChannel {
      static instance: FakeBroadcastChannel | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage = vi.fn(); close = vi.fn();
      constructor(readonly name: string) { FakeBroadcastChannel.instance = this; }
      emit(data: unknown) { this.onmessage?.(new MessageEvent("message", { data })); }
    }
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    vi.spyOn(window, "focus").mockImplementation(() => undefined);
    const client = api(); vi.mocked(client.listConnections).mockResolvedValue([{ ...connection, status: "connected" }]);
    render(<InspectorWorkbench api={client} project={project} version="0.1.0" />);
    await screen.findByRole("heading", { name: "Servers", level: 1 });
    await screen.findByRole("tab", { name: "Supplier MCP" });

    FakeBroadcastChannel.instance?.emit({ type: "oauth-complete", connectionId: "00000000-0000-4000-8000-000000000799" });
    expect(screen.getByRole("heading", { name: "Servers", level: 1 })).toBeVisible();
    expect(FakeBroadcastChannel.instance?.postMessage).not.toHaveBeenCalled();
    FakeBroadcastChannel.instance?.emit({ type: "oauth-complete", connectionId: connection.id });

    expect(await screen.findByRole("tabpanel", { name: "Supplier MCP" })).toBeVisible();
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
    expect(client.refreshTools).toHaveBeenCalledWith(project.id, second.id);
    expect(client.refreshTools).not.toHaveBeenCalledWith(project.id, connection.id);
    expect(await screen.findByText("Warehouse MCP 的 Tool 目录已就绪")).toHaveAttribute("role", "status");
    expect(screen.queryByText("目录已就绪", { exact: true })).not.toBeInTheDocument();
  });

  it("lets the user collapse and restore the Tool catalog without leaving the active Server", async () => {
    const user = userEvent.setup();
    const client = api();
    vi.mocked(client.listConnections).mockResolvedValue([{ ...connection, status: "connected" }]);
    render(<InspectorWorkbench api={client} project={project} version="0.1.0" />);

    await user.click(await screen.findByRole("tab", { name: "Supplier MCP" }));
    const catalog = await screen.findByRole("complementary", { name: "Tool 目录" });
    const collapse = screen.getByRole("button", { name: "隐藏 Tool 目录" });
    expect(catalog).toContainElement(collapse);
    await user.click(collapse);
    expect(catalog).toHaveAttribute("hidden");
    const restore = screen.getByRole("button", { name: "显示 Tool 目录" });
    expect(restore).toHaveClass("catalog-restore");
    await user.click(restore);
    expect(catalog).not.toHaveAttribute("hidden");
  });
});
