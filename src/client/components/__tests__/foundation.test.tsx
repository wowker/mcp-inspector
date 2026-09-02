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
import { Select } from "../forms/Select.js";
import { FormField } from "../forms/FormField.js";

afterEach(cleanup);

describe("UI Foundation", () => {
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
