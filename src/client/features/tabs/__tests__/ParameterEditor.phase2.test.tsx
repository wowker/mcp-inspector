// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { DebugTabSummary } from "../../../api/api-client.js";
import { i18n } from "../../../i18n/index.js";
import { ParameterEditor } from "../ParameterEditor.js";

const projectId = "00000000-0000-4000-8000-000000009101";
const connectionId = "00000000-0000-4000-8000-000000009102";

function tab(args: Record<string, unknown> = {}): DebugTabSummary {
  return {
    id: "00000000-0000-4000-8000-000000009103",
    projectId,
    connectionId,
    toolName: "configure_items",
    title: "configure_items",
    position: 0,
    pinned: false,
    inputMode: "form",
    arguments: args,
    rawText: Object.keys(args).length === 0 ? "" : JSON.stringify(args, null, 2),
    viewState: { editorScrollTop: 0, resultScrollTop: 0, splitRatio: 0.5 },
    lastRunId: null,
  };
}

const arrayObjectSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          quantity: { type: "integer" },
        },
        required: ["id"],
      },
    },
  },
};

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("zh-CN");
});

describe("ParameterEditor phase two", () => {
  it("initializes an enabled optional array parameter as an empty array instead of null", () => {
    function Example() {
      const [current, setCurrent] = useState(tab());
      return <>
        <ParameterEditor tab={current} schema={arrayObjectSchema}
          onChange={(patch) => setCurrent((value) => ({ ...value, ...patch }))} />
        <output aria-label="当前参数">{JSON.stringify(current.arguments)}</output>
      </>;
    }

    render(<Example />);
    fireEvent.click(screen.getByRole("checkbox", { name: "跳过参数 items" }));
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('{"items":[]}');
  });

  it("edits array object entries as structured fields and synchronizes canonical arguments", () => {
    function Example() {
      const [current, setCurrent] = useState(tab({ items: [{ id: "first", quantity: 1 }] }));
      return <>
        <ParameterEditor tab={current} schema={arrayObjectSchema}
          onChange={(patch) => setCurrent((value) => ({ ...value, ...patch }))} />
        <output aria-label="当前参数">{JSON.stringify(current.arguments)}</output>
        <output aria-label="当前 Raw JSON">{current.rawText}</output>
      </>;
    }

    render(<Example />);
    expect(screen.getByRole("group", { name: "items 第 1 项" })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "items 第 1 项 id" }), { target: { value: "updated" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "items 第 1 项 quantity" }), { target: { value: "2" } });

    expect(screen.getByLabelText("当前参数")).toHaveTextContent('"id":"updated"');
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('"quantity":2');
    expect(screen.getByLabelText("当前 Raw JSON")).toHaveTextContent('"updated"');
  });

  it("adds, collapses, reorders and deletes array object entries", () => {
    function Example() {
      const [current, setCurrent] = useState(tab({ items: [{ id: "first" }, { id: "second" }] }));
      return <>
        <ParameterEditor tab={current} schema={arrayObjectSchema}
          onChange={(patch) => setCurrent((value) => ({ ...value, ...patch }))} />
        <output aria-label="当前参数">{JSON.stringify(current.arguments)}</output>
      </>;
    }

    render(<Example />);
    const first = screen.getByRole("group", { name: "items 第 1 项" });
    const firstDisclosure = within(first).getAllByRole("button").find((button) => button.hasAttribute("aria-expanded"))!;
    expect(firstDisclosure).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(firstDisclosure);
    expect(within(first).queryByRole("textbox", { name: "items 第 1 项 id" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "添加一项" }));
    expect(screen.getByRole("group", { name: "items 第 3 项" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "下移第 1 项" }));
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('{"items":[{"id":"second"},{"id":"first"},{}]}');
    fireEvent.click(screen.getByRole("button", { name: "删除第 2 项" }));
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('{"items":[{"id":"second"},{}]}');
  });

  it("switches one complex field between Form and Raw JSON without losing canonical arguments", () => {
    function Example() {
      const [current, setCurrent] = useState(tab({ items: [{ id: "form", quantity: 1 }] }));
      return <>
        <ParameterEditor tab={current} schema={arrayObjectSchema}
          onChange={(patch) => setCurrent((value) => ({ ...value, ...patch }))} />
        <output aria-label="当前参数">{JSON.stringify(current.arguments)}</output>
        <output aria-label="当前 Raw JSON">{current.rawText}</output>
      </>;
    }

    render(<Example />);
    const modes = screen.getByRole("tablist", { name: "items 编辑模式" });
    fireEvent.click(within(modes).getByRole("tab", { name: "Raw JSON" }));
    const raw = screen.getByRole("textbox", { name: "items 数组 JSON" });
    fireEvent.change(raw, { target: { value: '[{"id":"raw","quantity":3}]' } });
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('{"items":[{"id":"raw","quantity":3}]}');
    expect(screen.getByLabelText("当前 Raw JSON")).toHaveTextContent('"id": "raw"');

    fireEvent.change(raw, { target: { value: "{}" } });
    expect(screen.getByRole("alert")).toHaveTextContent("必须是由对象组成的 JSON 数组");
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('{"items":[{"id":"raw","quantity":3}]}');

    fireEvent.click(within(modes).getByRole("tab", { name: "Form" }));
    expect(screen.getByRole("textbox", { name: "items 第 1 项 id" })).toHaveValue("raw");
  });
});
