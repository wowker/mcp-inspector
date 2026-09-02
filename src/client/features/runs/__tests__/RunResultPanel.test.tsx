// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunDetail, WorkflowExecutionDetail } from "../../../api/api-client.js";
import { AppToaster } from "../../../app/AppToaster.js";
import { EmptyRunResultPanel, RunResultPanel } from "../RunResultPanel.js";
import { i18n } from "../../../i18n/index.js";

const run: RunDetail = {
  id: "00000000-0000-4000-8000-000000000801", projectId: "00000000-0000-4000-8000-000000000802",
  connectionId: "00000000-0000-4000-8000-000000000803", tabId: null, toolName: "inspect",
  toolSnapshotId: "00000000-0000-4000-8000-000000000804", toolSnapshotHash: "a".repeat(64),
  idempotencyKey: "once", status: "succeeded", createdAt: "2026-08-17T00:00:00.000Z",
  startedAt: "2026-08-17T00:00:00.010Z", completedAt: "2026-08-17T00:00:00.050Z",
  durationMs: 40, networkDurationMs: 25, pinned: false, replayedFromRunId: null,
  protocolVersion: "2025-06-18",
  serverInfo: { name: "fixture", version: "1" }, clientInfo: { name: "MCP Inspector", version: "0.1" },
  request: { arguments: { value: 5 }, jsonrpc: { jsonrpc: "2.0", id: 1, method: "tools/call" }, http: null },
  response: { result: { structuredContent: { answer: 5 }, content: [
    { type: "text", text: "<script>alert(1)</script>" },
    { type: "resource", resource: { uri: "https://evil.test/never-fetch", mimeType: "text/plain", text: "safe resource" } },
    { type: "audio", mimeType: "audio/wav", data: "AAAA" },
  ] }, error: null, truncated: false, originalBytes: 200 },
  events: [
    { runId: "00000000-0000-4000-8000-000000000801", sequence: 4, kind: "http-response", occurredAt: "2026-08-17T00:00:00.030Z", payload: { kind: "http-response", exchangeId: "x", status: 200, headers: { "set-cookie": "secret" }, body: { ok: true } } },
    { runId: "00000000-0000-4000-8000-000000000801", sequence: 2, kind: "rpc-out", occurredAt: "2026-08-17T00:00:00.015Z", payload: { kind: "rpc-out", message: { method: "tools/call" } } },
    { runId: "00000000-0000-4000-8000-000000000801", sequence: 3, kind: "http-request", occurredAt: "2026-08-17T00:00:00.020Z", payload: { kind: "http-request", exchangeId: "x", method: "POST", url: "https://example.test/mcp", headers: { authorization: "Bearer secret", accept: "application/json" }, body: {} } },
    { runId: "00000000-0000-4000-8000-000000000801", sequence: 5, kind: "rpc-in", occurredAt: "2026-08-17T00:00:00.040Z", payload: { kind: "rpc-in", message: { result: { ok: true } } } },
  ],
};

