// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient, ToolWorkflow } from "../../../api/api-client.js";
import { AppToaster } from "../../../app/AppToaster.js";
import { ScriptWorkflowView } from "../ScriptWorkflowView.js";

const projectId = "00000000-0000-4000-8000-000000000731";
const connectionId = "00000000-0000-4000-8000-000000000732";
const workflow: ToolWorkflow = {
  projectId, connectionId, toolName: "sum", revision: 1,
  before: { enabled: false, source: "" }, after: { enabled: false, source: "" }, timeoutMs: 5_000,
  createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z",
};

function client(overrides: Partial<InspectorApiClient> = {}): InspectorApiClient {
  return {
    getToolWorkflow: vi.fn().mockResolvedValue(workflow),
    updateToolWorkflow: vi.fn().mockImplementation(async (_p, _c, _t, input) => ({ ...workflow, ...input, revision: 2 })),
    validateToolWorkflow: vi.fn().mockResolvedValue({ valid: true }),
    debugToolWorkflow: vi.fn().mockResolvedValue({
      phase: "before", arguments: {}, variables: {}, stagedEnvironment: [], logs: [],
    }),
    listEnvironmentVariables: vi.fn().mockResolvedValue([]),
    setEnvironmentVariable: vi.fn(), deleteEnvironmentVariable: vi.fn(),
    ...overrides,
  } as unknown as InspectorApiClient;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("ScriptWorkflowView", () => {
  it("uses the shared project control styling for every script form input", async () => {
    const api = client();
    render(<ScriptWorkflowView api={api} projectId={projectId} connectionId={connectionId} toolName="sum" argumentsValue={{}} />);

    await screen.findByText("前置脚本");
    expect(screen.getByLabelText("脚本超时（毫秒）")).toHaveClass("ui-input");

    expect(screen.queryByText("前置与后置脚本")).not.toBeInTheDocument();
    const beforeCard = screen.getByRole("heading", { name: "前置脚本", level: 2 }).closest("section");
    const afterCard = screen.getByRole("heading", { name: "后置脚本", level: 2 }).closest("section");
    expect(beforeCard).toHaveClass("script-phase--before");
    expect(afterCard).toHaveClass("script-phase--after");
    expect(afterCard).toHaveTextContent("02");
    expect(beforeCard?.querySelector("footer")).toHaveClass("script-phase__footer");
    expect(afterCard?.querySelector("footer")).toHaveClass("script-phase__footer");
  });

  it("enables, validates, and revision-safely saves a before script", async () => {
    const api = client(); const user = userEvent.setup();
    render(<><AppToaster /><ScriptWorkflowView api={api} projectId={projectId} connectionId={connectionId} toolName="sum" argumentsValue={{ a: 1 }} /></>);

    const toggles = await screen.findAllByRole("checkbox", { name: "未启用" });
    await user.click(toggles[0]!);
    expect((screen.getByLabelText("前置脚本源码") as HTMLTextAreaElement).value).toContain("function before");
    await user.click(screen.getAllByRole("button", { name: "校验语法" })[0]!);
    expect(await screen.findByText(/前置脚本：语法有效/)).toBeVisible();
    expect(document.querySelector(".script-workflow__notice")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(api.updateToolWorkflow).toHaveBeenCalledWith(projectId, connectionId, "sum",
      expect.objectContaining({ revision: 1, before: expect.objectContaining({ enabled: true }) })));
    expect(await screen.findByText("脚本配置已保存")).toBeVisible();
  });

  it("keeps environment management out of the Tool script editor", async () => {
    const api = client();
    render(<><AppToaster /><ScriptWorkflowView api={api} projectId={projectId} connectionId={connectionId} toolName="sum" argumentsValue={{ a: 1 }} /></>);

    await screen.findByText("前置脚本");
    expect(screen.queryByRole("heading", { name: "环境变量" })).not.toBeInTheDocument();
    expect(api.listEnvironmentVariables).not.toHaveBeenCalled();
  });

  it("keeps a collapsed example library at the bottom and applies a preset to its matching phase", async () => {
    const user = userEvent.setup();
    render(<><AppToaster /><ScriptWorkflowView api={client()} projectId={projectId} connectionId={connectionId}
      toolName="sum" argumentsValue={{ a: 1 }} /></>);

    await screen.findByText("前置脚本");
    const library = screen.getByText("样例脚本").closest("details");
    expect(library).toHaveClass("script-examples");
    expect(library).not.toHaveAttribute("open");
    expect(library?.querySelector(".script-disclosure-icon")).toBeInTheDocument();

    const sdkReference = screen.getByText("脚本 SDK 与调试参考").closest("details");
    expect(sdkReference?.querySelector(".script-disclosure-icon")).toBeInTheDocument();

    await user.click(screen.getByText("样例脚本"));
    expect(library).toHaveAttribute("open");
    expect(screen.getByText("设置与清理参数")).toBeVisible();
    expect(screen.getByText("调用辅助 Tool 并映射结果")).toBeVisible();
    expect(screen.getByText("读取 Server 环境变量")).toBeVisible();
    expect(screen.getByText("校验主 Tool 响应")).toBeVisible();
    expect(screen.getByText("保存响应值到项目变量")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "使用样例：设置与清理参数" }));
    expect((screen.getByLabelText("前置脚本源码") as HTMLTextAreaElement).value).toContain("ctx.arguments.set");
    expect(screen.getByRole("checkbox", { name: "已启用" })).toBeChecked();
    expect(await screen.findByText("样例已应用到前置脚本")).toBeVisible();
  });

  it("trial-runs a before script and can apply the resulting arguments without saving environment changes", async () => {
    const debugToolWorkflow = vi.fn().mockResolvedValue({
      phase: "before", arguments: { a: 9 }, variables: { temporary: true },
      stagedEnvironment: [{ scope: "server", name: "candidate", value: 9, secret: false }],
      logs: [{ level: "info", message: "prepared", line: 2, column: 3 }],
    });
    const onApplyArguments = vi.fn();
    const api = client({ debugToolWorkflow }); const user = userEvent.setup();
    render(<><AppToaster /><ScriptWorkflowView api={api} projectId={projectId} connectionId={connectionId} toolName="sum"
      argumentsValue={{ a: 1 }} onApplyArguments={onApplyArguments} /></>);

    await screen.findByText("前置脚本");
    fireEvent.change(screen.getByLabelText("前置脚本源码"), {
      target: { value: "export default function before(ctx) { ctx.arguments.set('a', 9); }" },
    });
    await user.click(screen.getAllByRole("button", { name: /试运行/ })[0]!);

    await waitFor(() => expect(debugToolWorkflow).toHaveBeenCalledWith(projectId, connectionId, "sum", {
      phase: "before", source: expect.stringContaining("ctx.arguments.set"), arguments: { a: 1 },
      response: null, timeoutMs: 5_000, allowDestructiveHelpers: false,
    }, expect.any(AbortSignal)));
    expect(await screen.findByText("prepared")).toBeVisible();
    expect(screen.getByText(/环境变量修改未提交/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "应用参数" }));
    expect(onApplyArguments).toHaveBeenCalledWith({ a: 9 });
  });

  it("confirms helper Tool trial runs with an actionable toast instead of a browser dialog", async () => {
    const debugToolWorkflow = vi.fn().mockResolvedValue({
      phase: "before", arguments: {}, variables: {}, stagedEnvironment: [], logs: [],
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => {
      throw new Error("window.confirm must not be used");
    });
    const api = client({ debugToolWorkflow }); const user = userEvent.setup();
    render(<><AppToaster /><ScriptWorkflowView api={api} projectId={projectId} connectionId={connectionId} toolName="sum" argumentsValue={{ a: 1 }} /></>);

    await screen.findByText("前置脚本");
    fireEvent.change(screen.getByLabelText("前置脚本源码"), {
      target: { value: "export default async function before(ctx) { await ctx.tools.call({ server: 'current', name: 'lookup', arguments: {} }); }" },
    });
    await user.click(screen.getAllByRole("button", { name: /试运行/ })[0]!);

    const message = await screen.findByText("脚本会调用辅助 Tool，其中可能包含有副作用的操作。");
    const helperToast = message.closest("[data-sonner-toast]");
    expect(helperToast).toHaveClass("app-toast");
    expect(helperToast).toHaveTextContent("是否允许本次试运行调用破坏性辅助 Tool？");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(debugToolWorkflow).not.toHaveBeenCalled();

    const allowButton = screen.getByRole("button", { name: "允许试运行" });
    fireEvent.click(allowButton);
    await waitFor(() => expect(debugToolWorkflow).toHaveBeenCalledWith(projectId, connectionId, "sum", {
      phase: "before", source: expect.stringContaining("ctx.tools.call"), arguments: { a: 1 },
      response: null, timeoutMs: 5_000, allowDestructiveHelpers: true,
    }, expect.any(AbortSignal)));
    await waitFor(() => expect(message.closest("[data-sonner-toast]" )).not.toBeInTheDocument());
  });

  it("rejects invalid manual after-response JSON before starting a trial run", async () => {
    const debugToolWorkflow = vi.fn(); const api = client({ debugToolWorkflow }); const user = userEvent.setup();
    render(<><AppToaster /><ScriptWorkflowView api={api} projectId={projectId} connectionId={connectionId} toolName="sum" argumentsValue={{}} /></>);
    await screen.findByText("后置脚本");
    fireEvent.change(screen.getByLabelText("后置脚本源码"), { target: { value: "export default function after() {}" } });
    fireEvent.change(screen.getByLabelText("后置脚本调试响应 JSON"), { target: { value: "{" } });
    await user.click(screen.getAllByRole("button", { name: /试运行/ })[1]!);
    const error = await screen.findByText("后置脚本调试响应必须是有效 JSON");
    expect(error.closest("[data-sonner-toast]")).toHaveAttribute("data-type", "error");
    expect(debugToolWorkflow).not.toHaveBeenCalled();
  });
});
