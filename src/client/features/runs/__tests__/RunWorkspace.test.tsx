// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DebugTabSummary, InspectorApiClient, RunDetail, RunSummary, ToolDetailSummary } from "../../../api/api-client.js";
import { DebugWorkspace } from "../../tabs/DebugWorkspace.js";

const projectId = "00000000-0000-4000-8000-000000000841"; const connectionId = "00000000-0000-4000-8000-000000000842";
const tabId = "00000000-0000-4000-8000-000000000843"; const runId = "00000000-0000-4000-8000-000000000844";
const tab: DebugTabSummary = { id: tabId, projectId, connectionId, toolName: "sum", title: "sum", position: 0, pinned: false,
  inputMode: "form", arguments: { a: 1 }, rawText: '{\n  "a": 1\n}', viewState: { editorScrollTop: 0, resultScrollTop: 0, splitRatio: 0.5 }, lastRunId: null };
const tool: ToolDetailSummary = { tool: { projectId, connectionId, name: "sum", status: "current", updatedAt: "2026-08-17T00:00:00.000Z",
  currentSnapshot: { id: "00000000-0000-4000-8000-000000000845", projectId, connectionId, toolName: "sum", contentHash: "a".repeat(64),
    createdAt: "2026-08-17T00:00:00.000Z", definition: { name: "sum", inputSchema: { type: "object", properties: { a: { type: "number" } } } } } }, snapshots: [] };
const summary: RunSummary = { id: runId, projectId, connectionId, tabId, toolName: "sum", toolSnapshotId: tool.tool.currentSnapshot.id,
  idempotencyKey: "once", status: "queued", createdAt: "2026-08-17T00:00:00.000Z", startedAt: null, completedAt: null, durationMs: null, networkDurationMs: null };
function detail(owner: string | null = tabId): RunDetail { return { ...summary, tabId: owner, status: "succeeded", startedAt: "2026-08-17T00:00:00.000Z",
  completedAt: "2026-08-17T00:00:00.010Z", durationMs: 10, networkDurationMs: 5, toolSnapshotHash: "a".repeat(64), protocolVersion: "2025-06-18",
  serverInfo: { name: "fixture" }, clientInfo: { name: "Inspector" }, request: { arguments: { a: 2 }, jsonrpc: {}, http: null },
  response: { result: { structuredContent: { answer: 2 } }, error: null, truncated: false, originalBytes: 10 }, events: [] }; }
function api(overrides: Partial<InspectorApiClient> = {}): InspectorApiClient { return { listTabs: vi.fn(async () => [tab]), getTool: vi.fn(async () => tool),
  updateTab: vi.fn(async (_p, _id, patch) => ({ ...tab, ...patch })), startRun: vi.fn(async () => summary), getRun: vi.fn(async () => detail()),
  listRuns: vi.fn(async () => ({ runs: [], nextCursor: null })), openTab: vi.fn(), ...overrides } as unknown as InspectorApiClient; }

