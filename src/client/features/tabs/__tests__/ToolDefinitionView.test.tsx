// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolDetailSummary } from "../../../api/api-client.js";
import { ToolDefinitionView } from "../ToolDefinitionView.js";

const detail: ToolDetailSummary = {
  tool: {
    projectId: "00000000-0000-4000-8000-000000000801",
    connectionId: "00000000-0000-4000-8000-000000000802",
    name: "apply_product_mapping",
    status: "current",
    updatedAt: "2026-08-24T09:27:36.623Z",
    currentSnapshot: {
      id: "00000000-0000-4000-8000-000000000803",
      projectId: "00000000-0000-4000-8000-000000000801",
      connectionId: "00000000-0000-4000-8000-000000000802",
      toolName: "apply_product_mapping",
      contentHash: "8b568dd0c20844ff8564459e9c1c98d1d65a37e100a8d2b68ab24b04ac895149",
      createdAt: "2026-08-24T09:27:36.623Z",
      definition: {
        name: "apply_product_mapping",
        description: "**\\[Store Products\\]** **\\[What it does\\]** Applies a confirmed mapping. **\\[When to use\\]** Run after `save SKU mapping`.",
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        inputSchema: {
          type: "object",
          required: ["dsers_product_id"],
          properties: {
            dsers_product_id: { type: "string", description: "Exact DSers product ID." },
            mapping: { type: "array", description: "Sales-product mapping rows." },
          },
        },
        outputSchema: {
          type: "object",
          properties: { message: { type: "string", description: "Verification guidance." } },
        },
      },
    },
  },
  snapshots: [],
};

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ToolDefinitionView", () => {
  it("turns structured description markers into readable sections without exposing Markdown syntax", () => {
    render(<ToolDefinitionView detail={detail} />);

    expect(screen.getByRole("heading", { name: "Store Products" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "What it does" })).toBeVisible();
    expect(screen.getByText("save SKU mapping")).toHaveRole("code");
    expect(screen.queryByText(/\*\*|\\\[/)).not.toBeInTheDocument();
  });

  it("summarizes behavioral annotations and presents Schema fields as readable tables", () => {
    render(<ToolDefinitionView detail={detail} />);

    expect(screen.getByText("破坏性操作")).toBeVisible();
    expect(screen.getByText("非幂等")).toBeVisible();
    const input = screen.getByRole("table", { name: "Input Schema 字段" });
    expect(input).toHaveTextContent("dsers_product_id");
    expect(input).toHaveTextContent("必填");
    expect(input).toHaveTextContent("Exact DSers product ID.");
    expect(screen.getByRole("table", { name: "Output Schema 字段" })).toHaveTextContent("message");
  });

  it("shows copy success in a temporary toast instead of beside the copy button", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ToolDefinitionView detail={detail} />);

    const button = screen.getByRole("button", { name: "复制完整定义" });
    fireEvent.click(button);
    await act(async () => Promise.resolve());
    const toast = screen.getByRole("status");
    expect(toast).toHaveClass("copy-toast");
    expect(toast).toHaveTextContent("已复制");
    expect(button.parentElement).not.toContainElement(toast);
    act(() => vi.advanceTimersByTime(1_999));
    expect(toast).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
