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
    expect(screen.queryByRole("button", { name: /连接/ })).not.toBeInTheDocument();
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
});
