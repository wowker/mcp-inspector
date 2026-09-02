// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient, SavedItemDetail, SavedItemSummary } from "../../../api/api-client.js";
import { i18n } from "../../../i18n/index.js";
import { SavedItemDialog } from "../SavedItemDialog.js";
import { SavedItemsView } from "../SavedItemsView.js";

const projectId = "00000000-0000-4000-8000-000000000901";
const connectionId = "00000000-0000-4000-8000-000000000902";
const request: SavedItemSummary = { id: "00000000-0000-4000-8000-000000000903", projectId, connectionId, toolName: "sum",
  kind: "request", name: "Happy path", description: "Regression args", sourceRunId: null,
  createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z" };
const response: SavedItemSummary = { ...request, id: "00000000-0000-4000-8000-000000000904", kind: "response",
  name: "Success result", description: "Expected 3" };

describe("SavedItemsView", () => {
  beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });
  afterEach(cleanup);
  it("separates Tool requests and responses, loads request arguments, and deletes explicitly", async () => {
    const details: Record<string, SavedItemDetail> = { [request.id]: { ...request, payload: { a: 1, b: 2 } },
      [response.id]: { ...response, payload: { result: { value: 3 } } } };
    const api = { listSavedItems: vi.fn(async () => ({ items: [response, request], nextCursor: null })),
      getSavedItem: vi.fn(async (_p: string, _c: string, _t: string, id: string) => details[id]!),
      deleteSavedItem: vi.fn(async () => undefined) } as unknown as InspectorApiClient;
    const onLoadRequest = vi.fn(); const onCreateTest = vi.fn(); const user = userEvent.setup();
    render(<SavedItemsView api={api} projectId={projectId} connectionId={connectionId} toolName="sum"
      onLoadRequest={onLoadRequest} onCreateTest={onCreateTest} />);
    expect(await screen.findByRole("tab", { name: /请求 1/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "已保存" })).not.toBeInTheDocument();
    expect(screen.queryByText("当前 Tool 的请求样例与响应基线。")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Happy path，/ }));
    expect((await screen.findAllByText("Regression args"))[1]).toBeVisible();
    await user.click(screen.getByRole("button", { name: "加载到当前 Tab" }));
    expect(onLoadRequest).toHaveBeenCalledWith({ a: 1, b: 2 });
    await user.click(screen.getByRole("tab", { name: /响应 1/ }));
    await user.click(screen.getByRole("button", { name: /^Success result，/ }));
    expect(await screen.findByLabelText("保存的响应 JSON")).toHaveTextContent("value");
    await user.click(screen.getByRole("button", { name: "创建测试用例" }));
    expect(onCreateTest).toHaveBeenCalledWith(details[response.id]);
    await user.click(screen.getByRole("button", { name: "删除 Success result" }));
    await user.click(screen.getByRole("button", { name: "确认删除 Success result" }));
    await waitFor(() => expect(api.deleteSavedItem).toHaveBeenCalledWith(projectId, connectionId, "sum", response.id));
  });

  it("ignores a late detail response after switching to another Tool", async () => {
    let resolve!: (value: SavedItemDetail) => void;
    const detail = new Promise<SavedItemDetail>((done) => { resolve = done; });
    const api = { listSavedItems: vi.fn(async (_p: string, _c: string, name: string) => ({
      items: name === "sum" ? [request] : [], nextCursor: null,
    })), getSavedItem: vi.fn(async () => detail) } as unknown as InspectorApiClient;
    const view = render(<SavedItemsView api={api} projectId={projectId} connectionId={connectionId}
      toolName="sum" onLoadRequest={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Happy path，/ }));
    view.rerender(<SavedItemsView api={api} projectId={projectId} connectionId={connectionId}
      toolName="other" onLoadRequest={vi.fn()} />);
    resolve({ ...request, payload: { secret: "old Tool" } });
    await waitFor(() => expect(screen.getByText("还没有保存的请求")).toBeVisible());
    expect(screen.queryByText("old Tool")).not.toBeInTheDocument();
  });

  it("renders saved items and the save dialog in English", async () => {
    const api = {
      listSavedItems: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      createSavedItem: vi.fn(),
    } as unknown as InspectorApiClient;

    await i18n.changeLanguage("en-US");
    const view = render(<SavedItemsView api={api} projectId={projectId} connectionId={connectionId}
      toolName="sum" onLoadRequest={vi.fn()} />);

    expect(await screen.findByRole("tab", { name: "Requests 0" })).toBeVisible();
    expect(screen.getByText("No saved requests yet")).toBeVisible();

    view.rerender(<SavedItemDialog api={api} projectId={projectId} connectionId={connectionId}
      toolName="sum" kind="request" payload={{ a: 1 }} sourceRunId={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Save request" })).toBeVisible();
    expect(screen.getByLabelText("Name")).toBeVisible();
    expect(screen.getByLabelText("Description")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm save request" })).toBeDisabled();
  });
});
