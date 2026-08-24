// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DebugTabSummary, InspectorApiClient, ToolDetailSummary } from "../../../api/api-client.js";
import { DebugWorkspace } from "../DebugWorkspace.js";
import { ParameterEditor } from "../ParameterEditor.js";

const projectId = "00000000-0000-4000-8000-000000000601";
const connectionId = "00000000-0000-4000-8000-000000000602";
const tool: ToolDetailSummary = {
  tool: { projectId, connectionId, name: "sum", status: "current",
    updatedAt: "2026-08-17T00:00:00.000Z", currentSnapshot: {
      id: "00000000-0000-4000-8000-000000000603", projectId, connectionId,
      toolName: "sum", contentHash: "a".repeat(64), createdAt: "2026-08-17T00:00:00.000Z",
      definition: { name: "sum", inputSchema: { type: "object", properties: {
        a: { type: "number" }, b: { type: "number" },
      } } },
    } }, snapshots: [],
};

function tab(id: string, title: string, args: Record<string, unknown>): DebugTabSummary {
  return { id, projectId, connectionId, toolName: "sum", title, position: title === "sum" ? 0 : 1,
    pinned: false, inputMode: "form", arguments: args, rawText: JSON.stringify(args, null, 2),
    viewState: { editorScrollTop: 0, resultScrollTop: 0, splitRatio: 0.5 }, lastRunId: null };
}

describe("DebugWorkspace", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("restores independently edited same-Tool Tabs after remount", async () => {
    let saved = Array.from({ length: 8 }, (_, index) => ({
      ...tab(`00000000-0000-4000-8000-${String(611 + index).padStart(12, "0")}`,
        index === 0 ? "sum" : `sum (${index + 1})`, { a: (index + 1) * 10 }), position: index,
    }));
    saved[0] = { ...saved[0], arguments: { a: 1 }, rawText: '{\n  "a": 1\n}' };
    const api = {
      listTabs: vi.fn(async () => saved),
      getTool: vi.fn(async () => tool),
      updateTab: vi.fn(async (_project: string, id: string, patch: Partial<DebugTabSummary>) => {
        saved = saved.map((item) => item.id === id ? { ...item, ...patch } : item);
        return saved.find((item) => item.id === id)!;
      }),
    } as unknown as InspectorApiClient;
    const first = render(<DebugWorkspace api={api} projectId={projectId} />);
    await screen.findByRole("tab", { name: /^sum$/ });
    fireEvent.change(await screen.findByLabelText("a"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("tab", { name: /sum \(8\)/ }));
    await waitFor(() => expect(screen.getByLabelText("a")).toHaveValue(80));
    fireEvent.change(screen.getByLabelText("a"), { target: { value: "800" } });
    first.unmount();
    await waitFor(() => expect(api.updateTab).toHaveBeenCalled());
    render(<DebugWorkspace api={api} projectId={projectId} />);
    expect(await screen.findByLabelText("a")).toHaveValue(2);
    fireEvent.click(screen.getByRole("tab", { name: /sum \(8\)/ }));
    await waitFor(() => expect(screen.getByLabelText("a")).toHaveValue(800));
  });

  it("keeps invalid Raw text lossless, preserves canonical arguments, and blocks execute/Form", () => {
    const onChange = vi.fn(); const onExecute = vi.fn();
    const rawTab = { ...tab("00000000-0000-4000-8000-000000000613", "sum", { a: 1 }),
      inputMode: "raw" as const, rawText: '{"a":' };
    render(<ParameterEditor tab={rawTab} schema={tool.tool.currentSnapshot.definition.inputSchema}
      onChange={onChange} onExecute={onExecute} />);
    expect(screen.getByLabelText("完整 arguments JSON")).toHaveValue('{"a":');
    expect(screen.getByRole("button", { name: "执行" })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "Form" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("debounces draft persistence for 300ms", async () => {
    vi.useFakeTimers();
    const saved = tab("00000000-0000-4000-8000-000000000620", "sum", { a: 1 });
    const updateTab = vi.fn(async (_project: string, _id: string, patch: Partial<DebugTabSummary>) => ({ ...saved, ...patch }));
    const api = { listTabs: vi.fn(async () => [saved]), getTool: vi.fn(async () => tool), updateTab } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText("a"), { target: { value: "2" } });
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(updateTab).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve(); });
    expect(updateTab).toHaveBeenCalledTimes(1);
  });
});
