// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { DebugTabSummary, InspectorApiClient, RunDetail, ToolDetailSummary } from "../../../api/api-client.js";
import { DebugWorkspace } from "../DebugWorkspace.js";
import { ParameterEditor } from "../ParameterEditor.js";
import { TabStrip } from "../TabStrip.js";

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

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function tab(id: string, title: string, args: Record<string, unknown>): DebugTabSummary {
  return { id, projectId, connectionId, toolName: "sum", title, position: title === "sum" ? 0 : 1,
    pinned: false, inputMode: "form", arguments: args, rawText: JSON.stringify(args, null, 2),
    viewState: { editorScrollTop: 0, resultScrollTop: 0, splitRatio: 0.5 }, lastRunId: null };
}

describe("DebugWorkspace", () => {
  afterEach(() => { cleanup(); sessionStorage.clear(); vi.useRealTimers(); });

  it("restores the active Tab selection across a workspace remount", async () => {
    const tabs = [tab("00000000-0000-4000-8000-000000000653", "sum", { a: 1 }),
      { ...tab("00000000-0000-4000-8000-000000000654", "sum (2)", { a: 2 }), position: 1 }];
    const api = { listTabs: vi.fn(async () => tabs), getTool: vi.fn(async () => tool), updateTab: vi.fn() } as unknown as InspectorApiClient;
    const first = render(<DebugWorkspace api={api} projectId={projectId} />);
    await screen.findByRole("tab", { name: "sum" });
    fireEvent.click(screen.getByRole("tab", { name: "sum (2)" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "sum (2)" })).toHaveAttribute("aria-selected", "true"));
    first.unmount();
    render(<DebugWorkspace api={api} projectId={projectId} />);
    expect(await screen.findByRole("tab", { name: "sum (2)" })).toHaveAttribute("aria-selected", "true");
  });

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
    expect(await screen.findByLabelText("a")).toHaveValue(800);
    fireEvent.click(screen.getByRole("tab", { name: /^sum$/ }));
    await waitFor(() => expect(screen.getByLabelText("a")).toHaveValue(2));
  });

  it("keeps invalid Raw text lossless while allowing a reversible switch to Form", () => {
    const onChange = vi.fn(); const onExecute = vi.fn();
    const rawTab = { ...tab("00000000-0000-4000-8000-000000000613", "sum", { a: 1 }),
      inputMode: "raw" as const, rawText: '{"a":' };
    const view = render(<ParameterEditor tab={rawTab} schema={tool.tool.currentSnapshot.definition.inputSchema}
      onChange={onChange} onExecute={onExecute} />);
    expect(screen.getByLabelText("完整 arguments JSON")).toHaveValue('{"a":');
    expect(screen.getByRole("alert")).toHaveTextContent("JSON 尚未填写完整");
    expect(screen.getByRole("button", { name: "执行" })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "Form" }));

    expect(onChange).toHaveBeenCalledWith({ inputMode: "form" });
    view.rerender(<ParameterEditor tab={{ ...rawTab, inputMode: "form" }} schema={tool.tool.currentSnapshot.definition.inputSchema}
      onChange={onChange} onExecute={onExecute} />);
    expect(screen.getByLabelText("a")).toHaveValue(1);
    fireEvent.click(screen.getByRole("tab", { name: "Raw JSON" }));
    expect(onChange).toHaveBeenLastCalledWith({ inputMode: "raw" });
    view.rerender(<ParameterEditor tab={rawTab} schema={tool.tool.currentSnapshot.definition.inputSchema}
      onChange={onChange} onExecute={onExecute} />);
    expect(screen.getByLabelText("完整 arguments JSON")).toHaveValue('{"a":');
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("switches from valid Raw JSON to Form even when required Schema fields are missing", () => {
    const onChange = vi.fn();
    const rawTab = { ...tab("00000000-0000-4000-8000-000000000614", "sum", {}),
      inputMode: "raw" as const, rawText: "{}" };
    const requiredSchema = { type: "object", properties: { a: { type: "number" } }, required: ["a"] };
    render(<ParameterEditor tab={rawTab} schema={requiredSchema} onChange={onChange} />);

    const rawInput = screen.getByLabelText("完整 arguments JSON");
    expect(rawInput).toHaveAttribute("aria-describedby", screen.getByRole("alert").id);
    expect(screen.getByRole("alert")).toHaveTextContent("请输入必填参数");

    fireEvent.click(screen.getByRole("tab", { name: "Form" }));

    expect(onChange).toHaveBeenCalledWith({ arguments: {}, rawText: "{}" });
    expect(onChange).toHaveBeenCalledWith({ inputMode: "form" });
  });

  it("marks required Form fields with an asterisk and uses the input placeholder for missing values", () => {
    render(<ParameterEditor tab={tab("00000000-0000-4000-8000-000000000615", "sum", {})}
      schema={{ type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] }} onChange={vi.fn()} />);

    const input = screen.getByRole("textbox", { name: /task_id/ });
    expect(screen.getByText("*", { selector: ".required-marker" })).toBeVisible();
    expect(screen.queryByText("task_id（必填）")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", "请输入必填参数");
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alert", { name: "请输入必填参数" })).not.toBeInTheDocument();
    expect(screen.queryByText("请输入必填参数")).not.toBeInTheDocument();
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

  it("serializes saves and prevents an old completion from overwriting a newer edit", async () => {
    vi.useFakeTimers(); const first = deferred<DebugTabSummary>(); const second = deferred<DebugTabSummary>();
    const saved = tab("00000000-0000-4000-8000-000000000621", "sum", { a: 1 });
    const updateTab = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const api = { listTabs: vi.fn(async () => [saved]), getTool: vi.fn(async () => tool), updateTab } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText("a"), { target: { value: "2" } });
    await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText("a"), { target: { value: "3" } });
    await act(async () => { vi.advanceTimersByTime(300); first.resolve({ ...saved, arguments: { a: 2 }, rawText: '{"a":2}' });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText("a")).toHaveValue(3);
    expect(updateTab).toHaveBeenCalledTimes(2);
    expect(updateTab.mock.calls[1]?.[2]).toMatchObject({ arguments: { a: 3 } });
    await act(async () => { second.resolve({ ...saved, arguments: { a: 3 }, rawText: '{"a":3}' }); await Promise.resolve(); });
  });

  it("restores a failed patch, merges a newer edit, and retries with newer values winning", async () => {
    vi.useFakeTimers(); const failed = deferred<DebugTabSummary>();
    const saved = tab("00000000-0000-4000-8000-000000000622", "sum", { a: 1 });
    const updateTab = vi.fn().mockImplementationOnce(() => failed.promise)
      .mockImplementationOnce(async (_p, _id, patch) => ({ ...saved, ...patch }));
    const api = { listTabs: vi.fn(async () => [saved]), getTool: vi.fn(async () => tool), updateTab } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText("a"), { target: { value: "2" } });
    await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText("a"), { target: { value: "4" } });
    await act(async () => { failed.reject(new Error("disk busy")); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole("alert")).toHaveTextContent("disk busy");
    await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(updateTab).toHaveBeenCalledTimes(2);
    expect(updateTab.mock.calls[1]?.[2]).toMatchObject({ arguments: { a: 4 } });
  });

  it("never renders a previous Tab's deferred Tool schema for the active Tab", async () => {
    const aDetail = deferred<ToolDetailSummary>(); const bDetail = deferred<ToolDetailSummary>();
    const tabs = [tab("00000000-0000-4000-8000-000000000623", "sum", {}),
      { ...tab("00000000-0000-4000-8000-000000000624", "other", {}), toolName: "other" }];
    const other = structuredClone(tool); other.tool.name = "other"; other.tool.currentSnapshot.toolName = "other";
    other.tool.currentSnapshot.definition = { name: "other", inputSchema: { type: "object", properties: { onlyB: { type: "string" } } } };
    const api = { listTabs: vi.fn(async () => tabs), getTool: vi.fn((_p: string, _c: string, name: string) => name === "sum" ? aDetail.promise : bDetail.promise),
      updateTab: vi.fn() } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} />);
    await screen.findByRole("tab", { name: "sum" });
    fireEvent.click(screen.getByRole("tab", { name: "other" }));
    await act(async () => { aDetail.resolve(tool); await Promise.resolve(); });
    expect(screen.queryByLabelText("a")).not.toBeInTheDocument();
    await act(async () => { bDetail.resolve(other); await Promise.resolve(); });
    expect(await screen.findByLabelText("onlyB")).toBeVisible();
  });

  it("persists valid Raw edits without blur and leaves canonical arguments on invalid Raw", async () => {
    vi.useFakeTimers();
    const saved = { ...tab("00000000-0000-4000-8000-000000000625", "sum", { a: 1 }), inputMode: "raw" as const };
    const updateTab = vi.fn(async (_p, _id, patch) => ({ ...saved, ...patch }));
    const api = { listTabs: vi.fn(async () => [saved]), getTool: vi.fn(async () => tool), updateTab } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText("完整 arguments JSON"), { target: { value: '{"a":5}' } });
    await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); await Promise.resolve(); });
    expect(updateTab.mock.calls[0]?.[2]).toMatchObject({ rawText: '{"a":5}', arguments: { a: 5 } });
    fireEvent.change(screen.getByLabelText("完整 arguments JSON"), { target: { value: '{"a":' } });
    await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); await Promise.resolve(); });
    expect(updateTab.mock.calls[1]?.[2]).toMatchObject({ rawText: '{"a":' });
    expect(updateTab.mock.calls[1]?.[2]).not.toHaveProperty("arguments");
  });

  it("copies the current valid Raw object rather than the last canonical value", () => {
    const writeText = vi.fn(); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ParameterEditor tab={{ ...tab("00000000-0000-4000-8000-000000000626", "sum", { a: 1 }),
      inputMode: "raw", rawText: '{"a":9}' }} schema={tool.tool.currentSnapshot.definition.inputSchema} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "复制参数" }));
    expect(writeText).toHaveBeenCalledWith('{\n  "a": 9\n}');
  });

  it("flushes a valid Raw edit with canonical arguments on project unmount", async () => {
    const saved = { ...tab("00000000-0000-4000-8000-000000000636", "sum", { a: 1 }), inputMode: "raw" as const };
    const updateTab = vi.fn(async (_p, _id, patch) => ({ ...saved, ...patch }));
    const api = { listTabs: vi.fn(async () => [saved]), getTool: vi.fn(async () => tool), updateTab } as unknown as InspectorApiClient;
    const view = render(<DebugWorkspace api={api} projectId={projectId} />);
    fireEvent.change(await screen.findByLabelText("完整 arguments JSON"), { target: { value: '{"a":7}' } });
    view.unmount();
    await waitFor(() => expect(updateTab).toHaveBeenCalledWith(projectId, saved.id,
      expect.objectContaining({ rawText: '{"a":7}', arguments: { a: 7 } })));
  });

  it("waits for the serialized save before emitting execute intent", async () => {
    const saving = deferred<DebugTabSummary>(); const onExecute = vi.fn();
    const saved = tab("00000000-0000-4000-8000-000000000637", "sum", { a: 1 });
    const api = { listTabs: vi.fn(async () => [saved]), getTool: vi.fn(async () => tool),
      updateTab: vi.fn(() => saving.promise) } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} onExecute={onExecute} />);
    fireEvent.change(await screen.findByLabelText("a"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "执行" }));
    expect(onExecute).not.toHaveBeenCalled();
    await act(async () => { saving.resolve({ ...saved, arguments: { a: 8 }, rawText: '{"a":8}' }); await Promise.resolve(); await Promise.resolve(); });
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ arguments: { a: 8 } }));
  });

  it("isolates invalid nested JSON drafts by tab and JSON Pointer", async () => {
    const nestedTool = structuredClone(tool);
    nestedTool.tool.currentSnapshot.definition.inputSchema = { type: "object", properties: { payload: { type: "object" } } };
    const tabs = [tab("00000000-0000-4000-8000-000000000627", "sum", { payload: { a: 1 } }),
      { ...tab("00000000-0000-4000-8000-000000000628", "sum (2)", { payload: { b: 2 } }), position: 1 }];
    const api = { listTabs: vi.fn(async () => tabs), getTool: vi.fn(async () => nestedTool),
      updateTab: vi.fn(async (_p, id, patch) => ({ ...tabs.find((item) => item.id === id)!, ...patch })),
      replaceTabTool: vi.fn(async () => ({ ...tabs[0], arguments: { payload: { fresh: true } }, rawText: '{"payload":{"fresh":true}}' })) } as unknown as InspectorApiClient;
    const view = render(<DebugWorkspace api={api} projectId={projectId} />);
    const editor = await screen.findByLabelText("payload"); fireEvent.change(editor, { target: { value: '{"draftA":' } });
    fireEvent.click(screen.getByRole("tab", { name: /sum \(2\)/ }));
    await waitFor(() => expect(screen.getByLabelText("payload")).toHaveValue('{\n  "b": 2\n}'));
    fireEvent.change(screen.getByLabelText("payload"), { target: { value: '{"draftB":' } });
    fireEvent.click(screen.getByRole("tab", { name: /^sum$/ }));
    await waitFor(() => expect(screen.getByLabelText("payload")).toHaveValue('{"draftA":'));
    view.rerender(<DebugWorkspace api={api} projectId={projectId} toolIntent={{ sequence: 1, tool: nestedTool.tool, newTab: false }} />);
    await waitFor(() => expect(screen.getByLabelText("payload")).toHaveValue('{\n  "fresh": true\n}'));
  });

  it("reuses an active unpinned Tab for selection and always opens for a new-Tab intent", async () => {
    const saved = tab("00000000-0000-4000-8000-000000000629", "sum", {});
    const replaceTabTool = vi.fn(async () => saved); const openTab = vi.fn(async () => ({ ...saved,
      id: "00000000-0000-4000-8000-000000000630", title: "sum (2)", position: 1 }));
    const api = { listTabs: vi.fn(async () => [saved]), getTool: vi.fn(async () => tool), updateTab: vi.fn(),
      replaceTabTool, openTab } as unknown as InspectorApiClient;
    const view = render(<DebugWorkspace api={api} projectId={projectId} />); await screen.findByRole("tab", { name: "sum" });
    view.rerender(<DebugWorkspace api={api} projectId={projectId} toolIntent={{ sequence: 1, tool: tool.tool, newTab: false }} />);
    await waitFor(() => expect(replaceTabTool).toHaveBeenCalledTimes(1)); expect(openTab).not.toHaveBeenCalled();
    view.rerender(<DebugWorkspace api={api} projectId={projectId} toolIntent={{ sequence: 2, tool: tool.tool, newTab: true }} />);
    await waitFor(() => expect(openTab).toHaveBeenCalledTimes(1));
  });

  it("opens a new Tab when the active Tab is pinned", async () => {
    const saved = { ...tab("00000000-0000-4000-8000-000000000631", "sum", {}), pinned: true };
    const openTab = vi.fn(async () => ({ ...saved, id: "00000000-0000-4000-8000-000000000632", pinned: false, position: 1 }));
    const api = { listTabs: vi.fn(async () => [saved]), getTool: vi.fn(async () => tool), updateTab: vi.fn(),
      replaceTabTool: vi.fn(), openTab } as unknown as InspectorApiClient;
    const view = render(<DebugWorkspace api={api} projectId={projectId} />); await screen.findByRole("tab", { name: /固定 sum/ });
    expect(screen.getByRole("button", { name: "关闭 sum" })).toBeDisabled();
    view.rerender(<DebugWorkspace api={api} projectId={projectId} toolIntent={{ sequence: 1, tool: tool.tool, newTab: false }} />);
    await waitFor(() => expect(openTab).toHaveBeenCalledTimes(1)); expect(api.replaceTabTool).not.toHaveBeenCalled();
  });

  it("links Tabs to their panel, supports roving keys, and focuses fallback after close", async () => {
    const tabs = [tab("00000000-0000-4000-8000-000000000633", "sum", {}),
      { ...tab("00000000-0000-4000-8000-000000000634", "sum (2)", {}), position: 1 }];
    const api = { listTabs: vi.fn(async () => tabs), getTool: vi.fn(async () => tool), updateTab: vi.fn(),
      closeTab: vi.fn(async () => undefined) } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} />);
    const first = await screen.findByRole("tab", { name: "sum" }); const second = screen.getByRole("tab", { name: /sum \(2\)/ });
    expect(first).toHaveAttribute("aria-controls", `tabpanel-${tabs[0].id}`);
    expect(document.getElementById(`tabpanel-${tabs[0].id}`)).toHaveAttribute("aria-labelledby", `tab-${tabs[0].id}`);
    first.focus(); fireEvent.keyDown(first, { key: "End" });
    await waitFor(() => expect(second).toHaveAttribute("aria-selected", "true")); expect(second).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "关闭 sum (2)" }));
    await waitFor(() => expect(first).toHaveFocus());
  });

  it("gives Form/Raw tabs roving focus and linked panels", async () => {
    const onChange = vi.fn(); render(<ParameterEditor tab={tab("00000000-0000-4000-8000-000000000635", "sum", {})}
      schema={tool.tool.currentSnapshot.definition.inputSchema} onChange={onChange} />);
    const form = screen.getByRole("tab", { name: "Form" }); const raw = screen.getByRole("tab", { name: "Raw JSON" });
    expect(form).toHaveAttribute("aria-controls", expect.stringContaining("panel-form"));
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", form.id);
    form.focus(); fireEvent.keyDown(form, { key: "End" }); await act(async () => { await Promise.resolve(); });
    expect(raw).toHaveFocus(); expect(onChange).toHaveBeenCalledWith({ inputMode: "raw" });
  });

  it.each([
    ["select", () => fireEvent.click(screen.getByRole("tab", { name: /sum \(2\)/ })), "none"],
    ["close", () => fireEvent.click(screen.getByRole("button", { name: "关闭 sum" })), "closeTab"],
    ["duplicate", () => fireEvent.click(screen.getAllByRole("button", { name: "复制 Tab" })[0]!), "duplicateTab"],
    ["close others", () => fireEvent.click(screen.getAllByRole("button", { name: "关闭其他" })[0]!), "closeOtherTabs"],
    ["close right", () => fireEvent.click(screen.getAllByRole("button", { name: "关闭右侧" })[0]!), "closeTabsRight"],
    ["move", () => fireEvent.click(screen.getAllByRole("button", { name: "右移" })[0]!), "reorderTabs"],
  ])("blocks %s when prerequisite flush fails", async (_label, trigger, blockedMethod) => {
    const tabs = [tab("00000000-0000-4000-8000-000000000638", "sum", { a: 1 }),
      { ...tab("00000000-0000-4000-8000-000000000639", "sum (2)", { a: 2 }), position: 1 }];
    const api = { listTabs: vi.fn(async () => tabs), getTool: vi.fn(async () => tool),
      updateTab: vi.fn(async () => { throw new Error("save failed"); }), closeTab: vi.fn(), duplicateTab: vi.fn(),
      closeOtherTabs: vi.fn(), closeTabsRight: vi.fn(), reorderTabs: vi.fn() } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} />);
    fireEvent.change(await screen.findByLabelText("a"), { target: { value: "3" } }); trigger();
    await waitFor(() => expect(api.updateTab).toHaveBeenCalled());
    if (blockedMethod !== "none") expect((api as unknown as Record<string, ReturnType<typeof vi.fn>>)[blockedMethod]).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /^sum.*未保存/ })).toHaveAttribute("aria-selected", "true");
  });

  it("does not replace/open a Tool when its prerequisite flush fails", async () => {
    const saved = tab("00000000-0000-4000-8000-000000000640", "sum", { a: 1 });
    const api = { listTabs: vi.fn(async () => [saved]), getTool: vi.fn(async () => tool),
      updateTab: vi.fn(async () => { throw new Error("save failed"); }), replaceTabTool: vi.fn(), openTab: vi.fn() } as unknown as InspectorApiClient;
    const view = render(<DebugWorkspace api={api} projectId={projectId} />);
    fireEvent.change(await screen.findByLabelText("a"), { target: { value: "5" } });
    view.rerender(<DebugWorkspace api={api} projectId={projectId} toolIntent={{ sequence: 1, tool: tool.tool, newTab: false }} />);
    await waitFor(() => expect(api.updateTab).toHaveBeenCalled());
    expect(api.replaceTabTool).not.toHaveBeenCalled(); expect(api.openTab).not.toHaveBeenCalled();
  });

  it("serializes Tool intents and prevents an older completion from overwriting the newest intent", async () => {
    const first = deferred<DebugTabSummary>(); const second = deferred<DebugTabSummary>();
    const saved = tab("00000000-0000-4000-8000-000000000641", "sum", {});
    const replaceTabTool = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const api = { listTabs: vi.fn(async () => [saved]), getTool: vi.fn(async () => tool), updateTab: vi.fn(), replaceTabTool } as unknown as InspectorApiClient;
    const otherTool = { ...tool.tool, name: "other" };
    const view = render(<DebugWorkspace api={api} projectId={projectId} />); await screen.findByRole("tab", { name: "sum" });
    view.rerender(<DebugWorkspace api={api} projectId={projectId} toolIntent={{ sequence: 1, tool: tool.tool, newTab: false }} />);
    await waitFor(() => expect(replaceTabTool).toHaveBeenCalledTimes(1));
    view.rerender(<DebugWorkspace api={api} projectId={projectId} toolIntent={{ sequence: 2, tool: otherTool, newTab: false }} />);
    expect(replaceTabTool).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve({ ...saved, title: "old" }); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(replaceTabTool).toHaveBeenCalledTimes(2));
    expect(replaceTabTool.mock.calls.map((call) => call[3])).toEqual(["sum", "other"]);
    await act(async () => { second.resolve({ ...saved, toolName: "other", title: "other" }); await Promise.resolve(); await Promise.resolve(); });
    expect(await screen.findByRole("tab", { name: "other" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "old" })).not.toBeInTheDocument();
  });

  it("applies a successful new-Tab response before the next single-Tab intent and converges after reload", async () => {
    const openingA = deferred<DebugTabSummary>();
    const original = tab("00000000-0000-4000-8000-000000000646", "sum", {});
    const openedA = { ...tab("00000000-0000-4000-8000-000000000647", "alpha", {}), toolName: "alpha", position: 1 };
    const replacedB = { ...openedA, title: "beta", toolName: "beta" };
    let persisted = [original]; const events: string[] = [];
    const openTab = vi.fn((_project: string, _connection: string, name: string) => {
      events.push(`open:${name}`); return openingA.promise;
    });
    const replaceTabTool = vi.fn(async (_project: string, id: string, _connection: string, name: string) => {
      events.push(`replace:${name}`); persisted = persisted.map((item) => item.id === id ? replacedB : item); return replacedB;
    });
    const api = { listTabs: vi.fn(async () => persisted), getTool: vi.fn(async () => tool), updateTab: vi.fn(),
      openTab, replaceTabTool } as unknown as InspectorApiClient;
    const alpha = { ...tool.tool, name: "alpha" }; const beta = { ...tool.tool, name: "beta" };
    const view = render(<DebugWorkspace api={api} projectId={projectId} />); await screen.findByRole("tab", { name: "sum" });
    view.rerender(<DebugWorkspace api={api} projectId={projectId} toolIntent={{ sequence: 1, tool: alpha, newTab: true }} />);
    await waitFor(() => expect(openTab).toHaveBeenCalledTimes(1));
    view.rerender(<DebugWorkspace api={api} projectId={projectId} toolIntent={{ sequence: 2, tool: beta, newTab: false }} />);
    await act(async () => { persisted = [original, openedA]; openingA.resolve(openedA); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(replaceTabTool).toHaveBeenCalledTimes(1));
    expect(events).toEqual(["open:alpha", "replace:beta"]);
    expect(await screen.findByRole("tab", { name: "beta" })).toHaveAttribute("aria-selected", "true");
    view.unmount(); render(<DebugWorkspace api={api} projectId={projectId} />);
    expect(await screen.findByRole("tab", { name: "beta" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "sum" })).toBeVisible();
  });

  it("persists and displays both queued new-Tab intent responses in request order", async () => {
    const openingA = deferred<DebugTabSummary>(); const openingB = deferred<DebugTabSummary>();
    const original = tab("00000000-0000-4000-8000-000000000648", "sum", {});
    const openedA = { ...tab("00000000-0000-4000-8000-000000000649", "alpha", {}), toolName: "alpha", position: 1 };
    const openedB = { ...tab("00000000-0000-4000-8000-000000000650", "beta", {}), toolName: "beta", position: 2 };
    let persisted = [original]; const events: string[] = [];
    const openTab = vi.fn((_project: string, _connection: string, name: string) => {
      events.push(`open:${name}`); return name === "alpha" ? openingA.promise : openingB.promise;
    });
    const api = { listTabs: vi.fn(async () => persisted), getTool: vi.fn(async () => tool), updateTab: vi.fn(), openTab } as unknown as InspectorApiClient;
    const alpha = { ...tool.tool, name: "alpha" }; const beta = { ...tool.tool, name: "beta" };
    const view = render(<DebugWorkspace api={api} projectId={projectId} />); await screen.findByRole("tab", { name: "sum" });
    view.rerender(<DebugWorkspace api={api} projectId={projectId} toolIntent={{ sequence: 1, tool: alpha, newTab: true }} />);
    await waitFor(() => expect(openTab).toHaveBeenCalledTimes(1));
    view.rerender(<DebugWorkspace api={api} projectId={projectId} toolIntent={{ sequence: 2, tool: beta, newTab: true }} />);
    expect(openTab).toHaveBeenCalledTimes(1);
    await act(async () => { persisted = [original, openedA]; openingA.resolve(openedA); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(openTab).toHaveBeenCalledTimes(2));
    await act(async () => { persisted = [original, openedA, openedB]; openingB.resolve(openedB); await Promise.resolve(); await Promise.resolve(); });
    expect(events).toEqual(["open:alpha", "open:beta"]);
    expect(await screen.findByRole("tab", { name: "alpha" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "beta" })).toHaveAttribute("aria-selected", "true");
    view.unmount(); render(<DebugWorkspace api={api} projectId={projectId} />);
    expect(await screen.findByRole("tab", { name: "alpha" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "beta" })).toBeVisible();
  });

  it.each([
    ["close", "closeTab", () => fireEvent.click(screen.getByRole("button", { name: "关闭 sum" }))],
    ["duplicate", "duplicateTab", () => fireEvent.click(screen.getAllByRole("button", { name: "复制 Tab" })[0]!)],
    ["close others", "closeOtherTabs", () => fireEvent.click(screen.getAllByRole("button", { name: "关闭其他" })[0]!)],
    ["close right", "closeTabsRight", () => fireEvent.click(screen.getAllByRole("button", { name: "关闭右侧" })[0]!)],
    ["reorder", "reorderTabs", () => fireEvent.click(screen.getAllByRole("button", { name: "右移" })[0]!)],
  ])("keeps the original UI and reports a rejected %s action", async (_label, method, trigger) => {
    const tabs = [tab("00000000-0000-4000-8000-000000000651", "sum", {}),
      { ...tab("00000000-0000-4000-8000-000000000652", "sum (2)", {}), position: 1 }];
    const rejected = vi.fn(async () => { throw new Error(`${method} failed`); });
    const api = { listTabs: vi.fn(async () => tabs), getTool: vi.fn(async () => tool), updateTab: vi.fn(), closeTab: vi.fn(),
      duplicateTab: vi.fn(), closeOtherTabs: vi.fn(), closeTabsRight: vi.fn(), reorderTabs: vi.fn(), [method]: rejected } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} />); await screen.findByRole("tab", { name: "sum" }); trigger();
    expect(await screen.findByRole("alert")).toHaveTextContent(`${method} failed`);
    expect(screen.getByRole("tab", { name: "sum" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /sum \(2\)/ })).toBeVisible();
  });

  it.each(["[]", "null", '"text"'])("rejects non-object whole-arguments fallback value %s", (invalid) => {
    const onChange = vi.fn(); render(<ParameterEditor tab={tab("00000000-0000-4000-8000-000000000642", "sum", {})}
      schema={{ oneOf: [{ type: "object" }, { type: "null" }] }} onChange={onChange} />);
    const editor = screen.getByLabelText("完整 arguments（复杂 Schema）");
    fireEvent.change(editor, { target: { value: invalid } }); fireEvent.blur(editor);
    expect(screen.getByRole("alert")).toHaveTextContent("必须是 JSON 对象"); expect(editor).toHaveAttribute("aria-invalid", "true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits an object from whole-arguments fallback", () => {
    const onChange = vi.fn(); render(<ParameterEditor tab={tab("00000000-0000-4000-8000-000000000643", "sum", {})}
      schema={{ $ref: "#/$defs/input" }} onChange={onChange} />);
    const editor = screen.getByLabelText("完整 arguments（复杂 Schema）");
    fireEvent.change(editor, { target: { value: '{"ok":true}' } }); fireEvent.blur(editor);
    expect(onChange).toHaveBeenCalledWith({ arguments: { ok: true }, rawText: '{\n  "ok": true\n}' });
  });

  it("saves named Tool request parameters and opens the saved workspace", async () => {
    const current = tab("00000000-0000-4000-8000-000000000655", "sum", { a: 4, b: 5 });
    const saved = { id: "00000000-0000-4000-8000-000000000656", projectId, connectionId, toolName: "sum",
      kind: "request" as const, name: "nine", description: "known result", sourceRunId: null,
      createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z", payload: { a: 4, b: 5 } };
    const api = { listTabs: vi.fn(async () => [current]), getTool: vi.fn(async () => tool), updateTab: vi.fn(),
      createSavedItem: vi.fn(async () => saved), listSavedItems: vi.fn(async () => ({ items: [saved], nextCursor: null })),
      getSavedItem: vi.fn(async () => saved), deleteSavedItem: vi.fn() } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<DebugWorkspace api={api} projectId={projectId} />);
    await user.click(await screen.findByRole("button", { name: "保存请求" }));
    const dialog = screen.getByRole("dialog", { name: "保存请求" });
    await user.type(screen.getByLabelText("名称"), "nine"); await user.type(screen.getByLabelText("描述"), "known result");
    await user.click(screen.getByRole("button", { name: "确认保存请求" }));
    expect(api.createSavedItem).toHaveBeenCalledWith(projectId, connectionId, "sum", {
      kind: "request", name: "nine", description: "known result", payload: { a: 4, b: 5 }, sourceRunId: null,
    });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(await screen.findByRole("heading", { name: "已保存" })).toBeVisible();
  });

  it("shows current Tab history records without repeating the view title", async () => {
    const current = tab("00000000-0000-4000-8000-000000000660", "sum", { a: 1, b: 2 });
    const api = { listTabs: vi.fn(async () => [current]), getTool: vi.fn(async () => tool), updateTab: vi.fn(),
      listRuns: vi.fn(async () => ({ runs: [], nextCursor: null })) } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<DebugWorkspace api={api} projectId={projectId} />);

    await user.click(await screen.findByRole("button", { name: "当前 Tab 历史" }));

    expect(await screen.findByText("暂无运行记录")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "当前 Tab 历史" })).not.toBeInTheDocument();
  });

  it("loads a selected history request and response back into the current debug view", async () => {
    const current = tab("00000000-0000-4000-8000-000000000661", "sum", { a: 1, b: 2 });
    const run: RunDetail = {
      id: "00000000-0000-4000-8000-000000000662", projectId, connectionId, tabId: current.id,
      toolName: "sum", toolSnapshotId: tool.tool.currentSnapshot.id, toolSnapshotHash: "a".repeat(64),
      idempotencyKey: "history-42", status: "succeeded", createdAt: "2026-08-25T01:00:00.000Z",
      startedAt: "2026-08-25T01:00:00.010Z", completedAt: "2026-08-25T01:00:00.020Z",
      durationMs: 10, networkDurationMs: 8, protocolVersion: "2025-06-18", serverInfo: null,
      clientInfo: { name: "dsers-mcp-inspector", version: "0.1.0" },
      request: { arguments: { a: 40, b: 2 }, jsonrpc: { jsonrpc: "2.0", method: "tools/call" }, http: null },
      response: { result: { structuredContent: { answer: 42 } }, error: null, truncated: false, originalBytes: 64 },
      events: [],
    };
    const updateTab = vi.fn(async (_project: string, _id: string, patch: Partial<DebugTabSummary>) => ({ ...current, ...patch }));
    const api = { listTabs: vi.fn(async () => [current]), getTool: vi.fn(async () => tool), updateTab,
      listRuns: vi.fn(async () => ({ runs: [run], nextCursor: null })), getRun: vi.fn(async () => run),
      startRun: vi.fn() } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<DebugWorkspace api={api} projectId={projectId} />);
    await user.click(await screen.findByRole("button", { name: "当前 Tab 历史" }));

    await user.click(await screen.findByRole("button", { name: `打开运行 ${run.id}` }));

    await waitFor(() => expect(screen.getByRole("button", { name: "调试" })).toHaveAttribute("aria-current", "page"));
    expect(await screen.findByLabelText("a")).toHaveValue(40);
    expect(screen.getByLabelText("b")).toHaveValue(2);
    expect(await screen.findByText("42")).toBeVisible();
    expect(api.startRun).not.toHaveBeenCalled();
    await waitFor(() => expect(updateTab).toHaveBeenCalledWith(projectId, current.id, expect.objectContaining({
      arguments: { a: 40, b: 2 }, rawText: '{\n  "a": 40,\n  "b": 2\n}',
    })));
  });

  it("keeps a save dialog bound to the Tool that opened it when the active Tab changes", async () => {
    const first = tab("00000000-0000-4000-8000-000000000657", "sum", { a: 4 });
    const second = { ...tab("00000000-0000-4000-8000-000000000658", "other", { b: 7 }),
      position: 1, toolName: "other" };
    const api = { listTabs: vi.fn(async () => [first, second]), getTool: vi.fn(async (_project: string, _connection: string, name: string) => ({
      ...tool, tool: { ...tool.tool, name, currentSnapshot: { ...tool.tool.currentSnapshot, toolName: name,
        definition: { ...tool.tool.currentSnapshot.definition, name } } },
    })), updateTab: vi.fn(), createSavedItem: vi.fn(async () => ({ id: "00000000-0000-4000-8000-000000000659" })),
      listSavedItems: vi.fn(async () => ({ items: [], nextCursor: null })) } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<DebugWorkspace api={api} projectId={projectId} />);
    await user.click(await screen.findByRole("button", { name: "保存请求" }));
    await user.click(screen.getByRole("tab", { name: "other" }));
    await user.type(screen.getByLabelText("名称"), "bound case");
    await user.click(screen.getByRole("button", { name: "确认保存请求" }));
    expect(api.createSavedItem).toHaveBeenCalledWith(projectId, connectionId, "sum", expect.objectContaining({
      name: "bound case", payload: { a: 4 },
    }));
  });

  it("invokes every Tab menu action from the keyboard", async () => {
    const callbacks = { onSelect: vi.fn(), onClose: vi.fn(), onDuplicate: vi.fn(), onPin: vi.fn(),
      onCloseOthers: vi.fn(), onCloseRight: vi.fn(), onMove: vi.fn() };
    const tabs = [tab("00000000-0000-4000-8000-000000000644", "sum", {}),
      { ...tab("00000000-0000-4000-8000-000000000645", "sum (2)", {}), position: 1 }];
    render(<TabStrip tabs={tabs} activeId={tabs[0].id} {...callbacks} />); const user = userEvent.setup();
    const actions: Array<[string, ReturnType<typeof vi.fn>]> = [
      ["复制 Tab", callbacks.onDuplicate], ["固定", callbacks.onPin],
      ["右移", callbacks.onMove], ["关闭其他", callbacks.onCloseOthers], ["关闭右侧", callbacks.onCloseRight],
    ];
    const summary = screen.getByLabelText("sum 操作");
    vi.spyOn(summary, "getBoundingClientRect").mockReturnValue({
      x: 720, y: 40, width: 32, height: 32, top: 40, right: 752, bottom: 72, left: 720,
      toJSON: () => ({}),
    });
    for (const [index, [name, callback]] of actions.entries()) {
      summary.focus(); await user.keyboard(index % 2 === 0 ? "{Enter}" : " ");
      expect(summary.closest("details")).toHaveAttribute("open");
      expect(summary.closest("details")).toHaveStyle({ "--tab-menu-top": "76px", "--tab-menu-left": "588px" });
      const button = screen.getAllByRole("button", { name })[0]!;
      for (let step = 0; document.activeElement !== button && step < 8; step += 1) await user.tab();
      expect(button).toHaveFocus(); await user.keyboard("{Enter}");
      expect(callback).toHaveBeenCalled();
      expect(summary.closest("details")).not.toHaveAttribute("open"); expect(summary).toHaveFocus();
    }
  });
});
