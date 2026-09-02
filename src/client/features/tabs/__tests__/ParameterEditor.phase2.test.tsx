// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

const nestedObjectSchema = {
  type: "object",
  properties: {
    profile: {
      type: "object",
      description: "Profile used by the request.",
      properties: {
        displayName: { type: "string" },
        preferences: {
          type: "object",
          properties: {
            locale: { type: "string" },
            notifications: { type: "boolean" },
          },
          required: ["locale"],
        },
      },
      required: ["displayName"],
    },
  },
};

const branchObjectSchema = {
  type: "object",
  properties: {
    payment: {
      type: "object",
      discriminator: { propertyName: "kind" },
      properties: { requestId: { type: "string" } },
      required: ["kind", "requestId"],
      oneOf: [
        { type: "object", title: "Card", properties: {
          kind: { const: "card" }, cardNumber: { type: "string" },
        }, required: ["cardNumber"] },
        { type: "object", title: "Wallet", properties: {
          kind: { const: "wallet" }, walletId: { type: "string" },
        }, required: ["walletId"] },
      ],
    },
  },
  required: ["payment"],
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

  it("recursively edits safe nested objects and synchronizes the whole canonical Raw JSON", () => {
    function Example() {
      const [current, setCurrent] = useState(tab({ profile: {
        displayName: "before", preferences: { locale: "zh-CN", notifications: false },
      } }));
      return <>
        <ParameterEditor tab={current} schema={nestedObjectSchema}
          onChange={(patch) => setCurrent((value) => ({ ...value, ...patch }))} />
        <output aria-label="当前参数">{JSON.stringify(current.arguments)}</output>
        <output aria-label="当前 Raw JSON">{current.rawText}</output>
      </>;
    }

    render(<Example />);
    expect(screen.getByRole("group", { name: "profile 对象" })).toBeVisible();
    expect(screen.getByRole("group", { name: "preferences 对象" })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "profile displayName" }), { target: { value: "after" } });
    fireEvent.change(screen.getByRole("textbox", { name: "profile preferences locale" }), { target: { value: "en-US" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "profile preferences notifications" }));

    expect(screen.getByLabelText("当前参数")).toHaveTextContent('"displayName":"after"');
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('"locale":"en-US"');
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('"notifications":true');
    expect(screen.getByLabelText("当前 Raw JSON")).toHaveTextContent('"displayName": "after"');
  });

  it("supports roving keyboard navigation for nested object editing modes", () => {
    render(<ParameterEditor tab={tab({ profile: { displayName: "stable" } })}
      schema={nestedObjectSchema} onChange={vi.fn()} />);
    const modes = screen.getByRole("tablist", { name: "profile 编辑模式" });
    const form = within(modes).getByRole("tab", { name: "Form" });
    const raw = within(modes).getByRole("tab", { name: "Raw JSON" });

    form.focus();
    fireEvent.keyDown(modes, { key: "ArrowRight" });
    expect(raw).toHaveFocus();
    expect(raw).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "profile 对象 JSON" })).toBeVisible();

    fireEvent.keyDown(modes, { key: "Home" });
    expect(form).toHaveFocus();
    expect(form).toHaveAttribute("aria-selected", "true");
  });

  it("keeps invalid local object Raw JSON isolated by JSON Pointer until it becomes valid", () => {
    const drafts: Record<string, { text: string; base: string }> = {};
    const onDraftChange = vi.fn((path: string, text: string, base: string) => { drafts[path] = { text, base }; });
    function Example() {
      const [current, setCurrent] = useState(tab({ profile: { displayName: "stable" } }));
      return <>
        <ParameterEditor tab={current} schema={nestedObjectSchema} subtreeDrafts={drafts}
          onSubtreeDraftChange={onDraftChange}
          onChange={(patch) => setCurrent((value) => ({ ...value, ...patch }))} />
        <output aria-label="当前参数">{JSON.stringify(current.arguments)}</output>
      </>;
    }

    render(<Example />);
    const modes = screen.getByRole("tablist", { name: "profile 编辑模式" });
    fireEvent.click(within(modes).getByRole("tab", { name: "Raw JSON" }));
    const raw = screen.getByRole("textbox", { name: "profile 对象 JSON" });
    fireEvent.change(raw, { target: { value: '{"displayName":' } });
    fireEvent.blur(raw);
    expect(screen.getByRole("alert")).toHaveTextContent("必须是 JSON 对象");
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('"displayName":"stable"');
    expect(onDraftChange).toHaveBeenLastCalledWith("/profile", '{"displayName":', expect.any(String));

    fireEvent.change(raw, { target: { value: '{"displayName":"committed"}' } });
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('"displayName":"committed"');
  });

  it("uses escaped JSON Pointers for object draft identity", () => {
    const onDraftChange = vi.fn();
    const schema = JSON.parse('{"type":"object","properties":{"a/b~c":{"type":"object","properties":{"value":{"type":"string"}}}}}') as Record<string, unknown>;
    render(<ParameterEditor tab={tab({ "a/b~c": { value: "stable" } })} schema={schema}
      onChange={vi.fn()} onSubtreeDraftChange={onDraftChange} />);

    const modes = screen.getByRole("tablist", { name: "a/b~c 编辑模式" });
    fireEvent.click(within(modes).getByRole("tab", { name: "Raw JSON" }));
    fireEvent.change(screen.getByRole("textbox", { name: "a/b~c 对象 JSON" }), { target: { value: '{"value":' } });
    expect(onDraftChange).toHaveBeenLastCalledWith("/a~1b~0c", '{"value":', expect.any(String));
  });

  it("falls back to local JSON for excessive depth, ambiguous schemas, and prototype keys", () => {
    const dangerous = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}') as Record<string, unknown>;
    const schema = { type: "object", properties: {
      safe: { type: "object", properties: {
        level2: { type: "object", properties: {
          level3: { type: "object", properties: {
            level4: { type: "object", properties: { value: { type: "string" } } },
          } },
        } },
      } },
      ambiguous: { type: "object", oneOf: [
        { properties: { kind: { const: "a" } } }, { properties: { kind: { const: "b" } } },
      ] },
      dangerous,
    } };
    render(<ParameterEditor tab={tab({
      safe: { level2: { level3: { level4: { value: "raw" } } } },
      ambiguous: { kind: "a" }, dangerous: { "__proto__": "blocked" },
    })} schema={schema} onChange={vi.fn()} />);

    expect(screen.getByRole("group", { name: "safe 对象" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "level3 对象 JSON" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /level4 value/ })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "ambiguous" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "dangerous" })).toBeVisible();
  });

  it("falls back to local JSON when canonical object values contain prototype keys", () => {
    const unsafeProfile = JSON.parse('{"displayName":"safe","__proto__":{"polluted":true}}') as Record<string, unknown>;
    render(<ParameterEditor tab={tab({ profile: unsafeProfile })} schema={nestedObjectSchema} onChange={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "profile" })).toBeVisible();
    expect(screen.queryByRole("group", { name: "profile 对象" })).not.toBeInTheDocument();
  });

  it("switches deterministic object branches only after confirming field removal", () => {
    function Example() {
      const [current, setCurrent] = useState(tab({ payment: {
        kind: "card", requestId: "req", cardNumber: "4111", extension: "keep",
      } }));
      return <>
        <ParameterEditor tab={current} schema={branchObjectSchema}
          onChange={(patch) => setCurrent((value) => ({ ...value, ...patch }))} />
        <output aria-label="当前参数">{JSON.stringify(current.arguments)}</output>
        <output aria-label="当前 Raw JSON">{current.rawText}</output>
      </>;
    }

    render(<Example />);
    const branches = screen.getByRole("radiogroup", { name: "payment 分支" });
    expect(within(branches).getByRole("radio", { name: "Card" })).toBeChecked();
    fireEvent.click(within(branches).getByRole("radio", { name: "Wallet" }));
    expect(screen.getByRole("alert", { name: "确认切换 payment 分支" })).toHaveTextContent("cardNumber");
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('"kind":"card"');

    fireEvent.click(screen.getByRole("button", { name: "取消切换" }));
    expect(screen.queryByRole("alert", { name: "确认切换 payment 分支" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('"cardNumber":"4111"');

    fireEvent.click(within(branches).getByRole("radio", { name: "Wallet" }));
    fireEvent.click(screen.getByRole("button", { name: "确认切换" }));
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('"kind":"wallet"');
    expect(screen.getByLabelText("当前参数")).not.toHaveTextContent("cardNumber");
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('"extension":"keep"');
    expect(screen.getByRole("textbox", { name: "payment walletId" })).toBeVisible();
    expect(screen.getByLabelText("当前 Raw JSON")).toHaveTextContent('"kind": "wallet"');
  });

  it("lets an uninitialized required object choose its first deterministic branch", () => {
    function Example() {
      const [current, setCurrent] = useState(tab());
      return <>
        <ParameterEditor tab={current} schema={branchObjectSchema}
          onChange={(patch) => setCurrent((value) => ({ ...value, ...patch }))} />
        <output aria-label="当前参数">{JSON.stringify(current.arguments)}</output>
      </>;
    }

    render(<Example />);
    const branches = screen.getByRole("radiogroup", { name: "payment 分支" });
    expect(within(branches).getByRole("radio", { name: "Card" })).not.toBeChecked();
    fireEvent.click(within(branches).getByRole("radio", { name: "Card" }));
    expect(screen.getByLabelText("当前参数")).toHaveTextContent('"payment":{"kind":"card"}');
    expect(screen.getByRole("textbox", { name: "payment cardNumber" })).toBeVisible();
  });

  it("falls back to local JSON when a deterministic branch value contains prototype keys", () => {
    const unsafePayment = JSON.parse('{"kind":"card","__proto__":{"polluted":true}}') as Record<string, unknown>;
    render(<ParameterEditor tab={tab({ payment: unsafePayment })} schema={branchObjectSchema} onChange={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "payment" })).toBeVisible();
    expect(screen.queryByRole("radiogroup", { name: "payment 分支" })).not.toBeInTheDocument();
  });
});
