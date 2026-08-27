// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { AppToaster, confirmToast } from "./AppToaster.js";

afterEach(() => {
  toast.dismiss();
  cleanup();
});

describe("AppToaster", () => {
  it("renders every notification through one styled Sonner viewport", async () => {
    render(<AppToaster />);

    act(() => { toast.success("配置已保存"); });

    const message = await screen.findByText("配置已保存");
    expect(message.closest("[data-sonner-toast]")).toHaveAttribute("data-type", "success");
    expect(document.querySelector("[data-sonner-toaster]")).toHaveStyle({
      "--width": "440px",
      top: "50%",
      bottom: "auto",
      left: "50%",
      right: "auto",
      transform: "translate(-50%, -50%)",
    });
  });

  it("supports explicit action and cancel choices", async () => {
    const onAction = vi.fn(); const onCancel = vi.fn();
    render(<AppToaster />);

    act(() => { confirmToast({
      message: "辅助 Tool 可能产生副作用",
      actionLabel: "允许试运行",
      cancelLabel: "取消",
      onAction,
      onCancel,
    }); });

    expect(await screen.findByText("辅助 Tool 可能产生副作用")).toBeVisible();
    expect(screen.getByRole("button", { name: "关闭通知" })).toHaveClass("app-toast__close");
    expect(screen.getByRole("button", { name: "取消" })).toHaveClass("app-toast__cancel");
    expect(screen.getByRole("button", { name: "允许试运行" })).toHaveClass("app-toast__action");
    fireEvent.click(screen.getByRole("button", { name: "允许试运行" }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
