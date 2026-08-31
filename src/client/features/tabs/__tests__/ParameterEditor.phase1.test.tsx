// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DebugTabSummary } from "../../../api/api-client.js";
import { ParameterEditor } from "../ParameterEditor.js";
import { i18n } from "../../../i18n/index.js";

const projectId = "00000000-0000-4000-8000-000000001001";
const connectionId = "00000000-0000-4000-8000-000000001002";

function tab(id: string, args: Record<string, unknown> = {}): DebugTabSummary {
  return {
    id,
    projectId,
    connectionId,
    toolName: "configure",
    title: "configure",
    position: 0,
    pinned: false,
    inputMode: "form",
    arguments: args,
    rawText: JSON.stringify(args, null, 2),
    viewState: { editorScrollTop: 0, resultScrollTop: 0, splitRatio: 0.5 },
    lastRunId: null,
  };
}

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage("zh-CN");
});

describe("ParameterEditor phase one", () => {
  it("shows a compact required/error summary and focuses the first invalid field", () => {
    render(<ParameterEditor
      tab={tab("00000000-0000-4000-8000-000000001003", { code: "bad" })}
      schema={{
        type: "object",
        properties: {
          account_id: { type: "string" },
          code: { type: "string", pattern: "^ok-" },
        },
        required: ["account_id", "code"],
      }}
      onChange={vi.fn()}
    />);

    expect(screen.getByText("必填 1/2")).toBeVisible();
    const errors = screen.getByRole("button", { name: "定位到第一个错误，共 2 个" });
    expect(errors).toHaveTextContent("错误 2");
    fireEvent.click(errors);
    expect(screen.getByRole("textbox", { name: /account_id/ })).toHaveFocus();
  });

  it("filters a long form without changing arguments and keeps each Tab filter independent", () => {
    const schema = {
      type: "object",
      properties: {
        required_one: { type: "string" },
        filled_one: { type: "string" },
        empty_one: { type: "string" },
        empty_two: { type: "number" },
        empty_three: { type: "boolean" },
        empty_four: { type: "string" },
      },
      required: ["required_one"],
    };
    function LinkedEditor() {
      const [active, setActive] = useState<"first" | "second">("first");
      const [first, setFirst] = useState(tab("00000000-0000-4000-8000-000000001004", {
        required_one: "required",
        filled_one: "filled",
      }));
      const [second, setSecond] = useState(tab("00000000-0000-4000-8000-000000001005", {
        required_one: "other",
      }));
      const current = active === "first" ? first : second;
      return <>
        <button type="button" onClick={() => setActive(active === "first" ? "second" : "first")}>切换测试 Tab</button>
        <ParameterEditor tab={current} schema={schema} onChange={(patch) => {
          if (active === "first") setFirst((value) => ({ ...value, ...patch }));
          else setSecond((value) => ({ ...value, ...patch }));
        }} />
        <output aria-label="当前参数">{JSON.stringify(current.arguments)}</output>
      </>;
    }
    render(<LinkedEditor />);

    const filters = screen.getByRole("group", { name: "筛选参数" });
    fireEvent.click(within(filters).getByRole("button", { name: "已填写" }));
    expect(screen.getByLabelText(/required_one/)).toBeVisible();
    expect(screen.getByLabelText("filled_one")).toBeVisible();
    expect(screen.queryByLabelText("empty_one")).not.toBeInTheDocument();
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('"filled_one":"filled"');

    fireEvent.click(screen.getByRole("button", { name: "切换测试 Tab" }));
    expect(within(screen.getByRole("group", { name: "筛选参数" })).getByRole("button", { name: "全部" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("empty_one")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "切换测试 Tab" }));
    expect(within(screen.getByRole("group", { name: "筛选参数" })).getByRole("button", { name: "已填写" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("clamps a long description until the user expands it", () => {
    render(<ParameterEditor
      tab={tab("00000000-0000-4000-8000-000000001006", { notes: "hello" })}
      schema={{ type: "object", properties: {
        notes: { type: "string", description: "This deliberately long description explains the field in enough detail to require a progressive disclosure control for the editor layout." },
      } }}
      onChange={vi.fn()}
    />);

    const description = screen.getByText(/This deliberately long description/);
    expect(description).toHaveClass("schema-field__description--clamped");
    fireEvent.click(screen.getByRole("button", { name: "展开 notes 的说明" }));
    expect(description).not.toHaveClass("schema-field__description--clamped");
    expect(screen.getByRole("button", { name: "收起 notes 的说明" })).toBeVisible();
  });

  it("formats, copies and opens a complex JSON parameter without changing Skip behavior", async () => {
    const clipboard = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    const schema = { type: "object", properties: { items: { type: "array", items: { type: "object" } } } };
    function LinkedEditor() {
      const [current, setCurrent] = useState(tab("00000000-0000-4000-8000-000000001007", {
        items: [{ id: 1 }, { id: 2 }],
      }));
      return <ParameterEditor tab={current} schema={schema}
        onChange={(patch) => setCurrent((value) => ({ ...value, ...patch }))} />;
    }
    render(<LinkedEditor />);

    expect(screen.getByText("Array<Object> · 2 项")).toBeVisible();
    const editor = screen.getByRole("textbox", { name: "items" });
    fireEvent.change(editor, { target: { value: '[{"id":1},{"id":2}]' } });
    fireEvent.click(screen.getByRole("button", { name: "格式化 items JSON" }));
    expect(editor).toHaveValue('[\n  {\n    "id": 1\n  },\n  {\n    "id": 2\n  }\n]');

    fireEvent.click(screen.getByRole("button", { name: "复制 items JSON" }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith('[\n  {\n    "id": 1\n  },\n  {\n    "id": 2\n  }\n]'));

    const enlarge = screen.getByRole("button", { name: "放大编辑 items JSON" });
    fireEvent.click(enlarge);
    expect(screen.getByRole("dialog", { name: "编辑 items JSON" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "items JSON 放大编辑器" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "关闭 JSON 放大编辑器" }));
    expect(enlarge).toHaveFocus();
  });

  it("renders the complete phase-one parameter flow in English", async () => {
    await i18n.changeLanguage("en-US");
    render(<ParameterEditor
      tab={tab("00000000-0000-4000-8000-000000001008", { account_id: "ready" })}
      schema={{ type: "object", properties: {
        account_id: { type: "string" }, optional: { type: "string" }, third: { type: "number" },
        fourth: { type: "boolean" }, fifth: { type: "string" }, sixth: { type: "string" },
      }, required: ["account_id"] }}
      onChange={vi.fn()}
    />);

    expect(screen.getByLabelText("Parameter input mode")).toBeVisible();
    expect(screen.getByText("Required 1/1")).toBeVisible();
    expect(screen.getByRole("group", { name: "Filter parameters" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
  });
});
