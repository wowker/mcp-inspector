// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

afterEach(cleanup);

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
    expect(screen.getByText("已变化")).toBeVisible();
    expect(screen.getByText("已移除")).toBeVisible();
    await user.type(screen.getByRole("searchbox", { name: "搜索 Tool" }), "ADD NUMBERS");
    expect(screen.getByRole("treeitem", { name: /sum/ })).toBeVisible();
    expect(screen.queryByRole("treeitem", { name: /orders\/list/ })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "搜索 Tool" }));
    await user.click(screen.getByRole("treeitem", { name: "折叠 Catalog MCP" }));
    expect(screen.queryByRole("treeitem", { name: /sum/ })).not.toBeInTheDocument();
  });

  it("exposes manual refresh and distinct selection/open intents without executing metadata", async () => {
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
    fireEvent.doubleClick(item);
    expect(onSelectTool).toHaveBeenCalledWith(expect.objectContaining({ name: unsafe.name }));
    expect(onOpenTool).toHaveBeenCalledWith(expect.objectContaining({ name: unsafe.name }));
    expect(screen.getByRole("alert")).toHaveTextContent("目录刷新失败");
    expect(screen.getByText("已连接，目录未就绪")).toBeVisible();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });
});
