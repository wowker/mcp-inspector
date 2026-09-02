// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolDetailSummary } from "../../../api/api-client.js";
import { AppToaster } from "../../../app/AppToaster.js";
import { i18n } from "../../../i18n/index.js";
import { ToolDefinitionView } from "../ToolDefinitionView.js";

const detail: ToolDetailSummary = {
  tool: {
    projectId: "00000000-0000-4000-8000-000000000801",
    connectionId: "00000000-0000-4000-8000-000000000802",
    name: "apply_product_mapping",
    status: "current",
    folderId: null,
    favorite: false,
    lastUsedAt: null,
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

afterEach(async () => { cleanup(); vi.useRealTimers(); await i18n.changeLanguage("zh-CN"); });

describe("ToolDefinitionView", () => {
  it("renders definition metadata, annotations, and actions in English", async () => {
    await i18n.changeLanguage("en-US");
    render(<ToolDefinitionView detail={detail} />);

    expect(screen.getByRole("article", { name: "apply_product_mapping Tool definition" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy complete definition" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Behavior" })).toBeVisible();
    expect(screen.getByText("Destructive")).toBeVisible();
    expect(screen.getByRole("table", { name: "Input Schema fields" })).toHaveTextContent("Required");
    expect(screen.getByRole("button", { name: "About snapshot history" })).toBeVisible();
  });

  it("exposes the complete definition as a keyboard-scrollable content region", () => {
    render(<ToolDefinitionView detail={detail} />);

    expect(screen.getByRole("article", { name: "apply_product_mapping Tool 定义" })).toHaveAttribute("tabindex", "0");
    expect(screen.queryByText("CURRENT TOOL DEFINITION")).not.toBeInTheDocument();
  });

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
    expect(screen.getByText("当前")).toHaveAttribute("data-status", "success");
    const rawJsonButtons = screen.getAllByRole("button", { name: "查看 Raw JSON" });
    expect(rawJsonButtons).toHaveLength(2);
    rawJsonButtons.forEach((button) => expect(button).toHaveAttribute("aria-expanded", "false"));
  });

  it("explains historical snapshots and dismisses the explanation when clicking elsewhere", () => {
    render(<><button type="button">页面其他位置</button><ToolDefinitionView detail={detail} /></>);

    const help = screen.getByRole("button", { name: "了解历史快照" });
    expect(help).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(help);
    expect(help).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/每次 Tool 定义内容发生变化时/)).toBeVisible();

    fireEvent.pointerDown(screen.getByRole("button", { name: "页面其他位置" }));
    expect(screen.queryByText(/每次 Tool 定义内容发生变化时/)).not.toBeInTheDocument();
    expect(help).toHaveAttribute("aria-expanded", "false");
  });

  it("shows copy success in a temporary toast instead of beside the copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<><AppToaster /><ToolDefinitionView detail={detail} /></>);

    const button = screen.getByRole("button", { name: "复制完整定义" });
    fireEvent.click(button);
    const message = await screen.findByText("已复制");
    const notification = message.closest("[data-sonner-toast]");
    expect(notification).toHaveClass("app-toast");
    expect(notification).toHaveAttribute("data-type", "success");
    expect(button.parentElement).not.toContainElement(notification as HTMLElement);
  });
});
