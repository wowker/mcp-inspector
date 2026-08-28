// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogToolSummary, ConnectionSummary, ToolFolderSummary } from "../../../api/api-client.js";
import { ToolTree } from "../ToolTree.js";

const projectId = "00000000-0000-4000-8000-000000000541";
const first: ConnectionSummary = {
  id: "00000000-0000-4000-8000-000000000542", projectId, name: "Catalog MCP",
  url: "https://example.test/mcp", transport: "streamable-http", authMode: "none",
  bearerToken: null,
  headers: {},
  redactSensitiveInfo: true,
  authorizationStatus: "not-required",
  timeoutMs: 1000, status: "connected", lastProtocolVersion: null,
  lastServerInfo: null, lastError: null,
};
const second: ConnectionSummary = { ...first,
  id: "00000000-0000-4000-8000-000000000543", name: "Orders MCP",
};
function catalog(connectionId: string, name: string, description: string, status: CatalogToolSummary["status"]): CatalogToolSummary {
  return {
    projectId, connectionId, name, status, folderId: null, updatedAt: "2026-08-17T12:00:00.000Z",
    currentSnapshot: {
      id: crypto.randomUUID(), projectId, connectionId, toolName: name,
      contentHash: "a".repeat(64), createdAt: "2026-08-17T12:00:00.000Z",
      definition: { name, description, inputSchema: { type: "object" }, _meta: { safe: "<script>x</script>" } },
    },
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ToolTree", () => {
  it("renders only the active Server tools without a Server group or collapse control", () => {
    render(<ToolTree connections={[first]}
      catalogs={{ [first.id]: [catalog(first.id, "list_stores", "Lists stores", "current")] }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()} />);

    expect(screen.getByRole("treeitem", { name: "list_stores" })).toBeVisible();
    expect(screen.queryByText("Catalog MCP")).not.toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: /折叠 Catalog MCP/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建文件夹" })).toBeVisible();
  });

  it("filters the active Server catalog and renders status as text without a collapsible group", async () => {
    const user = userEvent.setup();
    render(<ToolTree
      connections={[first]}
      catalogs={{
        [first.id]: [catalog(first.id, "sum", "Add Numbers", "changed"), catalog(first.id, "old", "legacy", "removed")],
        [second.id]: [catalog(second.id, "orders/list", "Recent Orders", "current")],
      }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()}
    />);
    expect(screen.getByRole("tree", { name: "MCP Tools" })).toBeVisible();
    expect(screen.getByText("Tool Catalog")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Tools" })).not.toBeInTheDocument();
    expect(screen.queryByText("搜索 Tool")).not.toBeInTheDocument();
    expect(screen.queryByText("当前")).not.toBeInTheDocument();
    expect(screen.getByText("已变化")).toBeVisible();
    expect(screen.getByText("已移除")).toBeVisible();
    await user.type(screen.getByRole("searchbox", { name: "搜索 Tool" }), "ADD NUMBERS");
    expect(screen.getByRole("treeitem", { name: /sum/ })).toBeVisible();
    expect(screen.queryByRole("treeitem", { name: /orders\/list/ })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "搜索 Tool" }));
    expect(screen.getByRole("treeitem", { name: /sum/ })).toBeVisible();
    expect(screen.queryByText("Catalog MCP")).not.toBeInTheDocument();
  });

  it("sorts folders first and creates or moves Tools with drag and keyboard-accessible controls", async () => {
    const user = userEvent.setup();
    const folder: ToolFolderSummary = {
      id: "00000000-0000-4000-8000-000000000544", projectId, connectionId: first.id,
      name: "Commerce", createdAt: "2026-08-17T12:00:00.000Z", updatedAt: "2026-08-17T12:00:00.000Z",
    };
    const filed = { ...catalog(first.id, "orders/list", "Recent orders", "current"), folderId: folder.id };
    const loose = catalog(first.id, "sum", "Add numbers", "current");
    const onCreateFolder = vi.fn().mockResolvedValue(undefined);
    const onMoveTool = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<ToolTree connections={[first]} folders={[folder]}
      catalogs={{ [first.id]: [loose, filed] }} onRefresh={vi.fn()} onSelectTool={vi.fn()}
      onOpenTool={vi.fn()} onCreateFolder={onCreateFolder} onMoveTool={onMoveTool} />);

    const labels = [...container.querySelectorAll(".tool-folder-heading strong, .tool-unfiled-heading")]
      .map((node) => node.textContent?.trim());
    expect(labels).toEqual(["Commerce", "未分类 1"]);

    await user.click(screen.getByRole("button", { name: "创建文件夹" }));
    await user.type(screen.getByRole("textbox", { name: "文件夹名称" }), "Fulfillment");
    await user.click(screen.getByRole("button", { name: "创建" }));
    expect(onCreateFolder).toHaveBeenCalledWith("Fulfillment");

    await user.selectOptions(screen.getByRole("combobox", { name: "移动 sum 到文件夹" }), folder.id);
    expect(onMoveTool).toHaveBeenCalledWith(expect.objectContaining({ name: "sum" }), folder.id);

    onMoveTool.mockClear();
    const row = screen.getByRole("treeitem", { name: "sum" }).closest("li");
    const folderTarget = screen.getByRole("treeitem", { name: "Commerce 文件夹，1 个 Tool" }).closest("li");
    const dataTransfer = { effectAllowed: "none", setData: vi.fn() };
    fireEvent.dragStart(row!, { dataTransfer });
    fireEvent.dragEnter(folderTarget!, { dataTransfer });
    fireEvent.drop(folderTarget!, { dataTransfer });
    expect(onMoveTool).toHaveBeenCalledWith(expect.objectContaining({ name: "sum" }), folder.id);
  });

  it("shows folders collapsed by default and toggles their Tool groups from the folder heading", async () => {
    const user = userEvent.setup();
    const folder: ToolFolderSummary = {
      id: "00000000-0000-4000-8000-000000000545", projectId, connectionId: first.id,
      name: "Products", createdAt: "2026-08-17T12:00:00.000Z", updatedAt: "2026-08-17T12:00:00.000Z",
    };
    const filed = { ...catalog(first.id, "products/list", "Products", "current"), folderId: folder.id };
    render(<ToolTree connections={[first]} folders={[folder]} catalogs={{ [first.id]: [filed] }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()} />);

    const heading = screen.getByRole("treeitem", { name: "Products 文件夹，1 个 Tool" });
    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: "products/list" })).not.toBeInTheDocument();
    await user.click(heading);
    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: "products/list" })).toBeVisible();
    await user.click(heading);
    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: "products/list" })).not.toBeInTheDocument();
  });

  it("renames and deletes a folder from its menu while keeping the collapse action independent", async () => {
    const user = userEvent.setup();
    const folder: ToolFolderSummary = {
      id: "00000000-0000-4000-8000-000000000546", projectId, connectionId: first.id,
      name: "Products", createdAt: "2026-08-17T12:00:00.000Z", updatedAt: "2026-08-17T12:00:00.000Z",
    };
    const filed = { ...catalog(first.id, "products/list", "Products", "current"), folderId: folder.id };
    const onRenameFolder = vi.fn().mockResolvedValue(undefined);
    const onDeleteFolder = vi.fn().mockResolvedValue(undefined);
    render(<ToolTree connections={[first]} folders={[folder]} catalogs={{ [first.id]: [filed] }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()}
      onRenameFolder={onRenameFolder} onDeleteFolder={onDeleteFolder} />);

    await user.click(screen.getByRole("button", { name: "Products 文件夹操作" }));
    expect(screen.getByRole("menu")).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Products 文件夹操作" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    const name = screen.getByRole("textbox", { name: "文件夹名称" });
    expect(name).toHaveValue("Products");
    await user.clear(name); await user.type(name, "Catalog");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    expect(onRenameFolder).toHaveBeenCalledWith(folder, "Catalog");

    await user.click(screen.getByRole("button", { name: "Products 文件夹操作" }));
    await user.click(screen.getByRole("menuitem", { name: "删除文件夹" }));
    expect(screen.getByText(/1 个 Tool 将移到“未分类”/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "确认删除文件夹" }));
    expect(onDeleteFolder).toHaveBeenCalledWith(folder);
  });

  it("fuzzy-matches incomplete tokens across a Tool name and its description", async () => {
    const user = userEvent.setup();
    render(<ToolTree
      connections={[first]}
      catalogs={{ [first.id]: [
        catalog(first.id, "apply_product_mapping", "Store Products · Applies a confirmed supplier mapping", "current"),
        catalog(first.id, "cancel_supplier_order", "Cancel an asynchronous order", "current"),
      ] }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()}
    />);

    await user.type(screen.getByRole("searchbox", { name: "搜索 Tool" }), "prd map");
    expect(screen.getByRole("treeitem", { name: /apply_product_mapping/ })).toBeVisible();
    expect(screen.queryByRole("treeitem", { name: /cancel_supplier_order/ })).not.toBeInTheDocument();
  });

  it("ranks an exact Tool name ahead of partial name and description matches", async () => {
    const user = userEvent.setup();
    const { container } = render(<ToolTree
      connections={[first]}
      catalogs={{ [first.id]: [
        catalog(first.id, "price_helper", "Calls update_pre_publish_product_price after validation", "current"),
        catalog(first.id, "update_pre_publish_product_prices_preview", "Preview product prices", "current"),
        catalog(first.id, "update_pre_publish_product_price", "Update one product price", "current"),
      ] }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()}
    />);

    await user.type(screen.getByRole("searchbox", { name: "搜索 Tool" }), "update_pre_publish_product_price");
    expect([...container.querySelectorAll(".tool-item strong")].map((node) => node.textContent)).toEqual([
      "update_pre_publish_product_price",
      "update_pre_publish_product_prices_preview",
      "price_helper",
    ]);
  });

  it("does not render Tool descriptions in catalog rows", () => {
    render(<ToolTree
      connections={[first]}
      catalogs={{ [first.id]: [catalog(first.id, "mapping/apply",
        "**\\[Store Products\\]** **\\[What it does\\]** Applies a **confirmed** product mapping. **\\[When to use\\]** After review.", "current")] }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()}
    />);

    expect(screen.queryByText("Store Products · Applies a confirmed product mapping.")).not.toBeInTheDocument();
    expect(screen.queryByText(/\*\*|\\\[/)).not.toBeInTheDocument();
  });

  it("marks the active Tool and offers an explicit search clear action", async () => {
    const user = userEvent.setup();
    render(<ToolTree connections={[first]}
      catalogs={{ [first.id]: [catalog(first.id, "list_stores", "Lists stores", "current")] }}
      selectedTool={{ connectionId: first.id, name: "list_stores" }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()} />);

    expect(screen.getByRole("treeitem", { name: "list_stores" })).toHaveAttribute("aria-current", "true");
    await user.type(screen.getByRole("searchbox", { name: "搜索 Tool" }), "missing");
    await user.click(screen.getByRole("button", { name: "清除 Tool 搜索" }));
    expect(screen.getByRole("searchbox", { name: "搜索 Tool" })).toHaveValue("");
    expect(screen.getByRole("treeitem", { name: "list_stores" })).toBeVisible();
  });

  it("confirms before deleting a removed Tool and never opens it for debugging", async () => {
    const user = userEvent.setup();
    const onDeleteTool = vi.fn().mockResolvedValue(undefined);
    const onSelectTool = vi.fn();
    const onOpenTool = vi.fn();
    render(<ToolTree connections={[first]}
      catalogs={{ [first.id]: [catalog(first.id, "legacy/tool", "Legacy", "removed")] }}
      onRefresh={vi.fn()} onSelectTool={onSelectTool} onOpenTool={onOpenTool} onDeleteTool={onDeleteTool} />);

    await user.click(screen.getByRole("treeitem", { name: "legacy/tool，已移除" }));
    expect(screen.getByRole("dialog", { name: "删除已移除 Tool" })).toBeVisible();
    expect(onSelectTool).not.toHaveBeenCalled();
    expect(onOpenTool).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认删除 legacy/tool" }));
    expect(onDeleteTool).toHaveBeenCalledWith(expect.objectContaining({ name: "legacy/tool", status: "removed" }));
    expect(screen.queryByRole("dialog", { name: "删除已移除 Tool" })).not.toBeInTheDocument();
  });

  it("exposes manual refresh and keeps single-click separate from a real double-click", async () => {
    const onRefresh = vi.fn();
    const onSelectTool = vi.fn();
    const onOpenTool = vi.fn();
    const user = userEvent.setup();
    const unsafe = catalog(first.id, "<img onerror=alert(1)>", "unsafe", "current");
    const { container } = render(<ToolTree
      connections={[first]} catalogs={{ [first.id]: [unsafe] }}
      onRefresh={onRefresh} onSelectTool={onSelectTool} onOpenTool={onOpenTool}
    />);
    await user.click(screen.getByRole("button", { name: "刷新 Catalog MCP Tools" }));
    expect(onRefresh).toHaveBeenCalledWith(first.id);
    const item = screen.getByRole("treeitem", { name: /img onerror/ });
    await user.click(item);
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(onSelectTool).toHaveBeenCalledWith(expect.objectContaining({ name: unsafe.name }));
    onSelectTool.mockClear();
    await user.dblClick(item);
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(onSelectTool).not.toHaveBeenCalled();
    expect(onOpenTool).toHaveBeenCalledWith(expect.objectContaining({ name: unsafe.name }));
    item.focus();
    await user.keyboard("{Enter}");
    expect(onSelectTool).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("已连接，目录未就绪")).not.toBeInTheDocument();
    expect(container.querySelector(".catalog-readiness")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("keeps a slow pointer double-click separate while a single click eventually selects once", () => {
    vi.useFakeTimers();
    const onSelectTool = vi.fn();
    const onOpenTool = vi.fn();
    render(<ToolTree
      connections={[first]} catalogs={{ [first.id]: [catalog(first.id, "slow", "Slow double click", "current")] }}
      onRefresh={vi.fn()} onSelectTool={onSelectTool} onOpenTool={onOpenTool}
    />);
    const item = screen.getByRole("treeitem", { name: /slow/ });

    fireEvent.click(item, { detail: 1 });
    act(() => vi.advanceTimersByTime(450));
    fireEvent.click(item, { detail: 2 });
    fireEvent.doubleClick(item, { detail: 2 });
    act(() => vi.advanceTimersByTime(550));

    expect(onSelectTool).not.toHaveBeenCalled();
    expect(onOpenTool).toHaveBeenCalledOnce();

    fireEvent.click(item, { detail: 1 });
    act(() => vi.advanceTimersByTime(499));
    expect(onSelectTool).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onSelectTool).toHaveBeenCalledOnce();
  });
});
