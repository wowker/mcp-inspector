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

  it("restores a nonterminal lastRunId as the active execution gate after reload", async () => {
    const running = { ...detail(), status: "running" as const, completedAt: null, durationMs: null, response: null };
    let streamSignal: AbortSignal | undefined;
    const client = api({ listTabs: vi.fn(async () => [{ ...tab, lastRunId: runId }]), getRun: vi.fn(async () => running),
      openRunEventStream: vi.fn((_project, _run, _after, signal) => {
        streamSignal = signal; return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      }) });
    const view = render(<DebugWorkspace api={client} projectId={projectId} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "执行中…" })).toBeDisabled());
    expect(client.openRunEventStream).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText("a"), { key: "Enter", ctrlKey: true }); expect(client.startRun).not.toHaveBeenCalled();
    view.unmount(); expect(streamSignal?.aborted).toBe(true);
  });

  it("uses one SSE only for the selected active Run and promotes a background observer after selection changes", async () => {
    const secondTabId = "00000000-0000-4000-8000-000000000851"; const secondRunId = "00000000-0000-4000-8000-000000000852";
    const firstTab = { ...tab, lastRunId: runId }; const secondTab = { ...tab, id: secondTabId, title: "sum (2)", position: 1, lastRunId: secondRunId };
    const signals = new Map<string, AbortSignal>();
    const client = api({ listTabs: vi.fn(async () => [firstTab, secondTab]),
      getRun: vi.fn(async (_project, id) => ({ ...detail(id === runId ? tabId : secondTabId), id, tabId: id === runId ? tabId : secondTabId,
        status: "running" as const, completedAt: null, durationMs: null, response: null })),
      openRunEventStream: vi.fn((_project, id, _after, signal) => { signals.set(id, signal);
        return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })); }),
      closeTab: vi.fn(async () => undefined) });
    render(<DebugWorkspace api={client} projectId={projectId} />);
    await waitFor(() => expect(client.openRunEventStream).toHaveBeenCalledTimes(1));
    expect(signals.get(runId)?.aborted).toBe(false); expect(signals.has(secondRunId)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "关闭 sum" }));
    await waitFor(() => expect(signals.get(runId)?.aborted).toBe(true));
    await waitFor(() => expect(client.openRunEventStream).toHaveBeenCalledTimes(2));
    expect(signals.get(secondRunId)?.aborted).toBe(false);
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
    const historyTabs = screen.getAllByRole("tab", { name: /只读 · sum/ }); historyTabs[0]!.focus();
    fireEvent.keyDown(historyTabs[0]!, { key: "End" }); expect(historyTabs[1]).toHaveFocus();
    await waitFor(() => expect(historyTabs[1]).toHaveAttribute("aria-selected", "true"));
  });

  it("keeps the launched Run gate when inspecting an older terminal Run while another Tab remains executable", async () => {
    const secondTabId = "00000000-0000-4000-8000-000000000847";
    const liveRunId = "00000000-0000-4000-8000-000000000848"; const secondRunId = "00000000-0000-4000-8000-000000000849";
    const secondTab = { ...tab, id: secondTabId, title: "sum (2)", position: 1 };
    const liveSummary = { ...summary, id: liveRunId, idempotencyKey: "live" };
    const liveDetail = { ...detail(), ...liveSummary, status: "running" as const, completedAt: null, durationMs: null, response: null };
    const oldSummary = { ...summary, id: runId, idempotencyKey: "old" };
    const startRun = vi.fn(async (_project: string, owner: string) => owner === tabId ? liveSummary : { ...summary, id: secondRunId, tabId: secondTabId, idempotencyKey: "second" });
    const openRunEventStream = vi.fn((_project: string, _run: string, _after: number, signal: AbortSignal) =>
      new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })));
    const client = api({ listTabs: vi.fn(async () => [tab, secondTab]), startRun,
      updateTab: vi.fn(async (_project, id, patch) => ({ ...([tab, secondTab].find((item) => item.id === id)!), ...patch })),
      getRun: vi.fn(async (_project, id) => id === liveRunId ? liveDetail : { ...detail(), id }), openRunEventStream,
      listRuns: vi.fn(async () => ({ runs: [oldSummary], nextCursor: null })) });
    render(<DebugWorkspace api={client} projectId={projectId} />); await screen.findByLabelText("a");
    fireEvent.click(screen.getByRole("button", { name: "执行" })); await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "执行中…" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "当前 Tab 历史" }));
    fireEvent.click(await screen.findByRole("button", { name: `打开运行 ${runId}` })); await screen.findByText(/"answer": 2/);
    fireEvent.keyDown(screen.getByLabelText("a"), { key: "Enter", ctrlKey: true });
    expect(startRun).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("tab", { name: "sum (2)" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "sum (2)" })).toHaveAttribute("aria-selected", "true"));
    fireEvent.click(await screen.findByRole("button", { name: "执行" }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(2)); expect(startRun.mock.calls[1]?.[1]).toBe(secondTabId);
  });

  it("keeps observing an active Run while old history is inspected and clears its gate only when that active Run completes", async () => {
    const activeRunId = "00000000-0000-4000-8000-000000000850";
    const activeSummary = { ...summary, id: activeRunId, idempotencyKey: "active", status: "running" as const };
    const running = { ...detail(), ...activeSummary, completedAt: null, durationMs: null, response: null };
    const completed = { ...detail(), ...activeSummary, status: "succeeded" as const };
    let terminal = false; let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    const client = api({ listTabs: vi.fn(async () => [{ ...tab, lastRunId: activeRunId }]),
      getRun: vi.fn(async (_project, id) => id === activeRunId ? (terminal ? completed : running) : detail()),
      openRunEventStream: vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } }))),
      listRuns: vi.fn(async () => ({ runs: [summary], nextCursor: null })) });
    render(<DebugWorkspace api={client} projectId={projectId} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "执行中…" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "当前 Tab 历史" }));
    fireEvent.click(await screen.findByRole("button", { name: `打开运行 ${runId}` })); await screen.findByText(/"answer": 2/);
    expect(screen.getByRole("button", { name: "执行中…" })).toBeDisabled();
    terminal = true; streamController!.enqueue(encoder.encode(`data: ${JSON.stringify({ runId: activeRunId, sequence: 9, kind: "run-status",
      occurredAt: "2026-08-17T00:00:01.000Z", payload: { status: "succeeded" } })}\n\n`));
    await waitFor(() => expect(screen.getByRole("button", { name: "执行" })).toBeEnabled());
    expect(client.startRun).not.toHaveBeenCalled();
  });
});
