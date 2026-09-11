// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient } from "../../../api/api-client.js";
import { RunHistoryPage } from "../RunHistoryPage.js";
import "../../../i18n/index.js";

const projectId = "00000000-0000-4000-8000-000000000851";

describe("RunHistoryPage", () => {
  afterEach(cleanup);

  it("applies and resets exact project history filters without selecting or opening a Run", async () => {
    const runId = "00000000-0000-4000-8000-000000000852";
    const listRuns = vi.fn(async () => ({ runs: [], nextCursor: null }));
    const api = { listRuns, setRunPinned: vi.fn() } as unknown as InspectorApiClient;
    const onOpenDebug = vi.fn();
    render(<RunHistoryPage api={api} projectId={projectId} onOpenDebug={onOpenDebug} />);
    await waitFor(() => expect(listRuns).toHaveBeenCalledWith(projectId, undefined, {}));

    fireEvent.change(screen.getByLabelText("Tool 名称"), { target: { value: "sum" } });
    fireEvent.change(screen.getByLabelText("调用 ID"), { target: { value: runId } });
    fireEvent.change(screen.getByLabelText("状态"), { target: { value: "failed" } });
    fireEvent.change(screen.getByLabelText("来源"), { target: { value: "REPLAY" } });
    fireEvent.change(screen.getByLabelText("调用来源"), { target: { value: "AUTHORING_STANDALONE" } });
    fireEvent.change(screen.getByLabelText("固定状态"), { target: { value: "true" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith(projectId, undefined, {
      runId, toolName: "sum", status: "failed", origin: "REPLAY", source: "AUTHORING_STANDALONE", pinned: true,
    }));
    expect(onOpenDebug).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith(projectId, undefined, {}));
  });

  it("rejects an invalid call ID before requesting a filtered page", async () => {
    const listRuns = vi.fn(async () => ({ runs: [], nextCursor: null }));
    render(<RunHistoryPage api={{ listRuns, setRunPinned: vi.fn() } as unknown as InspectorApiClient}
      projectId={projectId} onOpenDebug={vi.fn()} />);
    await waitFor(() => expect(listRuns).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("调用 ID"), { target: { value: "not-a-uuid" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请输入有效的调用 ID");
    expect(listRuns).toHaveBeenCalledTimes(1);
  });

  it("explains every Run filter from the filter heading help", async () => {
    const listRuns = vi.fn(async () => ({ runs: [], nextCursor: null }));
    render(<RunHistoryPage api={{ listRuns, setRunPinned: vi.fn() } as unknown as InspectorApiClient}
      projectId={projectId} onOpenDebug={vi.fn()} />);
    await waitFor(() => expect(listRuns).toHaveBeenCalled());

    for (const label of ["Tool 名称", "调用 ID", "开始时间", "结束时间"]) {
      expect(screen.getByLabelText(label)).toHaveClass("ui-input");
    }
    expect(screen.getByRole("button", { name: "了解运行历史" }).closest(".history-page__heading-actions")).not.toBeNull();
    expect(screen.getByRole("button", { name: "了解运行筛选" }).closest(".history-filters__heading")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "了解运行筛选" }));
    const help = screen.getByRole("dialog", { name: "筛选项说明" });
    expect(help).toHaveTextContent("Tool 名称");
    expect(help).toHaveTextContent("调用 ID");
    expect(help).toHaveTextContent("状态");
    expect(help).toHaveTextContent("来源");
    expect(help).toHaveTextContent("调用来源");
    expect(help).toHaveTextContent("Agent");
    expect(help).toHaveTextContent("固定状态");
    expect(help).toHaveTextContent("开始与结束时间");
  });

  it("searches again when the applied filters have not changed", async () => {
    const listRuns = vi.fn(async () => ({ runs: [], nextCursor: null }));
    render(<RunHistoryPage api={{ listRuns, setRunPinned: vi.fn() } as unknown as InspectorApiClient}
      projectId={projectId} onOpenDebug={vi.fn()} />);
    await waitFor(() => expect(listRuns).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => expect(listRuns).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => expect(listRuns).toHaveBeenCalledTimes(3));
  });

  it("keeps auto refresh off by default and reruns the search only at a selected 3s or 5s interval", async () => {
    vi.useFakeTimers();
    try {
      const listRuns = vi.fn(async () => ({ runs: [], nextCursor: null }));
      render(<RunHistoryPage api={{ listRuns, setRunPinned: vi.fn() } as unknown as InspectorApiClient}
        projectId={projectId} onOpenDebug={vi.fn()} />);
      await act(async () => { await Promise.resolve(); });
      expect(listRuns).toHaveBeenCalledTimes(1);

      const refresh = screen.getByRole("combobox", { name: "定时刷新" });
      expect(refresh).toHaveValue("0");
      expect(screen.getAllByRole("option").filter((option) => ["关闭", "3s", "5s"].includes(option.textContent ?? ""))
        .map((option) => option.textContent)).toEqual(["关闭", "3s", "5s"]);
      await act(async () => { vi.advanceTimersByTime(5_000); await Promise.resolve(); });
      expect(listRuns).toHaveBeenCalledTimes(1);

      fireEvent.change(refresh, { target: { value: "3" } });
      await act(async () => { vi.advanceTimersByTime(3_000); await Promise.resolve(); });
      expect(listRuns).toHaveBeenCalledTimes(2);
      fireEvent.change(refresh, { target: { value: "5" } });
      await act(async () => { vi.advanceTimersByTime(5_000); await Promise.resolve(); });
      expect(listRuns).toHaveBeenCalledTimes(3);
      fireEvent.change(refresh, { target: { value: "0" } });
      await act(async () => { vi.advanceTimersByTime(10_000); await Promise.resolve(); });
      expect(listRuns).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
