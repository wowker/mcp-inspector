// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient } from "../../../api/api-client.js";
import { ConnectionPanel } from "../ConnectionPanel.js";

const projectId = "00000000-0000-4000-8000-000000000401";
const connection = {
  id: "00000000-0000-4000-8000-000000000402",
  projectId,
  name: "Catalog MCP",
  url: "https://mcp.example.test/mcp",
  transport: "streamable-http" as const,
  authMode: "none" as const,
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
    deleteConnection: vi.fn().mockResolvedValue(undefined),
    connectConnection: vi.fn().mockResolvedValue({ ...connection, status: "connected" }),
    disconnectConnection: vi.fn().mockResolvedValue(connection),
    listTools: vi.fn().mockResolvedValue([]),
    refreshTools: vi.fn().mockResolvedValue([]),
    getTool: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("ConnectionPanel", () => {
  it("lists saved configurations as disconnected and presents fixed transport/auth modes", async () => {
    render(<ConnectionPanel api={api()} projectId={projectId} />);

    expect(await screen.findByRole("heading", { name: "连接管理" })).toBeVisible();
    expect(screen.getByText("Catalog MCP")).toBeVisible();
    expect(screen.getByText(/disconnected.*未连接/i)).toBeVisible();
    expect(screen.getByText("Streamable HTTP")).toBeVisible();
    expect(screen.getByText("无认证")).toBeVisible();
    expect(screen.getByRole("button", { name: "连接 Catalog MCP" })).toBeVisible();
  });

  it("performs exactly one Tool refresh after connect and can disconnect explicitly", async () => {
    const connectConnection = vi.fn().mockResolvedValue({ ...connection, status: "connected" });
    const refreshTools = vi.fn().mockResolvedValue([]);
    const disconnectConnection = vi.fn().mockResolvedValue(connection);
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({ connectConnection, refreshTools, disconnectConnection })} projectId={projectId} />);
    await screen.findByText("Catalog MCP");

    await user.click(screen.getByRole("button", { name: "连接 Catalog MCP" }));
    await waitFor(() => expect(refreshTools).toHaveBeenCalledTimes(1));
    expect(refreshTools).toHaveBeenCalledWith(projectId, connection.id);
    expect(screen.getByText("目录已就绪")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "断开 Catalog MCP" }));
    expect(disconnectConnection).toHaveBeenCalledWith(projectId, connection.id);
  });

  it("keeps a successful transport connected when its automatic refresh fails", async () => {
    const refreshTools = vi.fn().mockRejectedValue(new Error("目录刷新失败"));
    const disconnectConnection = vi.fn().mockResolvedValue(connection);
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({ refreshTools, disconnectConnection })} projectId={projectId} />);
    await screen.findByText("Catalog MCP");
    await user.click(screen.getByRole("button", { name: "连接 Catalog MCP" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("目录刷新失败");
    expect(screen.getByRole("button", { name: "断开 Catalog MCP" })).toBeVisible();
    expect(screen.getByText("已连接，目录未就绪")).toBeVisible();
    expect(disconnectConnection).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "刷新 Catalog MCP Tools" }));
    expect(refreshTools).toHaveBeenCalledTimes(2);
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "断开 Catalog MCP" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("synchronously invalidates an in-flight refresh when disconnecting", async () => {
    const pendingRefresh = deferred<Awaited<ReturnType<InspectorApiClient["refreshTools"]>>>();
    const connected = { ...connection, status: "connected" as const };
    const refreshTools = vi.fn()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(pendingRefresh.promise);
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({
      connectConnection: vi.fn().mockResolvedValue(connected),
      disconnectConnection: vi.fn().mockResolvedValue(connection),
      refreshTools,
    })} projectId={projectId} />);
    await screen.findByText("Catalog MCP");
    await user.click(screen.getByRole("button", { name: "连接 Catalog MCP" }));
    expect(await screen.findByText("目录已就绪")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "刷新 Catalog MCP Tools" }));
    expect(screen.getByRole("button", { name: "刷新 Catalog MCP Tools" })).toHaveTextContent("刷新中");
    expect(screen.getByText("正在刷新 Tool 目录")).toHaveAttribute("aria-live", "polite");

    await user.click(screen.getByRole("button", { name: "断开 Catalog MCP" }));

    expect(screen.getByRole("button", { name: "刷新 Catalog MCP Tools" })).toHaveTextContent("刷新");
    expect(screen.queryByText("目录已就绪")).not.toBeInTheDocument();
    await act(async () => pendingRefresh.resolve([]));
    expect(screen.queryByText("目录已就绪")).not.toBeInTheDocument();
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
    expect(screen.queryByRole("treeitem", { name: "折叠 Catalog MCP" })).not.toBeInTheDocument();

    await act(async () => pendingRefresh.resolve([]));
    expect(screen.queryByRole("treeitem", { name: "折叠 Catalog MCP" })).not.toBeInTheDocument();
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
    await user.type(screen.getByLabelText("连接名称"), "Catalog MCP");
    await user.type(screen.getByLabelText("MCP URL"), "https://mcp.example.test/mcp");
    await user.clear(screen.getByLabelText("请求超时（毫秒）"));
    await user.type(screen.getByLabelText("请求超时（毫秒）"), "10000");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    expect(createConnection).toHaveBeenCalledWith(projectId, {
      name: "Catalog MCP",
      url: "https://mcp.example.test/mcp",
      transport: "streamable-http",
      authMode: "none",
      timeoutMs: 10_000,
    });
    expect(await screen.findByText(/disconnected.*未连接/i)).toBeVisible();
    expect(screen.queryByText(/已连接|连接成功/)).not.toBeInTheDocument();
  });

  it("requires confirmation before delete and keeps errors actionable", async () => {
    const deleteConnection = vi.fn().mockRejectedValueOnce(new Error("database is busy"));
    const user = userEvent.setup();
    render(<ConnectionPanel api={api({ deleteConnection })} projectId={projectId} />);
    await screen.findByText("Catalog MCP");

    await user.click(screen.getByRole("button", { name: "删除 Catalog MCP" }));
    expect(deleteConnection).not.toHaveBeenCalled();
    expect(screen.getByText("确认删除 Catalog MCP？")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "确认删除 Catalog MCP" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("database is busy");
    expect(screen.getByText("Catalog MCP")).toBeVisible();
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
    await user.type(screen.getByLabelText("连接名称"), "draft name");
    await user.type(screen.getByLabelText("MCP URL"), "https://draft.example/mcp");
    await user.click(screen.getByRole("button", { name: "删除 Catalog MCP" }));
    const oldRegion = screen.getByRole("region", { name: "连接管理" });

    rerender(<ConnectionPanel api={client} projectId={secondProjectId} />);

    const newRegion = screen.getByRole("region", { name: "连接管理" });
    expect(newRegion).not.toBe(oldRegion);
    expect(screen.queryByText("Catalog MCP")).not.toBeInTheDocument();
    expect(screen.queryByText("确认删除 Catalog MCP？")).not.toBeInTheDocument();
    expect(screen.getByLabelText("连接名称")).toHaveValue("");
    expect(screen.getByLabelText("MCP URL")).toHaveValue("");
    expect(screen.getByLabelText("请求超时（毫秒）")).toHaveValue(10000);
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
    await user.type(screen.getByLabelText("连接名称"), "Catalog MCP");
    await user.type(screen.getByLabelText("MCP URL"), "https://mcp.example.test/mcp");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    rerender(<ConnectionPanel api={client} projectId={secondProjectId} />);
    expect(await screen.findByText("Orders MCP")).toBeVisible();
    expect(screen.getByLabelText("连接名称")).toHaveValue("");
    expect(screen.getByLabelText("MCP URL")).toHaveValue("");
    expect(screen.getByLabelText("请求超时（毫秒）")).toHaveValue(10000);
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
    await user.type(screen.getByLabelText("连接名称"), "Catalog MCP");
    await user.type(screen.getByLabelText("MCP URL"), "https://mcp.example.test/mcp");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

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
    expect(screen.queryByText("确认删除 Orders MCP？")).not.toBeInTheDocument();
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
    const staleTool = {
      projectId,
      connectionId: connection.id,
      name: "stale/tool",
      status: "current" as const,
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

    expect(screen.queryByRole("treeitem", { name: /stale\/tool/ })).not.toBeInTheDocument();
  });
});
