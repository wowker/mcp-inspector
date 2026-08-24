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
    listTools: vi.fn().mockResolvedValue([]), refreshTools: vi.fn().mockResolvedValue([]), getTool: vi.fn(),
    listTabs: vi.fn().mockResolvedValue([]), openTab: vi.fn(), replaceTabTool: vi.fn(), updateTab: vi.fn(),
    duplicateTab: vi.fn(), reorderTabs: vi.fn(), closeTab: vi.fn(), closeOtherTabs: vi.fn(), closeTabsRight: vi.fn(),
    startRun: vi.fn(), getRunSummary: vi.fn(), getRun: vi.fn(), listRuns: vi.fn(), openRunEventStream: vi.fn(),
  };
}

afterEach(cleanup);

describe("InspectorWorkbench", () => {
  it("fills the viewport and switches between Servers and Tools from a collapsible sidebar", async () => {
    const user = userEvent.setup();
    render(<InspectorWorkbench api={api()} project={project} version="0.1.0" />);

    expect(await screen.findByRole("heading", { name: "Servers", level: 1 })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "工作台导航" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "收起侧边栏" }));
    expect(screen.getByRole("button", { name: "展开侧边栏" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Tools" }));
    expect(await screen.findByRole("heading", { name: "Tools", level: 1 })).toBeVisible();
    expect(screen.getByText("选择一个已连接的 Server 开始调试")).toBeVisible();
  });

  it("adds and activates a Server tab after connecting, then scopes the Tools page to it", async () => {
    const user = userEvent.setup();
    const client = api();
    render(<InspectorWorkbench api={client} project={project} version="0.1.0" />);

    await user.click(await screen.findByRole("button", { name: "连接 Supplier MCP" }));
    const serverTab = await screen.findByRole("tab", { name: "Supplier MCP" });
    expect(serverTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Tools" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("heading", { name: "Tools", level: 1 })).toBeVisible();
    expect(client.listTools).toHaveBeenCalledWith(project.id, connection.id);
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
    expect(await screen.findByRole("heading", { name: "Tools", level: 1 })).toBeVisible();
    expect(client.listTools).toHaveBeenCalledWith(project.id, second.id);
    expect(client.listTools).not.toHaveBeenCalledWith(project.id, connection.id);
  });
});
