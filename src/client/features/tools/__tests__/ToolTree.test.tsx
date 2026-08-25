// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogToolSummary, ConnectionSummary } from "../../../api/api-client.js";
import { ToolTree } from "../ToolTree.js";

const projectId = "00000000-0000-4000-8000-000000000541";
const first: ConnectionSummary = {
  id: "00000000-0000-4000-8000-000000000542", projectId, name: "Catalog MCP",
  url: "https://example.test/mcp", transport: "streamable-http", authMode: "none",
  timeoutMs: 1000, status: "connected", lastProtocolVersion: null,
  lastServerInfo: null, lastError: null,
};
const second: ConnectionSummary = { ...first,
  id: "00000000-0000-4000-8000-000000000543", name: "Orders MCP",
};
function catalog(connectionId: string, name: string, description: string, status: CatalogToolSummary["status"]): CatalogToolSummary {
  return {
    projectId, connectionId, name, status, updatedAt: "2026-08-17T12:00:00.000Z",
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
  it("groups, filters name/description, collapses, and renders status as text", async () => {
    const user = userEvent.setup();
    render(<ToolTree
      connections={[first, second]}
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
    expect(screen.getByText("已变化")).toBeVisible();
    expect(screen.getByText("已移除")).toBeVisible();
    await user.type(screen.getByRole("searchbox", { name: "搜索 Tool" }), "ADD NUMBERS");
    expect(screen.getByRole("treeitem", { name: /sum/ })).toBeVisible();
    expect(screen.queryByRole("treeitem", { name: /orders\/list/ })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "搜索 Tool" }));
    await user.click(screen.getByRole("treeitem", { name: "折叠 Catalog MCP" }));
    expect(screen.queryByRole("treeitem", { name: /sum/ })).not.toBeInTheDocument();
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

  it("shows a clean catalog summary instead of raw description markup", () => {
    render(<ToolTree
      connections={[first]}
      catalogs={{ [first.id]: [catalog(first.id, "mapping/apply",
        "**\\[Store Products\\]** **\\[What it does\\]** Applies a **confirmed** product mapping. **\\[When to use\\]** After review.", "current")] }}
      onRefresh={vi.fn()} onSelectTool={vi.fn()} onOpenTool={vi.fn()}
    />);

    expect(screen.getByText("Store Products · Applies a confirmed product mapping.")).toBeVisible();
    expect(screen.queryByText(/\*\*|\\\[/)).not.toBeInTheDocument();
  });

  it("exposes manual refresh and keeps single-click separate from a real double-click", async () => {
    const onRefresh = vi.fn();
    const onSelectTool = vi.fn();
    const onOpenTool = vi.fn();
    const user = userEvent.setup();
    const unsafe = catalog(first.id, "<img onerror=alert(1)>", "unsafe", "current");
    const { container } = render(<ToolTree
      connections={[first]} catalogs={{ [first.id]: [unsafe] }}
      errors={{ [first.id]: "目录刷新失败" }} readyConnectionIds={new Set()}
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
    expect(screen.getByRole("alert")).toHaveTextContent("目录刷新失败");
    expect(screen.getByText("已连接，目录未就绪")).toBeVisible();
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
