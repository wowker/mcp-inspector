// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunDetail } from "../../../api/api-client.js";
import { RunResultPanel } from "../RunResultPanel.js";

const run: RunDetail = {
  id: "00000000-0000-4000-8000-000000000801", projectId: "00000000-0000-4000-8000-000000000802",
  connectionId: "00000000-0000-4000-8000-000000000803", tabId: null, toolName: "inspect",
  toolSnapshotId: "00000000-0000-4000-8000-000000000804", toolSnapshotHash: "a".repeat(64),
  idempotencyKey: "once", status: "succeeded", createdAt: "2026-08-17T00:00:00.000Z",
  startedAt: "2026-08-17T00:00:00.010Z", completedAt: "2026-08-17T00:00:00.050Z",
  durationMs: 40, networkDurationMs: 25, protocolVersion: "2025-06-18",
  serverInfo: { name: "fixture", version: "1" }, clientInfo: { name: "DSers MCP Inspector", version: "0.1" },
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
  afterEach(() => cleanup());

  it("renders hostile text and embedded resources inertly in server order", () => {
    render(<RunResultPanel run={run} />);
    expect(screen.getByText(/"answer": 5/)).toBeInTheDocument();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(screen.getByText("safe resource")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector('a[href="https://evil.test/never-fetch"]')).toBeNull();
    expect(screen.getByText(/audio\/wav/)).toBeInTheDocument();
  });

  it("shows the immutable request needed to reproduce the historical call", () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<RunResultPanel run={{ ...run, request: { arguments: { value: 5 }, jsonrpc: { jsonrpc: "2.0", method: "tools/call", params: { name: "inspect" } },
      http: { method: "POST", url: "https://example.test/mcp", headers: { authorization: "Bearer secret", accept: "application/json" }, body: { safe: true } } } }} />);
    expect(screen.getByRole("heading", { name: "不可变历史请求" })).toBeVisible();
    expect(screen.getByText(/"value": 5/)).toBeVisible(); expect(screen.getByText(/"name": "inspect"/)).toBeVisible();
    expect(screen.getAllByText(/\[REDACTED\]/).length).toBeGreaterThan(0); expect(screen.queryByText(/Bearer secret/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制 arguments" }));
    return screen.findByRole("alert").then((alert) => expect(alert).toHaveTextContent("复制失败"));
  });

  it("filters RPC, groups HTTP with redacted headers, and orders the timeline", () => {
    render(<RunResultPanel run={run} />);
    fireEvent.click(screen.getByRole("tab", { name: "RPC" }));
    expect(screen.getAllByText(/tools\/call/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/example\.test/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "HTTP" }));
    expect(screen.getByText(/POST https:\/\/example\.test\/mcp/)).toBeInTheDocument();
    expect(screen.getByText(/\[REDACTED\]/)).toBeInTheDocument();
    expect(screen.queryByText(/Bearer secret/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "时间线" }));
    expect(screen.getAllByTestId("timeline-sequence").map((node) => node.textContent)).toEqual(["#2", "#3", "#4", "#5"]);
  });

  it("links every result tabpanel back to its selected tab", () => {
    render(<RunResultPanel run={run} />); const tab = screen.getByRole("tab", { name: "格式化结果" });
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tab.id);
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