describe("Run workspace", () => {
  afterEach(() => cleanup());
  it("flushes the latest draft and hard-gates rapid execution to one POST", async () => {
    let resolveSave!: (value: DebugTabSummary) => void; const save = new Promise<DebugTabSummary>((resolve) => { resolveSave = resolve; });
    const client = api({ updateTab: vi.fn(() => save), startRun: vi.fn(async () => summary) });
    render(<DebugWorkspace api={client} projectId={projectId} />); fireEvent.change(await screen.findByLabelText("a"), { target: { value: "2" } });
    const execute = screen.getByRole("button", { name: "执行" }); fireEvent.click(execute); fireEvent.click(execute);
    expect(client.startRun).not.toHaveBeenCalled();
    await act(async () => { resolveSave({ ...tab, arguments: { a: 2 }, rawText: '{\n  "a": 2\n}' }); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(client.startRun).toHaveBeenCalledTimes(1));
    expect(client.startRun).toHaveBeenCalledWith(projectId, tabId, expect.any(String), { a: 2 });
  });

  it("restores lastRunId without starting another Run", async () => {
    const client = api({ listTabs: vi.fn(async () => [{ ...tab, lastRunId: runId }]) });
    render(<DebugWorkspace api={client} projectId={projectId} />);
    expect(await screen.findByText(/"answer": 2/)).toBeVisible(); expect(client.getRun).toHaveBeenCalledWith(projectId, runId);
    expect(client.startRun).not.toHaveBeenCalled();
  });

  it("uses the same single-POST path for Ctrl+Enter and recovers after a start error", async () => {
    const startRun = vi.fn().mockRejectedValueOnce(new Error("server unavailable")).mockResolvedValueOnce(summary);
    const client = api({ startRun }); render(<DebugWorkspace api={client} projectId={projectId} />);
    const editor = await screen.findByLabelText("a"); fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("server unavailable");
    await waitFor(() => expect(screen.getByRole("button", { name: "执行" })).toBeEnabled());
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(2));
    expect(startRun.mock.calls[0]?.slice(0, 2)).toEqual(startRun.mock.calls[1]?.slice(0, 2));
  });

  it("opens existing-Tab history without replacing its parameter draft", async () => {
    const client = api({ listRuns: vi.fn(async () => ({ runs: [summary], nextCursor: null })) });
    render(<DebugWorkspace api={client} projectId={projectId} />); const editor = await screen.findByLabelText("a");
    fireEvent.change(editor, { target: { value: "9" } }); fireEvent.click(screen.getByRole("button", { name: "当前 Tab 历史" }));
    fireEvent.click(await screen.findByRole("button", { name: `打开运行 ${runId}` }));
    expect(await screen.findByText(/"answer": 2/)).toBeVisible();
    expect(screen.getByLabelText("a")).toHaveValue(9); expect(client.startRun).not.toHaveBeenCalled();
  });

  it("opens a deleted-origin history Run as a non-persisted read-only Tab", async () => {
    const orphan = { ...summary, tabId: null }; const client = api({ listRuns: vi.fn(async () => ({ runs: [orphan], nextCursor: null })), getRun: vi.fn(async () => detail(null)) });
    render(<DebugWorkspace api={client} projectId={projectId} />); await screen.findByRole("tab", { name: "sum" });
    fireEvent.click(screen.getByRole("button", { name: "运行历史" })); fireEvent.click(await screen.findByRole("button", { name: `打开运行 ${runId}` }));
    expect(await screen.findByText("只读历史结果，不会重新调用 Tool。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "执行" })).not.toBeInTheDocument(); expect(client.openTab).not.toHaveBeenCalled(); expect(client.startRun).not.toHaveBeenCalled();
  });

  it("keeps multiple deleted-origin runs in separate read-only Tabs", async () => {
    const secondId = "00000000-0000-4000-8000-000000000846";
    const runs = [{ ...summary, tabId: null }, { ...summary, id: secondId, tabId: null, idempotencyKey: "two",
      createdAt: "2026-08-16T23:59:59.000Z" }];
    const client = api({ listRuns: vi.fn(async () => ({ runs, nextCursor: null })), getRun: vi.fn(async (_project, id) => ({ ...detail(null), id, idempotencyKey: id })) });
    render(<DebugWorkspace api={client} projectId={projectId} />); await screen.findByRole("tab", { name: "sum" });
    fireEvent.click(screen.getByRole("button", { name: "运行历史" }));
    fireEvent.click(await screen.findByRole("button", { name: `打开运行 ${runId}` })); await screen.findByText("只读历史结果，不会重新调用 Tool。");
    fireEvent.click(screen.getByRole("button", { name: "运行历史" }));
    fireEvent.click(await screen.findByRole("button", { name: `打开运行 ${secondId}` }));
    await waitFor(() => expect(screen.getAllByRole("tab", { name: /只读 · sum/ })).toHaveLength(2));
  });
});
