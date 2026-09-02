// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogToolSummary, ConnectionSummary, ToolFolderSummary } from "../../../api/api-client.js";
import { i18n } from "../../../i18n/index.js";
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
    projectId, connectionId, name, status, folderId: null, favorite: false, lastUsedAt: null,
    updatedAt: "2026-08-17T12:00:00.000Z",
    currentSnapshot: {
      id: crypto.randomUUID(), projectId, connectionId, toolName: name,
      contentHash: "a".repeat(64), createdAt: "2026-08-17T12:00:00.000Z",
      definition: { name, description, inputSchema: { type: "object" }, _meta: { safe: "<script>x</script>" } },
    },
  };
}

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await i18n.changeLanguage("zh-CN");
});

describe("ToolTree", () => {
  it("renders the Tool catalog controls and folder actions in English", async () => {
    await i18n.changeLanguage("en-US");
    const user = userEvent.setup();
    const folder: ToolFolderSummary = {
      id: "00000000-0000-4000-8000-000000000540", projectId, connectionId: first.id,
      name: "Products", createdAt: "2026-08-17T12:00:00.000Z", updatedAt: "2026-08-17T12:00:00.000Z",
    };
    render(<ToolTree connections={[first]} folders={[folder]}
      catalogs={{ [first.id]: [catalog(first.id, "legacy/tool", "Legacy", "removed")] }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()} />);

    expect(screen.getByRole("searchbox", { name: "Search Tools" })).toHaveAttribute("placeholder", "Search by name or description");
    expect(screen.getByRole("button", { name: "Create folder" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Products folder, 0 Tools" })).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Products folder actions" }));
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Delete folder" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "legacy/tool, removed" }));
    expect(screen.getByRole("dialog", { name: "Delete removed Tool" })).toBeVisible();
  });

  it("renders only the active Server tools without a Server group or collapse control", () => {
    render(<ToolTree connections={[first]}
      catalogs={{ [first.id]: [catalog(first.id, "list_stores", "Lists stores", "current")] }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()} />);

    expect(screen.getByRole("button", { name: "list_stores" })).toBeVisible();
    expect(screen.queryByText("Catalog MCP")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /折叠 Catalog MCP/ })).not.toBeInTheDocument();
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
    expect(screen.getByRole("list", { name: "MCP Tools" })).toBeVisible();
    expect(screen.getByText("Tool Catalog")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Tools" })).not.toBeInTheDocument();
    expect(screen.queryByText("搜索 Tool")).not.toBeInTheDocument();
    expect(screen.queryByText("当前")).not.toBeInTheDocument();
    expect(screen.getAllByText("已变化")).not.toHaveLength(0);
    expect(screen.getAllByText("已移除")).not.toHaveLength(0);
    await user.type(screen.getByRole("searchbox", { name: "搜索 Tool" }), "ADD NUMBERS");
    expect(screen.getByRole("button", { name: "sum，已变化" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "orders/list" })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "搜索 Tool" }));
    expect(screen.getByRole("button", { name: "sum，已变化" })).toBeVisible();
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

    const folderSelect = screen.getByRole("combobox", { name: "移动 sum 到文件夹" });
    expect(folderSelect.tagName).toBe("BUTTON");
    expect(folderSelect).toHaveAttribute("aria-expanded", "false");
    await user.click(folderSelect);
    expect(folderSelect).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("option", { name: "未分类" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("option", { name: "Commerce" }));
    expect(onMoveTool).toHaveBeenCalledWith(expect.objectContaining({ name: "sum" }), folder.id);
    await waitFor(() => expect(folderSelect).toHaveFocus());

    onMoveTool.mockClear();
    const row = screen.getByRole("button", { name: "sum" }).closest("li");
    const folderTarget = screen.getByRole("button", { name: "Commerce 文件夹，1 个 Tool" }).closest("li");
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

    const heading = screen.getByRole("button", { name: "Products 文件夹，1 个 Tool" });
    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "products/list" })).not.toBeInTheDocument();
    await user.click(heading);
    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "products/list" })).toBeVisible();
    await user.click(heading);
    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "products/list" })).not.toBeInTheDocument();
  });

  it("moves a Tool with an accessible folder listbox and closes it on Escape or outside interaction", async () => {
    const user = userEvent.setup();
    const folder: ToolFolderSummary = {
      id: "00000000-0000-4000-8000-000000000548", projectId, connectionId: first.id,
      name: "Orders", createdAt: "2026-08-17T12:00:00.000Z", updatedAt: "2026-08-17T12:00:00.000Z",
    };
    const onMoveTool = vi.fn().mockResolvedValue(undefined);
    render(<ToolTree connections={[first]} folders={[folder]} catalogs={{ [first.id]: [catalog(first.id, "get_order", "Order", "current")] }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()} onMoveTool={onMoveTool} />);

    const trigger = screen.getByRole("combobox", { name: "移动 get_order 到文件夹" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox", { name: "移动 get_order 到文件夹" })).toBeVisible();
    await waitFor(() => expect(screen.getByRole("option", { name: "未分类" })).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getByRole("option", { name: "Orders" })).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(onMoveTool).toHaveBeenCalledWith(expect.objectContaining({ name: "get_order" }), folder.id);
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "移动 get_order 到文件夹" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox", { name: "移动 get_order 到文件夹" })).not.toBeInTheDocument();
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

  it("supports keyboard navigation, focus trapping, Escape, and focus return for folder actions", async () => {
    const user = userEvent.setup();
    const folder: ToolFolderSummary = {
      id: "00000000-0000-4000-8000-000000000547", projectId, connectionId: first.id,
      name: "Keyboard", createdAt: "2026-08-17T12:00:00.000Z", updatedAt: "2026-08-17T12:00:00.000Z",
    };
    render(<ToolTree connections={[first]} folders={[folder]} catalogs={{ [first.id]: [] }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Keyboard 文件夹操作" });
    await user.click(trigger);
    const rename = screen.getByRole("menuitem", { name: "重命名" });
    const remove = screen.getByRole("menuitem", { name: "删除文件夹" });
    expect(rename).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(remove).toHaveFocus();
    await user.keyboard("{Home}");
    expect(rename).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    expect(screen.getByRole("menuitem", { name: "重命名" })).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: "重命名" })).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    const input = screen.getByRole("textbox", { name: "文件夹名称" });
    const save = screen.getByRole("button", { name: "保存修改" });
    expect(input).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(save).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(input).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "重命名文件夹" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
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
    expect(screen.getByRole("button", { name: "apply_product_mapping" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "cancel_supplier_order" })).not.toBeInTheDocument();
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

  it("filters favorites, recent use, changed and removed Tools while preserving search ranking", async () => {
    const user = userEvent.setup();
    const onToggleFavorite = vi.fn().mockResolvedValue(undefined);
    const favorite = { ...catalog(first.id, "price_exact", "Exact", "current"), favorite: true };
    const recent = { ...catalog(first.id, "recent_tool", "Recent", "current"), lastUsedAt: "2026-08-17T12:01:00.000Z" };
    const changed = catalog(first.id, "changed_tool", "Changed", "changed");
    const removed = catalog(first.id, "removed_tool", "Removed", "removed");
    render(<ToolTree connections={[first]} catalogs={{ [first.id]: [favorite, recent, changed, removed] }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()} onToggleFavorite={onToggleFavorite} />);

    await user.click(screen.getByRole("button", { name: "收藏", pressed: false }));
    expect(screen.getByRole("button", { name: "price_exact" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "recent_tool" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消收藏 price_exact" }));
    expect(onToggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ name: "price_exact", favorite: true }));

    await user.click(screen.getByRole("button", { name: "最近", pressed: false }));
    expect(screen.getByRole("button", { name: "recent_tool" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "已变化", pressed: false }));
    expect(screen.getByRole("button", { name: "changed_tool，已变化" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "已移除", pressed: false }));
    expect(screen.getByRole("button", { name: "removed_tool，已移除" })).toBeVisible();
  });

  it("keeps a 1,000 Tool catalog bounded while searching the complete catalog", async () => {
    const tools = Array.from({ length: 1_000 }, (_, index) => catalog(
      first.id,
      `catalog_tool_${String(index).padStart(4, "0")}`,
      `Catalog Tool ${index}`,
      "current",
    ));
    const { container } = render(<ToolTree connections={[first]} catalogs={{ [first.id]: tools }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()} />);

    expect(container.querySelectorAll(".tool-row").length).toBeLessThanOrEqual(200);
    expect(screen.getByText("1–200 / 1,000")).toBeVisible();
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("201–400 / 1,000")).toBeVisible();
    expect(screen.getByRole("button", { name: "上一页" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "catalog_tool_0200" })).toBeVisible();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Tool" }), {
      target: { value: "catalog_tool_0999" },
    });
    expect(screen.getByRole("button", { name: "catalog_tool_0999" })).toBeVisible();
    expect(container.querySelectorAll(".tool-row")).toHaveLength(1);
    expect(screen.queryByText("1–200 / 1,000")).not.toBeInTheDocument();
  }, 15_000);

  it("marks the active Tool and offers an explicit search clear action", async () => {
    const user = userEvent.setup();
    render(<ToolTree connections={[first]}
      catalogs={{ [first.id]: [catalog(first.id, "list_stores", "Lists stores", "current")] }}
      selectedTool={{ connectionId: first.id, name: "list_stores" }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()} />);

    expect(screen.getByRole("button", { name: "list_stores" })).toHaveAttribute("aria-current", "true");
    await user.type(screen.getByRole("searchbox", { name: "搜索 Tool" }), "missing");
    await user.click(screen.getByRole("button", { name: "清除 Tool 搜索" }));
    expect(screen.getByRole("searchbox", { name: "搜索 Tool" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "list_stores" })).toBeVisible();
  });

  it("confirms before deleting a removed Tool and never opens it for debugging", async () => {
    const user = userEvent.setup();
    const onDeleteTool = vi.fn().mockResolvedValue(undefined);
    const onSelectTool = vi.fn();
    const onOpenTool = vi.fn();
    render(<ToolTree connections={[first]}
      catalogs={{ [first.id]: [catalog(first.id, "legacy/tool", "Legacy", "removed")] }}
      onRefresh={vi.fn()} onSelectTool={onSelectTool} onOpenTool={onOpenTool} onDeleteTool={onDeleteTool} />);

    await user.click(screen.getByRole("button", { name: "legacy/tool，已移除" }));
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
    const item = screen.getByRole("button", { name: "<img onerror=alert(1)>" });
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
    const item = screen.getByRole("button", { name: "slow" });

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
