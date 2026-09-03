// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopySimple } from "@phosphor-icons/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../actions/Button.js";
import { IconButton } from "../actions/IconButton.js";
import { StatusBadge } from "../feedback/StatusBadge.js";
import { Disclosure } from "../layout/Disclosure.js";
import { Dialog } from "../overlays/Dialog.js";
import { Popover } from "../overlays/Popover.js";
import { ModuleHelpPopover } from "../overlays/ModuleHelpPopover.js";
import { Select } from "../forms/Select.js";
import { SearchableSelect } from "../forms/SearchableSelect.js";
import { FormField } from "../forms/FormField.js";
import { Switch } from "../forms/Switch.js";

afterEach(cleanup);

describe("UI Foundation", () => {
  it("presents persistent boolean settings as an accessible switch", async () => {
    const changed = vi.fn();
    render(<Switch checked={false} onChange={changed} label="启用此测试用例"
      onLabel="已启用" offLabel="已停用" />);

    const control = screen.getByRole("switch", { name: "启用此测试用例" });
    expect(control).not.toBeChecked();
    expect(screen.getByText("已停用")).toBeVisible();
    await userEvent.click(control);
    expect(changed).toHaveBeenCalledWith(true);
  });

  it("keeps ordinary buttons non-submitting and blocks duplicate loading actions", () => {
    const action = vi.fn();
    const { rerender } = render(<Button variant="primary" onClick={action}>保存修改</Button>);
    const button = screen.getByRole("button", { name: "保存修改" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-variant", "primary");
    fireEvent.click(button);
    expect(action).toHaveBeenCalledOnce();

    rerender(<Button variant="primary" disabled onClick={action}>保存修改</Button>);
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();

    rerender(<Button variant="primary" loading loadingLabel="正在保存" onClick={action}>保存修改</Button>);
    expect(screen.getByRole("button", { name: "正在保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "正在保存" })).toHaveAttribute("aria-busy", "true");
    fireEvent.click(screen.getByRole("button", { name: "正在保存" }));
    expect(action).toHaveBeenCalledOnce();
  });

  it("requires a translated accessible label for icon-only actions", () => {
    render(<IconButton label="Copy name" icon={<CopySimple aria-hidden="true" />} />);
    const button = screen.getByRole("button", { name: "Copy name" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("title", "Copy name");
  });

  it("maps statuses to semantic tones without owning translated text", () => {
    render(<><StatusBadge status="success">已连接</StatusBadge><StatusBadge status="danger">Failed</StatusBadge></>);
    expect(screen.getByText("已连接")).toHaveAttribute("data-status", "success");
    expect(screen.getByText("Failed")).toHaveAttribute("data-status", "danger");
  });

  it("toggles an accessible disclosure by keyboard and supports controlled state", async () => {
    const changed = vi.fn();
    const { rerender } = render(<Disclosure label="请求参数" defaultExpanded>内容</Disclosure>);
    const trigger = screen.getByRole("button", { name: "请求参数" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("内容")).toBeVisible();
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("内容")).not.toBeInTheDocument();

    rerender(<Disclosure label="Request" expanded={false} onExpandedChange={changed}>Body</Disclosure>);
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    expect(changed).toHaveBeenCalledWith(true);
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
  });

  it("moves focus into a dialog, traps Tab, closes on Escape, and restores its trigger", async () => {
    const close = vi.fn();
    const launch = document.createElement("button");
    launch.textContent = "打开";
    document.body.append(launch);
    launch.focus();
    const initialFocusRef = { current: null as HTMLInputElement | null };
    const { unmount } = render(<Dialog titleId="dialog-title" initialFocusRef={initialFocusRef} onClose={close}>
      <h2 id="dialog-title">保存请求</h2><input ref={initialFocusRef} aria-label="名称" /><button type="button">取消</button>
    </Dialog>);

    expect(screen.getByRole("dialog", { name: "保存请求" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "名称" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(close).toHaveBeenCalledOnce();
    unmount();
    expect(launch).toHaveFocus();
    launch.remove();
  });

  it("closes on an enabled backdrop click but preserves a busy dialog", () => {
    const close = vi.fn();
    const { rerender } = render(<Dialog titleId="dialog-title" onClose={close}>
      <h2 id="dialog-title">删除连接</h2><button type="button">取消</button>
    </Dialog>);

    fireEvent.mouseDown(document.querySelector(".dialog-backdrop")!);
    expect(close).toHaveBeenCalledOnce();

    rerender(<Dialog titleId="dialog-title" onClose={close} closeDisabled>
      <h2 id="dialog-title">删除连接</h2><button type="button">取消</button>
    </Dialog>);
    fireEvent.mouseDown(document.querySelector(".dialog-backdrop")!);
    expect(close).toHaveBeenCalledOnce();
  });

  it("uses the same viewport-aware dismissal contract for an anchored popover", () => {
    const close = vi.fn();
    const anchor = document.createElement("button");
    document.body.append(anchor);
    render(<Popover anchorRef={{ current: anchor }} role="listbox" onClose={close}>
      <button type="button">选项</button>
    </Popover>);

    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: "Escape" });
    expect(close).toHaveBeenCalledWith(true);
    fireEvent.pointerDown(document.body);
    expect(close).toHaveBeenLastCalledWith(false);
    anchor.remove();
  });

  it("opens structured module help and restores focus after Escape or the close action", async () => {
    const user = userEvent.setup();
    render(<ModuleHelpPopover moduleName="环境变量" triggerLabel="了解环境变量" closeLabel="关闭环境变量说明"
      summary="配置中心" description="集中管理连接和脚本配置。" sections={[
        { id: "purpose", title: "模块用途", items: ["复用配置值。"] },
        { id: "configure", title: "如何配置", items: ["选择作用域。"] },
        { id: "use", title: "如何使用", items: ["引用变量。"] },
        { id: "effect", title: "产生效果", items: ["解析后生效。"] },
      ]} />);

    const trigger = screen.getByRole("button", { name: "了解环境变量" });
    expect(trigger).toHaveAttribute("data-help-icon", "info");
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "环境变量" })).toBeVisible();
    expect(screen.getByRole("dialog", { name: "环境变量" })).toHaveTextContent("集中管理连接和脚本配置。");
    expect(screen.getByRole("heading", { name: "如何配置" })).toBeVisible();
    expect(screen.getByRole("button", { name: "关闭环境变量说明" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "环境变量" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "关闭环境变量说明" }));
    expect(trigger).toHaveFocus();
  });

  it("keeps only one help popover open without stealing focus from the newer trigger", async () => {
    const user = userEvent.setup();
    const sections = [{ id: "purpose", title: "用途", items: ["说明"] }];
    render(<><ModuleHelpPopover moduleName="模块说明" triggerLabel="打开模块说明" closeLabel="关闭模块说明"
      summary="模块" sections={sections} />
    <ModuleHelpPopover moduleName="筛选说明" triggerLabel="打开筛选说明" closeLabel="关闭筛选说明"
      summary="筛选" sections={sections} /></>);

    await user.click(screen.getByRole("button", { name: "打开模块说明" }));
    expect(screen.getByRole("dialog", { name: "模块说明" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "打开筛选说明" }));
    expect(screen.queryByRole("dialog", { name: "模块说明" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "筛选说明" })).toBeVisible();
    expect(screen.getByRole("button", { name: "关闭筛选说明" })).toHaveFocus();
  });

  it("wraps a native select with a visible placeholder and preserves keyboard selection", async () => {
    const changed = vi.fn();
    render(<Select aria-label="认证方式" value="" onChange={changed}>
      <option value="">请选择</option><option value="oauth">OAuth 自动授权</option>
    </Select>);

    const select = screen.getByRole("combobox", { name: "认证方式" });
    expect(select).toHaveValue("");
    expect(screen.getByRole("option", { name: "请选择" })).toHaveValue("");
    await userEvent.selectOptions(select, "oauth");
    expect(changed).toHaveBeenCalledOnce();
  });

  it("searches stable values by exact, prefix, contained, and keyword matches", async () => {
    const changed = vi.fn();
    const user = userEvent.setup();
    render(<SearchableSelect ariaLabel="选择 Tool" value={null} onChange={changed}
      placeholder="请选择 Tool" searchPlaceholder="搜索 Tool" emptyMessage="没有匹配的 Tool" options={[
        { value: "contained", label: "Helper for order" },
        { value: "prefix", label: "Order lookup" },
        { value: "keyword", label: "Fetch purchase", keywords: ["order"] },
        { value: "exact", label: "Order" },
      ]} />);

    await user.click(screen.getByRole("combobox", { name: "选择 Tool" }));
    const search = screen.getByRole("searchbox", { name: "搜索 Tool" });
    expect(search).toHaveFocus();
    await user.type(search, " order ");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Order", "Order lookup", "Helper for order", "Fetch purchase",
    ]);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(changed).toHaveBeenCalledWith("exact");
    expect(screen.getByRole("combobox", { name: "选择 Tool" })).toHaveFocus();
  });

  it("supports empty, disabled, Escape, duplicate-value, and bounded-list behavior", async () => {
    const changed = vi.fn();
    const user = userEvent.setup();
    const options = Array.from({ length: 1_000 }, (_, index) => ({ value: `tool-${index}`, label: `Tool ${index}`, disabled: false }));
    options.splice(1, 0, { value: "tool-0", label: "Duplicate Tool", disabled: false });
    options[2] = { ...options[2]!, value: "disabled", label: "Disabled Tool", disabled: true };
    render(<SearchableSelect ariaLabel="选择大列表" value={null} onChange={changed}
      placeholder="请选择" searchPlaceholder="搜索选项" emptyMessage="没有结果" options={options} />);

    const trigger = screen.getByRole("combobox", { name: "选择大列表" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")).toHaveLength(200);
    expect(screen.getAllByRole("option", { name: "Tool 0" })).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Disabled Tool" })).toBeDisabled();
    await user.clear(screen.getByRole("searchbox", { name: "搜索选项" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索选项" }), "missing");
    expect(screen.getByText("没有结果")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(changed).not.toHaveBeenCalled();
  });

  it("does not select during IME composition and closes naturally on Tab", async () => {
    const changed = vi.fn();
    const user = userEvent.setup();
    render(<SearchableSelect ariaLabel="选择环境" value={null} onChange={changed}
      placeholder="请选择" searchPlaceholder="搜索环境" emptyMessage="没有结果"
      options={[{ value: "production", label: "生产环境" }]} />);
    await user.click(screen.getByRole("combobox", { name: "选择环境" }));
    const search = screen.getByRole("searchbox", { name: "搜索环境" });
    fireEvent.compositionStart(search);
    fireEvent.change(search, { target: { value: "生产" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.compositionEnd(search);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(changed).toHaveBeenCalledWith("production");

    await user.click(screen.getByRole("combobox", { name: "选择环境" }));
    await user.tab();
    expect(screen.queryByRole("listbox", { name: "选择环境" })).not.toBeInTheDocument();
  });

  it("exposes loading, empty, and clear states without inventing a value", async () => {
    const changed = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<SearchableSelect ariaLabel="选择 Profile" value={null} onChange={changed}
      loading placeholder="基础变量" searchPlaceholder="搜索 Profile" emptyMessage="没有 Profile"
      loadingMessage="正在加载 Profile" options={[]} />);
    await user.click(screen.getByRole("combobox", { name: "选择 Profile" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在加载 Profile");
    await user.keyboard("{Escape}");

    rerender(<SearchableSelect ariaLabel="选择 Profile" value="profile-1" onChange={changed} clearable
      clearLabel="清除 Profile" placeholder="基础变量" searchPlaceholder="搜索 Profile" emptyMessage="没有 Profile"
      options={[{ value: "profile-1", label: "生产环境" }]} />);
    await user.click(screen.getByRole("button", { name: "清除 Profile" }));
    expect(changed).toHaveBeenCalledWith(null);
  });

  it("keeps field label, required state, help text, constraints, control, and error associated", () => {
    render(<FormField label="MCP URL" htmlFor="server-url" required description="Server endpoint" constraint="HTTPS only"
      error="请输入有效 URL"><input id="server-url" aria-describedby="existing-description" /></FormField>);

    const input = screen.getByRole("textbox", { name: /MCP URL/ });
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Server endpoint")).toBeVisible();
    expect(screen.getByText("HTTPS only")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("请输入有效 URL");
    expect(input).toHaveAttribute("aria-describedby", expect.stringContaining("existing-description"));
  });
});
