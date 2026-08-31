// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  DebugTabSummary,
  InspectorApiClient,
  RunDetail,
  ToolDetailSummary,
  ToolWorkflow,
  WorkflowExecutionDetail,
} from "../../../api/api-client.js";
import { AppToaster } from "../../../app/AppToaster.js";
import { DebugWorkspace } from "../DebugWorkspace.js";
import { ParameterEditor } from "../ParameterEditor.js";
import { TabStrip } from "../TabStrip.js";

const projectId = "00000000-0000-4000-8000-000000000601";
const connectionId = "00000000-0000-4000-8000-000000000602";
const tool: ToolDetailSummary = {
  tool: { projectId, connectionId, name: "sum", status: "current", folderId: null,
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

const workflow: ToolWorkflow = {
  projectId, connectionId, toolName: "sum", revision: 1,
  before: { enabled: true, source: "export default async function before(ctx) {}" },
  after: { enabled: false, source: "" }, timeoutMs: 5_000,
  createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z",
};

function workflowExecution(tabId: string, status: WorkflowExecutionDetail["status"]): WorkflowExecutionDetail {
  return {
    id: "00000000-0000-4000-8000-000000000680", projectId, connectionId, tabId, toolName: "sum",
    status, createdAt: "2026-08-27T00:00:00.000Z",
    startedAt: status === "queued" ? null : "2026-08-27T00:00:00.001Z",
    completedAt: ["succeeded", "failed", "cancelled", "interrupted"].includes(status)
      ? "2026-08-27T00:00:00.010Z" : null,
    durationMs: ["succeeded", "failed", "cancelled", "interrupted"].includes(status) ? 9 : null,
    toolSnapshotId: tool.tool.currentSnapshot.id, idempotencyKey: "workflow-test",
    initialArguments: { a: 1 }, finalArguments: status === "succeeded" ? { a: 1 } : null,
    workflowSnapshot: workflow, response: status === "succeeded" ? { answer: 1 } : null,
    error: null, runs: [], events: [],
  };
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

  it("shows blank Raw JSON initially and executes it as empty arguments", () => {
    const onChange = vi.fn(); const onExecute = vi.fn();
    const rawTab = { ...tab("00000000-0000-4000-8000-000000000621", "sum", {}),
      inputMode: "raw" as const, rawText: "" };
    render(<ParameterEditor tab={rawTab} schema={tool.tool.currentSnapshot.definition.inputSchema}
      onChange={onChange} onExecute={onExecute} />);

    expect(screen.getByLabelText("完整 arguments JSON")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "执行" }));

    expect(onChange).toHaveBeenCalledWith({ arguments: {}, rawText: "" });
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it("defers missing required fields when an enabled before script will run", () => {
    const onExecute = vi.fn();
    const requiredSchema = { type: "object", properties: { required_value: { type: "string" } }, required: ["required_value"] };
    render(<ParameterEditor tab={tab("00000000-0000-4000-8000-000000000681", "sum", {})}
      schema={requiredSchema} onChange={vi.fn()} onExecute={onExecute}
      workflowEnabled deferRequiredValidation />);

    expect(screen.getByText("前置脚本已启用，必填参数将在脚本执行后校验。")).toBeVisible();
    const execute = screen.getByRole("button", { name: "执行流水线" });
    expect(execute).toBeEnabled();
    fireEvent.click(execute);
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it("keeps missing required fields blocking when only an after script is enabled", () => {
    const requiredSchema = { type: "object", properties: { required_value: { type: "string" } }, required: ["required_value"] };
    render(<ParameterEditor tab={tab("00000000-0000-4000-8000-000000000682", "sum", {})}
      schema={requiredSchema} onChange={vi.fn()} onExecute={vi.fn()} workflowEnabled />);

    expect(screen.getByRole("button", { name: "执行流水线" })).toBeDisabled();
    expect(screen.queryByText("前置脚本已启用，必填参数将在脚本执行后校验。")).not.toBeInTheDocument();
  });

  it("keeps non-required schema errors blocking when a before script is enabled", () => {
    const typedSchema = { type: "object", properties: { optional_count: { type: "integer" } } };
    render(<ParameterEditor tab={tab("00000000-0000-4000-8000-000000000684", "sum", { optional_count: "invalid" })}
      schema={typedSchema} onChange={vi.fn()} onExecute={vi.fn()}
      workflowEnabled deferRequiredValidation />);

    expect(screen.getByRole("button", { name: "执行流水线" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("参数类型不符合 Tool Schema");
  });

  it("places the primary Execute action beside the parameter mode controls", () => {
    render(<ParameterEditor tab={tab("00000000-0000-4000-8000-000000000620", "sum", { a: 1 })}
      schema={tool.tool.currentSnapshot.definition.inputSchema} onChange={vi.fn()} onExecute={vi.fn()}
      onSaveRequest={vi.fn()} />);

    const modeTabs = screen.getByRole("tablist", { name: "参数输入模式" });
    const execute = screen.getByRole("button", { name: "执行" });
    const save = screen.getByRole("button", { name: "保存请求" });
    const copy = screen.getByRole("button", { name: "复制参数" });

    expect(execute.parentElement).toHaveClass("editor-primary-actions");
    expect(execute.parentElement).toContainElement(modeTabs);
    expect(save.parentElement).toHaveClass("editor-actions");
    expect(copy.parentElement).toBe(save.parentElement);
    expect(save.parentElement).not.toContainElement(execute);
  });

  it("presents a compact executable state for a Tool without arguments", async () => {
    const emptySchema = { type: "object" as const, properties: {} };
    const onChange = vi.fn();
    const compact = render(<ParameterEditor tab={tab("00000000-0000-4000-8000-000000000659", "list_stores", {})}
      schema={emptySchema} onChange={onChange} onExecute={vi.fn()} />);

    expect(screen.getByText("此 Tool 无需参数")).toBeVisible();
    expect(screen.getByRole("button", { name: "执行" })).toBeEnabled();
    const rawMode = screen.getByRole("tab", { name: "Raw JSON" });
    expect(rawMode).toBeDisabled();
    fireEvent.click(rawMode);
    expect(onChange).not.toHaveBeenCalled();
    compact.unmount();

    const rawSavedTab = { ...tab("00000000-0000-4000-8000-000000000658", "list_stores", {}), inputMode: "raw" as const };
    render(<ParameterEditor tab={rawSavedTab} schema={emptySchema} onChange={onChange} onExecute={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Form" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByLabelText("完整 arguments JSON")).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith({ inputMode: "form" });
    cleanup();

    const saved = { ...tab("00000000-0000-4000-8000-000000000660", "list_stores", {}), toolName: "list_stores" };
    const noArgumentTool: ToolDetailSummary = { ...tool, tool: { ...tool.tool, name: "list_stores",
      currentSnapshot: { ...tool.tool.currentSnapshot, toolName: "list_stores",
        definition: { name: "list_stores", inputSchema: emptySchema } } } };
    const api = { listTabs: vi.fn(async () => [saved]), getTool: vi.fn(async () => noArgumentTool), updateTab: vi.fn() } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} />);
    await screen.findByRole("tab", { name: "list_stores" });
    expect((await screen.findByText("此 Tool 无需参数")).closest(".request-result-split"))
      .toHaveClass("request-result-split--no-parameters");
  });

  it("collapses and restores parameter fields from the editor toolbar", () => {
    render(<ParameterEditor tab={tab("00000000-0000-4000-8000-000000000621", "sum", { a: 1 })}
      schema={tool.tool.currentSnapshot.definition.inputSchema} onChange={vi.fn()} />);

    expect(screen.getByLabelText("a")).toBeVisible();
    expect(screen.queryByText("参数输入", { selector: ".editor-mode-group > span" })).not.toBeInTheDocument();
    const collapse = screen.getByRole("button", { name: "收起参数" });
    expect(collapse.querySelector("svg")).not.toBeNull();
    fireEvent.click(collapse);
    expect(screen.queryByLabelText("a")).not.toBeInTheDocument();
    const expand = screen.getByRole("button", { name: "展开参数" });
    expect(expand.querySelector("svg")).not.toBeNull();
    fireEvent.click(expand);
    expect(screen.getByLabelText("a")).toBeVisible();
  });

  it("lets the response pane move up when parameters collapse and restores the saved split when expanded", async () => {
    const saved = tab("00000000-0000-4000-8000-000000000617", "sum", { a: 1 });
    const api = { listTabs: vi.fn(async () => [saved]), getTool: vi.fn(async () => tool), updateTab: vi.fn() } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} />);

    const split = (await screen.findByRole("button", { name: "收起参数" })).closest(".request-result-split") as HTMLElement;
    expect(split.style.gridTemplateRows).toBe("50% 10px 1fr");
    fireEvent.click(screen.getByRole("button", { name: "收起参数" }));
    expect(split.style.gridTemplateRows).toBe("auto 10px minmax(0, 1fr)");
    fireEvent.click(screen.getByRole("button", { name: "展开参数" }));
    expect(split.style.gridTemplateRows).toBe("50% 10px 1fr");
  });

  it("collapses the response pane from its left summary control and restores the saved split", async () => {
    const saved = tab("00000000-0000-4000-8000-000000000618", "sum", { a: 1 });
    const api = { listTabs: vi.fn(async () => [saved]), getTool: vi.fn(async () => tool), updateTab: vi.fn() } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} />);

    const collapse = await screen.findByRole("button", { name: "收起响应" });
    const split = collapse.closest(".request-result-split") as HTMLElement;
    expect(collapse.querySelector("svg")).not.toBeNull();
    expect(split.style.gridTemplateRows).toBe("50% 10px 1fr");

    fireEvent.click(collapse);
    expect(split.style.gridTemplateRows).toBe("minmax(0, 1fr) 10px auto");
    expect(screen.queryByRole("tab", { name: "请求与结果" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开响应" }));
    expect(split.style.gridTemplateRows).toBe("50% 10px 1fr");
    expect(screen.getByRole("tab", { name: "请求与结果" })).toBeVisible();
  });

  it("resizes request and response panes by vertical pointer movement", async () => {
    const saved = tab("00000000-0000-4000-8000-000000000622", "sum", { a: 1 });
    const updateTab = vi.fn(async (_project: string, _id: string, patch: Partial<DebugTabSummary>) => ({ ...saved, ...patch }));
    const api = { listTabs: vi.fn(async () => [saved]), getTool: vi.fn(async () => tool), updateTab } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} />);
    const resize = await screen.findByLabelText("请求区高度");
    const split = resize.closest(".request-result-split") as HTMLElement;
    vi.spyOn(split, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 600, left: 0, right: 1000,
      width: 1000, height: 500, x: 0, y: 100, toJSON: () => ({}) });
    const control = resize.closest(".split-control") as HTMLElement & {
      setPointerCapture: (id: number) => void; hasPointerCapture: (id: number) => boolean;
    };
    control.setPointerCapture = vi.fn(); control.hasPointerCapture = vi.fn(() => true);

    fireEvent.pointerDown(control, { pointerId: 7, clientY: 250 });
    fireEvent.pointerMove(control, { pointerId: 7, clientY: 400 });
    await waitFor(() => expect(updateTab).toHaveBeenCalledWith(projectId, saved.id,
      expect.objectContaining({ viewState: expect.objectContaining({ splitRatio: 0.6 }) })));
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

    expect(onChange).toHaveBeenCalledWith({ arguments: {}, rawText: "" });
    expect(onChange).toHaveBeenCalledWith({ inputMode: "form" });
  });

  it("renders declared fields when a root anyOf only requires one of those fields", () => {
    const onChange = vi.fn();
    const contentUpdateSchema = {
      type: "object",
      properties: {
        import_item_id: { type: "string", description: "Import item ID" },
        resource_version: { type: "string", description: "Current version" },
        supplier_product_title: { type: "string", maxLength: 5000 },
        supplier_product_image_url_list: { type: "array", items: { type: "string", format: "uri" } },
        package: { type: "object", properties: { weight: { type: "string" } } },
      },
      required: ["import_item_id", "resource_version"],
      additionalProperties: false,
      anyOf: [
        { required: ["supplier_product_title"] },
        { required: ["supplier_product_image_url_list"] },
        { required: ["package"] },
      ],
    };
    render(<ParameterEditor tab={tab("00000000-0000-4000-8000-000000000619", "update_pre_publish_product_content", {})}
      schema={contentUpdateSchema} onChange={onChange} />);

    expect(screen.queryByLabelText("完整 arguments（复杂 Schema）")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/import_item_id/)).toHaveAttribute("placeholder", "请输入必填参数");
    expect(screen.getByLabelText(/resource_version/)).toHaveAttribute("placeholder", "请输入必填参数");
    expect(screen.getByLabelText("supplier_product_title")).toBeVisible();
    expect(screen.getByLabelText("supplier_product_image_url_list")).toBeVisible();
    expect(screen.getByLabelText("package")).toBeVisible();
    expect(screen.getByRole("button", { name: "执行" })).toBeDisabled();
  });

  it("renders declared fields when root allOf conditionally requires another declared field", () => {
    const managedProductsSchema = {
      type: "object",
      properties: {
        dsers_store_id: { type: "string", description: "Store ID" },
        supplier_platform_id: { type: "string", description: "Supplier platform" },
        supplier_product_id: { type: "string", description: "Supplier product" },
      },
      required: ["dsers_store_id"],
      allOf: [{
        if: { required: ["supplier_product_id"] },
        then: { required: ["supplier_platform_id"] },
      }],
    };
    render(<ParameterEditor tab={tab("00000000-0000-4000-8000-000000000618", "list_managed_store_products", {})}
      schema={managedProductsSchema} onChange={vi.fn()} />);

    expect(screen.queryByLabelText("完整 arguments（复杂 Schema）")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/dsers_store_id/)).toBeVisible();
    expect(screen.getByLabelText("supplier_platform_id")).toBeVisible();
    expect(screen.getByLabelText("supplier_product_id")).toBeVisible();
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
    expect(screen.queryByRole("checkbox", { name: "跳过参数 task_id" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert", { name: "请输入必填参数" })).not.toBeInTheDocument();
    expect(screen.queryByText("请输入必填参数")).not.toBeInTheDocument();
  });

  it("checks Skip for a missing optional parameter", () => {
    const onChange = vi.fn();
    render(<ParameterEditor tab={tab("00000000-0000-4000-8000-000000000677", "search", {})}
      schema={{ type: "object", properties: { query: { type: "string", pattern: "^item-" } } }} onChange={onChange} />);

    const skip = screen.getByRole("checkbox", { name: "跳过参数 query" });
    expect(skip).toBeChecked();
    expect(skip.closest("label")).toHaveAttribute("title", "跳过后，请求参数中不会包含此字段");
    expect(screen.getByText("跳过")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "query" })).toBeDisabled();
    expect(screen.queryByText("参数内容不符合格式约束")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adds an optional string when the user unchecks Skip and validates its empty value", () => {
    const schema = { type: "object", properties: { query: { type: "string", pattern: "^item-" } } };
    function LinkedEditor() {
      const [current, setCurrent] = useState(tab("00000000-0000-4000-8000-000000000678", "search", {}));
      return <>
        <ParameterEditor tab={current} schema={schema}
          onChange={(patch) => setCurrent((value) => ({ ...value, ...patch }))} />
        <output aria-label="当前 arguments">{JSON.stringify(current.arguments)}</output>
      </>;
    }
    render(<LinkedEditor />);

    fireEvent.click(screen.getByRole("checkbox", { name: "跳过参数 query" }));

    expect(screen.getByRole("checkbox", { name: "跳过参数 query" })).not.toBeChecked();
    expect(screen.getByRole("textbox", { name: "query" })).toBeEnabled();
    expect(screen.getByLabelText("当前 arguments")).toHaveTextContent('{"query":""}');
    expect(screen.getByRole("alert")).toHaveTextContent("参数内容不符合格式约束");
    expect(screen.getByRole("button", { name: "执行" })).toBeDisabled();
  });

  it("disables every optional control kind while its parameter is not included", () => {
    render(<ParameterEditor tab={tab("00000000-0000-4000-8000-000000000679", "configure", {})}
      schema={{ type: "object", properties: {
        enabled: { type: "boolean" },
        mode: { type: "string", enum: ["one", "two", "three", "four"] },
        payload: { type: "object" },
        limit: { type: "number" },
      } }} onChange={vi.fn()} />);

    expect(screen.getByRole("checkbox", { name: "enabled" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "mode" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "payload" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "limit" })).toBeDisabled();
  });

  it("restores a saved optional value and deletes it when the user opts out", () => {
    const schema = { type: "object", properties: { query: { type: "string", pattern: "^item-" } } };
    function LinkedEditor() {
      const [current, setCurrent] = useState(tab(
        "00000000-0000-4000-8000-000000000680", "search", { query: "item-42" },
      ));
      return <>
        <ParameterEditor tab={current} schema={schema}
          onChange={(patch) => setCurrent((value) => ({ ...value, ...patch }))} />
        <output aria-label="当前 arguments">{JSON.stringify(current.arguments)}</output>
        <output aria-label="当前 Raw JSON">{current.rawText}</output>
      </>;
    }
    render(<LinkedEditor />);

    expect(screen.getByRole("checkbox", { name: "跳过参数 query" })).not.toBeChecked();
    expect(screen.getByRole("textbox", { name: "query" })).toHaveValue("item-42");

    fireEvent.click(screen.getByRole("checkbox", { name: "跳过参数 query" }));

    expect(screen.getByRole("checkbox", { name: "跳过参数 query" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "query" })).toBeDisabled();
    expect(screen.getByLabelText("当前 arguments")).toHaveTextContent("{}");
    expect(screen.getByLabelText("当前 Raw JSON")).toHaveTextContent("{}");
  });

  it("keeps an included optional value canonical across Form and Raw JSON", () => {
    const schema = { type: "object", properties: { query: { type: "string" } } };
    function LinkedEditor() {
      const [current, setCurrent] = useState(tab(
        "00000000-0000-4000-8000-000000000681", "search", { query: "item-42" },
      ));
      return <ParameterEditor tab={current} schema={schema}
        onChange={(patch) => setCurrent((value) => ({ ...value, ...patch }))} />;
    }
    render(<LinkedEditor />);

    fireEvent.click(screen.getByRole("tab", { name: "Raw JSON" }));
    expect(screen.getByLabelText("完整 arguments JSON")).toHaveValue('{\n  "query": "item-42"\n}');
    fireEvent.click(screen.getByRole("tab", { name: "Form" }));
    expect(screen.getByRole("checkbox", { name: "跳过参数 query" })).not.toBeChecked();
    expect(screen.getByRole("textbox", { name: "query" })).toHaveValue("item-42");
  });

  it("hides a local JSON draft error after the optional parameter is removed", () => {
    const schema = { type: "object", properties: { payload: { type: "object" } } };
    function LinkedEditor() {
      const [current, setCurrent] = useState(tab(
        "00000000-0000-4000-8000-000000000682", "configure", { payload: {} },
      ));
      return <ParameterEditor tab={current} schema={schema}
        onChange={(patch) => setCurrent((value) => ({ ...value, ...patch }))} />;
    }
    render(<LinkedEditor />);

    const payload = screen.getByRole("textbox", { name: "payload" });
    fireEvent.change(payload, { target: { value: "{" } });
    fireEvent.blur(payload);
    expect(screen.getByRole("alert")).toHaveTextContent("请输入有效 JSON");

    fireEvent.click(screen.getByRole("checkbox", { name: "跳过参数 payload" }));

    expect(payload).toBeDisabled();
    expect(screen.queryByText("请输入有效 JSON")).not.toBeInTheDocument();
  });

  it("uses aligned switch, radio, and custom dropdown controls for boolean and enum parameters", () => {
    const onChange = vi.fn();
    render(<ParameterEditor
      tab={tab("00000000-0000-4000-8000-000000000676", "publish", { taxable: false, mode: "both", image_strategy: "all" })}
      schema={{ type: "object", properties: {
        taxable: { type: "boolean", description: "Whether products are taxable." },
        mode: { type: "string", enum: ["both", "specifications_only", "overview_only"] },
        image_strategy: { type: "string", enum: ["selected_only", "all", "primary", "none"] },
      }, required: ["mode"] }} onChange={onChange} />);

    const taxable = screen.getByRole("checkbox", { name: "taxable" });
    expect(taxable.closest(".schema-switch")).not.toBeNull();
    expect(taxable.nextElementSibling).toHaveAttribute("data-state", "unchecked");
    fireEvent.click(taxable);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ arguments: expect.objectContaining({ taxable: true }) }));

    const modes = screen.getByRole("radiogroup", { name: /mode/ });
    expect(modes).toHaveClass("schema-radio-group");
    const selectedMode = screen.getByRole("radio", { name: "both" });
    const unselectedMode = screen.getByRole("radio", { name: "overview_only" });
    expect(selectedMode).toBeChecked();
    expect(selectedMode.nextElementSibling).toHaveAttribute("data-state", "checked");
    expect(unselectedMode.nextElementSibling).toHaveAttribute("data-state", "unchecked");
    fireEvent.click(screen.getByRole("radio", { name: "overview_only" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ arguments: expect.objectContaining({ mode: "overview_only" }) }));

    const strategy = screen.getByRole("combobox", { name: "image_strategy" });
    expect(strategy).toHaveAttribute("aria-haspopup", "listbox");
    fireEvent.click(strategy);
    expect(screen.getByRole("listbox", { name: "image_strategy" })).toBeVisible();
    expect(screen.getByRole("option", { name: "请选择" })).toBeVisible();
    expect(screen.getByRole("option", { name: "all" })).toHaveClass("schema-enum-select__option--selected");
    fireEvent.click(screen.getByRole("option", { name: "primary" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ arguments: expect.objectContaining({ image_strategy: "primary" }) }));

    fireEvent.click(strategy);
    expect(screen.getByRole("listbox", { name: "image_strategy" })).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox", { name: "image_strategy" })).not.toBeInTheDocument();
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

  it("uses the workflow parent execution when a script is enabled", async () => {
    const current = tab("00000000-0000-4000-8000-000000000679", "sum", { a: 1 });
    const queued = workflowExecution(current.id, "queued");
    const succeeded = { ...workflowExecution(current.id, "succeeded"), events: [
      { executionId: "00000000-0000-4000-8000-000000000680", sequence: 1, kind: "script-log",
        occurredAt: "2026-08-27T00:00:00.004Z",
        payload: { phase: "before", level: "info", message: "已补齐参数", data: { field: "a" } } },
      { executionId: "00000000-0000-4000-8000-000000000680", sequence: 2, kind: "script-log",
        occurredAt: "2026-08-27T00:00:00.006Z",
        payload: { phase: "after", level: "warn", message: "已检查响应", data: { checked: true } } },
    ] };
    const api = {
      listTabs: vi.fn(async () => [current]), getTool: vi.fn(async () => tool), updateTab: vi.fn(async () => current),
      getToolWorkflow: vi.fn(async () => workflow), getActiveWorkflowExecution: vi.fn(async () => null),
      startWorkflowExecution: vi.fn(async () => queued), getWorkflowExecution: vi.fn(async () => succeeded),
      startRun: vi.fn(),
    } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} connectionId={current.connectionId} />);

    fireEvent.click(await screen.findByRole("button", { name: "执行流水线" }));

    await waitFor(() => expect(api.startWorkflowExecution).toHaveBeenCalledWith(
      projectId, current.connectionId, current.id, expect.any(String), { a: 1 }, false,
    ));
    expect(api.startRun).not.toHaveBeenCalled();
    expect(await screen.findByText("脚本流水线 · succeeded")).toBeVisible();
    const resultTabs = screen.getByRole("tablist", { name: "运行结果视图" });
    expect(within(resultTabs).getAllByRole("tab").slice(0, 2).map((item) => item.textContent))
      .toEqual(["脚本流水线", "请求与结果"]);
    expect(within(resultTabs).getByRole("tab", { name: "脚本流水线" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("已补齐参数")).toBeVisible();
    expect(screen.getByLabelText("日志 1 数据")).toHaveTextContent("field");
    expect(screen.getByLabelText("日志 1 数据")).toHaveTextContent('"a"');
    const logRegion = screen.getByRole("region", { name: "脚本执行日志" });
    expect(within(logRegion).getAllByRole("listitem")).toHaveLength(2);
    expect(within(logRegion).getAllByRole("button", { name: "复制" })).toHaveLength(2);
    expect(within(logRegion).getAllByRole("button", { name: "放大查看" })).toHaveLength(2);

    fireEvent.click(within(logRegion).getAllByRole("button", { name: "放大查看" })[0]!);
    expect(screen.getByRole("dialog", { name: "脚本日志 #1" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "关闭 JSON 查看器" }));

    fireEvent.click(within(resultTabs).getByRole("tab", { name: "请求与结果" }));
    expect(screen.queryByText("已补齐参数")).not.toBeInTheDocument();
  });

  it("keeps observing and displays the main Run when a workflow fails", async () => {
    const current = tab("00000000-0000-4000-8000-000000000685", "sum", { a: 1 });
    const mainRunId = "00000000-0000-4000-8000-000000000686";
    const queued = workflowExecution(current.id, "queued");
    const failedExecution: WorkflowExecutionDetail = {
      ...workflowExecution(current.id, "failed"),
      error: { code: "WORKFLOW_FAILED", message: "Workflow execution failed" },
      runs: [{ runId: mainRunId, phase: "main", ordinal: 0, sourceLine: null }],
    };
    const failedRun: RunDetail = {
      id: mainRunId, projectId, connectionId, tabId: current.id, toolName: "sum",
      toolSnapshotId: tool.tool.currentSnapshot.id, toolSnapshotHash: "a".repeat(64),
      idempotencyKey: "workflow-main", status: "failed", createdAt: "2026-08-27T00:00:00.002Z",
      startedAt: "2026-08-27T00:00:00.003Z", completedAt: "2026-08-27T00:00:00.008Z",
      durationMs: 5, networkDurationMs: 3, protocolVersion: "2025-06-18", serverInfo: null,
      clientInfo: { name: "mcp-inspector", version: "0.1.0" },
      request: { arguments: { a: 1 }, jsonrpc: { jsonrpc: "2.0", method: "tools/call" }, http: null },
      response: { result: null, error: { code: "TOOL_FAILED", message: "Tool 调用失败" },
        truncated: false, originalBytes: 24 },
      events: [],
    };
    const mainRunDetail = deferred<RunDetail>();
    const api = {
      listTabs: vi.fn(async () => [current]), getTool: vi.fn(async () => tool), updateTab: vi.fn(async () => current),
      getToolWorkflow: vi.fn(async () => workflow), getActiveWorkflowExecution: vi.fn(async () => null),
      startWorkflowExecution: vi.fn(async () => queued), getWorkflowExecution: vi.fn(async () => failedExecution),
      getRun: vi.fn(() => mainRunDetail.promise), openRunEventStream: vi.fn(),
    } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} connectionId={connectionId} />);

    fireEvent.click(await screen.findByRole("button", { name: "执行流水线" }));

    expect(await screen.findByText("脚本流水线 · failed")).toBeVisible();
    expect(screen.queryByText("正在加载运行详情…")).not.toBeInTheDocument();
    await act(async () => { mainRunDetail.resolve(failedRun); await Promise.resolve(); });
    fireEvent.click(screen.getByRole("tab", { name: "请求与结果" }));
    const result = await screen.findByLabelText(`运行 ${mainRunId} 详情`);
    expect(result).toBeVisible();
    expect(result).toHaveTextContent("Tool 调用失败");
    expect(screen.queryByText("正在加载运行详情…")).not.toBeInTheDocument();
    expect(screen.queryByText("Workflow execution failed")).not.toBeInTheDocument();
  });

  it("confirms destructive workflow helpers with the shared actionable toast", async () => {
    const current = tab("00000000-0000-4000-8000-000000000684", "sum", { a: 1 });
    const helperWorkflow = {
      ...workflow,
      before: { enabled: true, source: "export default async function before(ctx) { await ctx.tools.call({ server: 'current', name: 'lookup', arguments: {} }); }" },
    };
    const queued = workflowExecution(current.id, "queued");
    const succeeded = workflowExecution(current.id, "succeeded");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const api = {
      listTabs: vi.fn(async () => [current]), getTool: vi.fn(async () => tool), updateTab: vi.fn(async () => current),
      getToolWorkflow: vi.fn(async () => helperWorkflow), getActiveWorkflowExecution: vi.fn(async () => null),
      startWorkflowExecution: vi.fn(async () => queued), getWorkflowExecution: vi.fn(async () => succeeded),
      startRun: vi.fn(),
    } as unknown as InspectorApiClient;
    render(<><AppToaster /><DebugWorkspace api={api} projectId={projectId} connectionId={current.connectionId} /></>);

    fireEvent.click(await screen.findByRole("button", { name: "执行流水线" }));

    expect(await screen.findByText("流水线脚本会调用辅助 Tool，其中可能包含有副作用的操作。")).toBeVisible();
    expect(screen.getByText("是否允许本次执行调用破坏性辅助 Tool？")).toBeVisible();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(api.startWorkflowExecution).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "允许执行" }));
    await waitFor(() => expect(api.startWorkflowExecution).toHaveBeenCalledWith(
      projectId, current.connectionId, current.id, expect.any(String), { a: 1 }, true,
    ));
    expect(api.getToolWorkflow).toHaveBeenCalledTimes(2);
  });

  it("starts a before workflow with missing required arguments for post-script validation", async () => {
    const requiredTool = structuredClone(tool);
    requiredTool.tool.currentSnapshot.definition.inputSchema.required = ["a"];
    const current = tab("00000000-0000-4000-8000-000000000683", "sum", {});
    const queued = workflowExecution(current.id, "queued");
    const succeeded = { ...workflowExecution(current.id, "succeeded"), initialArguments: {}, finalArguments: { a: 1 } };
    const api = {
      listTabs: vi.fn(async () => [current]), getTool: vi.fn(async () => requiredTool), updateTab: vi.fn(async () => current),
      getToolWorkflow: vi.fn(async () => workflow), getActiveWorkflowExecution: vi.fn(async () => null),
      startWorkflowExecution: vi.fn(async () => queued), getWorkflowExecution: vi.fn(async () => succeeded), startRun: vi.fn(),
    } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} connectionId={connectionId} />);

    const execute = await screen.findByRole("button", { name: "执行流水线" });
    await waitFor(() => expect(execute).toBeEnabled());
    fireEvent.click(execute);

    await waitFor(() => expect(api.startWorkflowExecution).toHaveBeenCalledWith(
      projectId, connectionId, current.id, expect.any(String), {}, false,
    ));
    expect(api.startRun).not.toHaveBeenCalled();
  });

  it("restores an active workflow after reload and keeps the execution gate until it is terminal", async () => {
    const current = tab("00000000-0000-4000-8000-000000000678", "sum", { a: 1 });
    const running = workflowExecution(current.id, "before");
    const terminal = deferred<WorkflowExecutionDetail>();
    const api = {
      listTabs: vi.fn(async () => [current]), getTool: vi.fn(async () => tool), updateTab: vi.fn(async () => current),
      getToolWorkflow: vi.fn(async () => workflow), getActiveWorkflowExecution: vi.fn(async () => running),
      getWorkflowExecution: vi.fn(() => terminal.promise), startWorkflowExecution: vi.fn(), startRun: vi.fn(),
    } as unknown as InspectorApiClient;
    render(<DebugWorkspace api={api} projectId={projectId} />);

    const execute = await screen.findByRole("button", { name: /执行/ });
    await waitFor(() => expect(api.getActiveWorkflowExecution).toHaveBeenCalledWith(
      projectId, current.id, expect.any(AbortSignal),
    ));
    expect(execute).toBeDisabled();
    fireEvent.click(execute);
    expect(api.startWorkflowExecution).not.toHaveBeenCalled();

    await act(async () => { terminal.resolve(workflowExecution(current.id, "succeeded")); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByRole("button", { name: "执行流水线" })).toBeEnabled());
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

  it("opens history in a new editable Tab with its request and response restored", async () => {
    const opened = tab("00000000-0000-4000-8000-000000000633", "sum", {});
    const run: RunDetail = {
      id: "00000000-0000-4000-8000-000000000634", projectId, connectionId,
      tabId: "00000000-0000-4000-8000-000000000635", toolName: "sum",
      toolSnapshotId: tool.tool.currentSnapshot.id, toolSnapshotHash: "a".repeat(64),
      idempotencyKey: "restore-history", status: "succeeded", createdAt: "2026-08-25T01:00:00.000Z",
      startedAt: "2026-08-25T01:00:00.010Z", completedAt: "2026-08-25T01:00:00.020Z",
      durationMs: 10, networkDurationMs: 8, protocolVersion: "2025-06-18", serverInfo: null,
      clientInfo: { name: "mcp-inspector", version: "0.1.0" },
      request: { arguments: { a: 40, b: 2 }, jsonrpc: {}, http: null },
      response: { result: { structuredContent: { answer: 42 } }, error: null, truncated: false, originalBytes: 32 },
      events: [],
    };
    const updateTab = vi.fn(async (_project: string, _id: string, patch: Partial<DebugTabSummary>) => ({ ...opened, ...patch }));
    const api = { listTabs: vi.fn(async () => []), getTool: vi.fn(async () => tool),
      openTab: vi.fn(async () => opened), updateTab, getRun: vi.fn(async () => run) } as unknown as InspectorApiClient;

    render(<DebugWorkspace api={api} projectId={projectId} toolIntent={{
      sequence: 1, tool: tool.tool, newTab: true, restoreRun: run,
    }} />);

    expect(await screen.findByRole("tab", { name: "sum" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("a")).toHaveValue(40);
    expect(screen.getByLabelText("b")).toHaveValue(2);
    expect(await screen.findByLabelText(`运行 ${run.id} 详情`)).toBeVisible();
    expect(updateTab).toHaveBeenCalledWith(projectId, opened.id, {
      arguments: run.request.arguments, rawText: '{\n  "a": 40,\n  "b": 2\n}',
    });
  });

  it("opens a new Tab when the active Tab is pinned", async () => {
    const saved = { ...tab("00000000-0000-4000-8000-000000000631", "sum", {}), pinned: true };
    const openTab = vi.fn(async () => ({ ...saved, id: "00000000-0000-4000-8000-000000000632", pinned: false, position: 1 }));
    const api = { listTabs: vi.fn(async () => [saved]), getTool: vi.fn(async () => tool), updateTab: vi.fn(),
      replaceTabTool: vi.fn(), openTab } as unknown as InspectorApiClient;
    const view = render(<DebugWorkspace api={api} projectId={projectId} />);
    const pinnedTab = await screen.findByRole("tab", { name: "sum，已固定" });
    expect(pinnedTab).toHaveTextContent(/^sum$/);
    expect(screen.getByTitle("已固定")).toBeVisible();
    expect(screen.getByRole("button", { name: "关闭 sum" })).toBeDisabled();
    view.rerender(<DebugWorkspace api={api} projectId={projectId} toolIntent={{ sequence: 1, tool: tool.tool, newTab: false }} />);
    await waitFor(() => expect(openTab).toHaveBeenCalledTimes(1)); expect(api.replaceTabTool).not.toHaveBeenCalled();
  });

  it("copies the Tool name from the first Tab menu action", async () => {
    const current = { ...tab("00000000-0000-4000-8000-000000000677", "sum (3)", {}), toolName: "sum" };
    const writeText = vi.fn().mockResolvedValue(undefined);
    const api = { listTabs: vi.fn(async () => [current]), getTool: vi.fn(async () => tool), updateTab: vi.fn() } as unknown as InspectorApiClient;
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<><AppToaster /><DebugWorkspace api={api} projectId={projectId} /></>);

    await user.click(await screen.findByLabelText("sum (3) 操作"));
    const menu = screen.getByLabelText("sum (3) Tab 操作菜单");
    const actions = within(menu).getAllByRole("button");
    expect(actions[0]).toHaveAccessibleName("复制名称");
    await user.click(actions[0]!);

    expect(writeText).toHaveBeenCalledWith("sum");
    expect((await screen.findByText("Tool 名称已复制")).closest("[data-sonner-toast]")).toHaveClass("app-toast");
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

  it("keeps a complex Form array and Raw JSON synchronized while editing and deleting it", () => {
    const schema = {
      type: "object",
      properties: { items: { type: "array", items: { type: "string" } } },
    };
    function LinkedEditor() {
      const [current, setCurrent] = useState(tab(
        "00000000-0000-4000-8000-000000000644", "sum", { items: ["one", "two"] },
      ));
      return <>
        <ParameterEditor tab={current} schema={schema}
          onChange={(patch) => setCurrent((value) => ({ ...value, ...patch }))} />
        <output aria-label="当前 Raw JSON">{current.rawText}</output>
      </>;
    }
    render(<LinkedEditor />);

    const items = screen.getByLabelText("items");
    fireEvent.change(items, { target: { value: '["one"]' } });
    expect(screen.getByLabelText("当前 Raw JSON")).toHaveTextContent('"items": [');
    expect(screen.getByLabelText("当前 Raw JSON")).not.toHaveTextContent('"two"');

    fireEvent.change(items, { target: { value: "" } });
    expect(screen.getByLabelText("当前 Raw JSON")).toHaveTextContent("{}");
    fireEvent.click(screen.getByRole("tab", { name: "Raw JSON" }));
    expect(screen.getByLabelText("完整 arguments JSON")).toHaveValue("");
  });

  it("saves named Tool request parameters without leaving Debug and confirms with a toast", async () => {
    const current = tab("00000000-0000-4000-8000-000000000655", "sum", { a: 4, b: 5 });
    const saved = { id: "00000000-0000-4000-8000-000000000656", projectId, connectionId, toolName: "sum",
      kind: "request" as const, name: "nine", description: "known result", sourceRunId: null,
      createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z", payload: { a: 4, b: 5 } };
    const api = { listTabs: vi.fn(async () => [current]), getTool: vi.fn(async () => tool), updateTab: vi.fn(),
      createSavedItem: vi.fn(async () => saved), listSavedItems: vi.fn(async () => ({ items: [saved], nextCursor: null })),
      getSavedItem: vi.fn(async () => saved), deleteSavedItem: vi.fn() } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<><AppToaster /><DebugWorkspace api={api} projectId={projectId} /></>);
    await user.click(await screen.findByRole("button", { name: "保存请求" }));
    const dialog = screen.getByRole("dialog", { name: "保存请求" });
    await user.type(screen.getByLabelText("名称"), "nine"); await user.type(screen.getByLabelText("描述"), "known result");
    await user.click(screen.getByRole("button", { name: "确认保存请求" }));
    expect(api.createSavedItem).toHaveBeenCalledWith(projectId, connectionId, "sum", {
      kind: "request", name: "nine", description: "known result", payload: { a: 4, b: 5 }, sourceRunId: null,
    });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "调试" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "已保存" })).not.toHaveAttribute("aria-current");
    expect((await screen.findByText("请求保存成功")).closest("[data-sonner-toast]")).toHaveClass("app-toast");
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
      clientInfo: { name: "mcp-inspector", version: "0.1.0" },
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
    const callbacks = { onSelect: vi.fn(), onCopyName: vi.fn(), onClose: vi.fn(), onDuplicate: vi.fn(), onPin: vi.fn(),
      onCloseOthers: vi.fn(), onCloseRight: vi.fn(), onMove: vi.fn() };
    const tabs = [tab("00000000-0000-4000-8000-000000000644", "sum", {}),
      { ...tab("00000000-0000-4000-8000-000000000645", "sum (2)", {}), position: 1 }];
    render(<TabStrip tabs={tabs} activeId={tabs[0].id} {...callbacks} />); const user = userEvent.setup();
    const actions: Array<[string, ReturnType<typeof vi.fn>]> = [
      ["复制名称", callbacks.onCopyName], ["复制 Tab", callbacks.onDuplicate], ["固定", callbacks.onPin],
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

  it("dismisses an open Tab menu when clicking elsewhere or pressing Escape", async () => {
    const callbacks = { onSelect: vi.fn(), onCopyName: vi.fn(), onClose: vi.fn(), onDuplicate: vi.fn(), onPin: vi.fn(),
      onCloseOthers: vi.fn(), onCloseRight: vi.fn(), onMove: vi.fn() };
    const saved = tab("00000000-0000-4000-8000-000000000646", "sum", {});
    const user = userEvent.setup();
    render(<><button type="button">页面空白操作</button><TabStrip tabs={[saved]} activeId={saved.id} {...callbacks} /></>);

    const summary = screen.getByLabelText("sum 操作");
    await user.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
    await user.click(screen.getByRole("button", { name: "页面空白操作" }));
    expect(summary.closest("details")).not.toHaveAttribute("open");

    await user.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
    await user.keyboard("{Escape}");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(summary).toHaveFocus();
  });
});
