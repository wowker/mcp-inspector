// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient } from "../../../api/api-client.js";
import { RunHistoryPage } from "../RunHistoryPage.js";
import "../../../i18n/index.js";

const projectId = "00000000-0000-4000-8000-000000000851";

describe("RunHistoryPage", () => {
  afterEach(cleanup);

  it("applies and resets exact project history filters without selecting or opening a Run", async () => {
    const listRuns = vi.fn(async () => ({ runs: [], nextCursor: null }));
    const api = { listRuns, setRunPinned: vi.fn() } as unknown as InspectorApiClient;
    const onOpenDebug = vi.fn();
    render(<RunHistoryPage api={api} projectId={projectId} onOpenDebug={onOpenDebug} />);
    await waitFor(() => expect(listRuns).toHaveBeenCalledWith(projectId, undefined, {}));

    fireEvent.change(screen.getByLabelText("Tool 名称"), { target: { value: "sum" } });
    fireEvent.change(screen.getByLabelText("状态"), { target: { value: "failed" } });
    fireEvent.change(screen.getByLabelText("来源"), { target: { value: "REPLAY" } });
    fireEvent.change(screen.getByLabelText("固定状态"), { target: { value: "true" } });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith(projectId, undefined, {
      toolName: "sum", status: "failed", origin: "REPLAY", pinned: true,
    }));
    expect(onOpenDebug).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith(projectId, undefined, {}));
  });

  it("rejects an invalid connection ID before requesting a filtered page", async () => {
    const listRuns = vi.fn(async () => ({ runs: [], nextCursor: null }));
    render(<RunHistoryPage api={{ listRuns, setRunPinned: vi.fn() } as unknown as InspectorApiClient}
      projectId={projectId} onOpenDebug={vi.fn()} />);
    await waitFor(() => expect(listRuns).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("连接 ID"), { target: { value: "not-a-uuid" } });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请输入有效的连接 ID");
    expect(listRuns).toHaveBeenCalledTimes(1);
  });
});