describe("RunResultPanel", () => {
  it("renders the run result workflow in English without changing the run identity", async () => {
    await i18n.changeLanguage("en-US");
    render(<RunResultPanel run={run} />);
    expect(screen.getByRole("tab", { name: "Request & response" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Succeeded")).toBeVisible();
    expect(screen.getByText("Request arguments")).toBeVisible();
    expect(screen.getByText("Response")).toBeVisible();
    expect(screen.getByLabelText(`Details for run ${run.id}`)).toBeVisible();
    await i18n.changeLanguage("zh-CN");
  });

  afterEach(() => cleanup());

  it("renders hostile text and embedded resources inertly in server order", () => {
    render(<RunResultPanel run={run} />);
    expect(screen.getByText(/^answer/)).toBeInTheDocument();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(screen.getByText("safe resource")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector('a[href="https://evil.test/never-fetch"]')).toBeNull();
    expect(screen.getByText(/audio\/wav/)).toBeInTheDocument();
  });

  it("offers source comparison only for a direct replay run", () => {
    const onCompare = vi.fn();
    const { rerender } = render(<RunResultPanel run={run} onCompare={onCompare} />);
    expect(screen.queryByRole("button", { name: "对比来源" })).not.toBeInTheDocument();

    const replay = { ...run, replayedFromRunId: "00000000-0000-4000-8000-000000000805" };
    rerender(<RunResultPanel run={replay} onCompare={onCompare} />);
    fireEvent.click(screen.getByRole("button", { name: "对比来源" }));
    expect(onCompare).toHaveBeenCalledWith(replay);
  });

  it("defaults to a compact request and result view with secondary details hidden", () => {
    render(<RunResultPanel run={run} />);
    expect(screen.getByRole("tab", { name: "请求与结果" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("请求参数").closest("details")).toHaveAttribute("open");
    expect(screen.getByText("请求结果").closest("details")).toHaveAttribute("open");
    expect(screen.queryByText("Run ID")).not.toBeInTheDocument();
    expect(screen.queryByText("完整 JSON-RPC")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "调用详情" }));
    expect(screen.getByText("Run ID")).toBeVisible();
    expect(screen.getByText(run.id)).toBeVisible();
  });

  it("explains Run ID and Tool snapshot hash from accessible help controls", () => {
    render(<RunResultPanel run={run} />);
    fireEvent.click(screen.getByRole("tab", { name: "调用详情" }));

    fireEvent.click(screen.getByRole("button", { name: "了解Run ID" }));
    expect(screen.getByText(/每次 Tool 调用的唯一标识/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "了解Tool 快照哈希" }));
    expect(screen.getByText(/SHA-256 指纹/)).toBeVisible();
  });

  it("uses the normal result structure before a Tool has been executed", () => {
    render(<EmptyRunResultPanel />);

    expect(screen.getByLabelText("尚未执行的运行结果")).toBeVisible();
    expect(screen.getByText("未执行")).toBeVisible();
    expect(screen.getByText("总耗时 —")).toBeVisible();
    expect(screen.getByText("请求参数")).toBeVisible();
    expect(screen.getByText("请求结果")).toBeVisible();
    expect(screen.queryByText("等待执行")).not.toBeInTheDocument();
    expect(screen.queryByText(/填写参数并执行 Tool/)).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "脚本流水线" })).not.toBeInTheDocument();
  });

  it("shows an empty workflow view only when a script is enabled", () => {
    render(<EmptyRunResultPanel workflowExecution={null} />);

    expect(screen.getByRole("tab", { name: "脚本流水线" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("脚本流水线 · 未执行")).toBeVisible();
    expect(screen.getByText(/前置脚本、主调用、后置脚本及脚本日志/)).toBeVisible();
  });

  it("shows a main Tool failure only in the request result view", () => {
    const failedRun: RunDetail = {
      ...run,
      status: "failed",
      response: {
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({ code: "VALIDATION_ERROR", message: "operation would not change the resource" }),
          }],
          isError: true,
        },
        error: null,
        truncated: false,
        originalBytes: 120,
      },
    };
    const workflowExecution: WorkflowExecutionDetail = {
      id: "00000000-0000-4000-8000-000000000811",
      projectId: run.projectId,
      connectionId: run.connectionId,
      tabId: null,
      toolName: run.toolName,
      toolSnapshotId: run.toolSnapshotId,
      idempotencyKey: "workflow-failure",
      status: "failed",
      initialArguments: { value: 5 },
      finalArguments: { value: 5 },
      workflowSnapshot: {
        projectId: run.projectId,
        connectionId: run.connectionId,
        toolName: run.toolName,
        revision: 1,
        before: { enabled: true, source: "export default async function before(ctx) {}" },
        after: { enabled: false, source: "" },
        timeoutMs: 5_000,
        createdAt: run.createdAt,
        updatedAt: run.createdAt,
      },
      response: {
        content: [{
          type: "text",
          text: JSON.stringify({ code: "VALIDATION_ERROR", message: "operation would not change the resource" }),
        }],
        isError: true,
      },
      error: { code: "WORKFLOW_FAILED", message: "Workflow execution failed" },
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationMs: run.durationMs,
      runs: [{ runId: run.id, phase: "main", ordinal: 0, sourceLine: null }],
      events: [],
    };

    render(<RunResultPanel run={failedRun} workflowExecution={workflowExecution} />);

    expect(screen.getByText("脚本流水线", { selector: "strong" })).toBeVisible();
    expect(screen.queryByText("脚本流水线 · failed")).not.toBeInTheDocument();
    expect(screen.queryByText("Workflow execution failed")).not.toBeInTheDocument();
    expect(screen.queryByText(/operation would not change the resource/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "请求与结果" }));
    expect(screen.getByText(/operation would not change the resource/)).toBeVisible();
    expect(screen.queryByText("Workflow execution failed")).not.toBeInTheDocument();
  });

  it("collapses request and result independently and places HTTP before RPC", () => {
    render(<RunResultPanel run={run} />);
    const request = screen.getByText("请求参数").closest("details")!;
    request.open = false;
    fireEvent(request, new Event("toggle"));
    expect(screen.queryByText(/^value/)).not.toBeInTheDocument();
    expect(screen.getByText(/^answer/)).toBeVisible();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "请求与结果", "调用详情", "HTTP", "RPC", "时间线",
    ]);
  });

  it("uses one collapsible JSON viewer for request and response data without a duplicate subtree", () => {
    render(<RunResultPanel run={{ ...run, request: { ...run.request, arguments: { account: { id: "acct-1", active: true } } },
      response: { ...run.response!, result: { structuredContent: { profile: { id: "acct-1", plan: "pro" } }, content: [
        { type: "text", text: "{\"items\":[{\"id\":1},{\"id\":2}]}" },
      ] } } }} />);

    expect(screen.queryByText("JSON 子树")).not.toBeInTheDocument();
    expect(screen.queryByText("JSON 文本")).not.toBeInTheDocument();
    expect(screen.queryByText("结构化内容")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".json-viewer")).toHaveLength(3);
    expect(screen.getAllByText(/acct-1/)).toHaveLength(2);
    expect(screen.getByText(/^items/)).toBeVisible();
    expect(screen.getAllByText(/^id/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole("button", { name: "收起 JSON" }).length).toBeGreaterThan(0);
  });

  it("shows duplicated structured and text JSON only once while preserving it in the raw disclosure", () => {
    const duplicate = { profile: { id: "acct-1", plan: "pro" } };
    render(<RunResultPanel run={{ ...run, response: { ...run.response!, result: {
      structuredContent: duplicate,
      content: [{ type: "text", text: JSON.stringify(duplicate) }],
    } } }} />);

    expect(screen.getAllByText(/acct-1/)).toHaveLength(1);
    const disclosure = screen.getByText("原始请求与响应").closest("details")!;
    disclosure.open = true;
    fireEvent(disclosure, new Event("toggle"));
    expect(screen.getByText("完整响应")).toBeVisible();
  });

  it("keeps immutable raw request material collapsed until requested", () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<RunResultPanel run={{ ...run, request: { arguments: { value: 5 }, jsonrpc: { jsonrpc: "2.0", method: "tools/call", params: { name: "inspect" } },
      http: { method: "POST", url: "https://example.test/mcp", headers: { authorization: "Bearer secret", accept: "application/json" }, body: { safe: true } } } }} />);
    expect(screen.getByText(/^value/)).toBeVisible();
    expect(screen.queryByText(/^name/)).not.toBeInTheDocument();
    const disclosure = screen.getByText("原始请求与响应").closest("details")!;
    disclosure.open = true;
    fireEvent(disclosure, new Event("toggle"));
    expect(screen.getByText(/^name/)).toBeVisible();
    expect(screen.getAllByText(/\[REDACTED\]/).length).toBeGreaterThan(0); expect(screen.queryByText(/Bearer secret/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制参数" }));
    return screen.findByRole("alert").then((alert) => expect(alert).toHaveTextContent("复制失败"));
  });

  it("filters RPC, groups HTTP with redacted headers, and orders the timeline", () => {
    render(<RunResultPanel run={run} />);
    fireEvent.click(screen.getByRole("tab", { name: "RPC" }));
    expect(screen.getAllByText(/tools\/call/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/example\.test/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "HTTP" }));
    expect(screen.getByText(/POST https:\/\/example\.test\/mcp/)).toBeInTheDocument();
    screen.getAllByRole("button", { name: "展开 JSON" }).forEach((button) => fireEvent.click(button));
    expect(screen.getAllByText(/\[REDACTED\]/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Bearer secret/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "时间线" }));
    expect(screen.getAllByTestId("timeline-sequence").map((node) => node.textContent)).toEqual(["#2", "#3", "#4", "#5"]);
    expect(screen.queryByRole("button", { name: "复制" })).not.toBeInTheDocument();
  });

  it("shows original HTTP authorization when this Run explicitly disables redaction", () => {
    render(<RunResultPanel run={{ ...run, redactSensitiveInfo: false }} />);

    fireEvent.click(screen.getByRole("tab", { name: "HTTP" }));
    screen.getAllByRole("button", { name: "展开 JSON" }).forEach((button) => fireEvent.click(button));
    expect(screen.getByText(/Bearer secret/)).toBeVisible();
    expect(screen.getByText(/set-cookie/)).toBeVisible();
    expect(screen.queryByText(/\[REDACTED\]/)).not.toBeInTheDocument();
  });

  it("links every result tabpanel back to its selected tab", () => {
    render(<RunResultPanel run={run} />); const tab = screen.getByRole("tab", { name: "请求与结果" });
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tab.id);
  });

  it("keeps run status, timing, actions, and result navigation in one sticky header", () => {
    render(<RunResultPanel run={run} />);
    const sticky = document.querySelector(".run-result__sticky-header");
    expect(sticky).toContainElement(screen.getByText("成功"));
    expect(sticky).toContainElement(screen.getByText("总耗时 40 ms"));
    expect(sticky).toContainElement(screen.getByText("网络耗时 25 ms"));
    expect(sticky).toContainElement(screen.getByRole("button", { name: "复制全部结果" }));
    expect(sticky).toContainElement(screen.getByRole("tab", { name: "请求与结果" }));
  });

  it("offers the immutable response to a save workflow", () => {
    const onSaveResponse = vi.fn(); render(<RunResultPanel run={run} onSaveResponse={onSaveResponse} />);
    fireEvent.click(screen.getByRole("button", { name: "保存响应" }));
    expect(onSaveResponse).toHaveBeenCalledWith(run.response);
  });

  it("places an Open Debug action immediately before Copy All Results", () => {
    const onOpenDebug = vi.fn();
    render(<RunResultPanel run={run} onOpenDebug={onOpenDebug} />);

    const openDebug = screen.getByRole("button", { name: "打开调试" });
    const copy = screen.getByRole("button", { name: "复制全部结果" });
    expect(openDebug.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(openDebug);

    expect(onOpenDebug).toHaveBeenCalledWith(run);
  });

  it("offers a Run as a test-case creation preview source", () => {
    const onCreateTest = vi.fn();
    render(<RunResultPanel run={run} onCreateTest={onCreateTest} />);
    fireEvent.click(screen.getByRole("button", { name: "创建测试用例" }));
    expect(onCreateTest).toHaveBeenCalledWith(run);
  });

  it("uses the same compact secondary-action treatment for every copy and save command", () => {
    render(<RunResultPanel run={run} onSaveResponse={vi.fn()} />);
    expect(screen.getByRole("button", { name: "保存响应" })).toHaveClass("run-result-action");
    expect(screen.getByRole("button", { name: "复制全部结果" })).toHaveClass("run-result-action");
    expect(screen.getByRole("button", { name: "复制参数" })).toHaveClass("run-result-action");
  });

  it("opens response JSON in a large formatted modal after the copy action", () => {
    render(<RunResultPanel run={run} />);

    const expand = screen.getByRole("button", { name: "放大查看" });
    const toolbar = expand.closest(".block-toolbar");
    expect(toolbar).not.toBeNull();
    const copy = within(toolbar as HTMLElement).getByRole("button", { name: "复制" });
    expect(copy.compareDocumentPosition(expand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(expand);
    const dialog = screen.getByRole("dialog", { name: "结构化响应" });
    expect(dialog).toHaveClass("json-inspector-dialog");
    expect(within(dialog).getByLabelText("结构化响应 JSON")).toBeVisible();
    expect(within(dialog).getAllByRole("treeitem", { name: /answer:5/ }).at(-1)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "关闭 JSON 查看器" })).toHaveFocus();
  });

  it("copies formatted JSON from the modal action immediately before Close", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<><AppToaster /><RunResultPanel run={run} /></>);

    fireEvent.click(screen.getByRole("button", { name: "放大查看" }));
    const dialog = screen.getByRole("dialog", { name: "结构化响应" });
    const copy = within(dialog).getByRole("button", { name: "复制" });
    const close = within(dialog).getByRole("button", { name: "关闭 JSON 查看器" });
    expect(copy.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('{\n  "answer": 5\n}'));
    const copied = await screen.findByText("JSON 已复制");
    expect(copied.closest("[data-sonner-toast]")).toHaveClass("app-toast");

    fireEvent.click(close);
    fireEvent.click(screen.getByRole("button", { name: "放大查看" }));
    expect(screen.getByText("JSON 已复制")).toBeVisible();
  });

  it("closes the formatted JSON modal with Escape", () => {
    render(<RunResultPanel run={run} />);
    const expand = screen.getByRole("button", { name: "放大查看" });
    fireEvent.click(expand);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "结构化响应" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "结构化响应" })).not.toBeInTheDocument();
    expect(expand).toHaveFocus();
  });

  it("labels truncated output and surfaces clipboard failures", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<RunResultPanel run={{ ...run, response: { ...run.response!, truncated: true, originalBytes: 12345 } }} />);
    expect(screen.getByRole("status")).toHaveTextContent("已截断");
    fireEvent.click(screen.getByRole("button", { name: "复制全部结果" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("复制失败");
  });

  it("creates and revokes Blob URLs only for supported image MIME types", async () => {
    const create = vi.fn().mockReturnValueOnce("blob:image-1").mockReturnValueOnce("blob:image-2"); const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const view = render(<RunResultPanel run={{ ...run, response: { result: { content: [
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
      { type: "image", mimeType: "image/svg+xml", data: "PHN2Zz4=" },
    ] }, error: null, truncated: false, originalBytes: 20 } }} />);
    expect(await screen.findByRole("img", { name: "MCP 返回图片" })).toHaveAttribute("src", "blob:image-1");
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/image\/svg\+xml/)).toBeInTheDocument();
    view.rerender(<RunResultPanel run={{ ...run, response: { result: { content: [
      { type: "image", mimeType: "image/jpeg", data: "/9j/4AAQSkZJRg==" },
    ] }, error: null, truncated: false, originalBytes: 14 } }} />);
    expect(await screen.findByRole("img", { name: "MCP 返回图片" })).toHaveAttribute("src", "blob:image-2");
    expect(revoke).toHaveBeenCalledWith("blob:image-1");
    view.unmount(); await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:image-2"));
  });
});
