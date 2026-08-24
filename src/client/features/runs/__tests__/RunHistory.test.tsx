// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient, RunSummary } from "../../../api/api-client.js";
import { RunHistory } from "../RunHistory.js";

const projectId = "00000000-0000-4000-8000-000000000811";
function item(id: string, createdAt: string, tabId: string | null): RunSummary {
  return { id, projectId, connectionId: "00000000-0000-4000-8000-000000000812", tabId, toolName: "sum",
    toolSnapshotId: "00000000-0000-4000-8000-000000000813", idempotencyKey: id, status: "succeeded",
    createdAt, startedAt: createdAt, completedAt: createdAt, durationMs: 12, networkDurationMs: 8 };
}

describe("RunHistory", () => {
  afterEach(() => cleanup());

  it("keeps newest-first pagination and filters current-Tab history", async () => {
    const tabId = "00000000-0000-4000-8000-000000000814";
    const newest = item("00000000-0000-4000-8000-000000000815", "2026-08-17T00:00:02.000Z", tabId);
    const other = item("00000000-0000-4000-8000-000000000816", "2026-08-17T00:00:01.000Z", null);
    const older = item("00000000-0000-4000-8000-000000000817", "2026-08-17T00:00:00.000Z", tabId);
    const listRuns = vi.fn(async (_project: string, cursor?: string) => cursor === undefined
      ? { runs: [newest, other], nextCursor: "next" } : { runs: [older], nextCursor: null });
    render(<RunHistory api={{ listRuns } as unknown as InspectorApiClient} projectId={projectId} tabId={tabId} onOpen={vi.fn()} />);
    expect(await screen.findByText(newest.id)).toBeVisible();
    expect(screen.queryByText(other.id)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByText(older.id)).toBeVisible();
    expect(screen.getAllByRole("button", { name: /打开运行/ }).map((button) => button.getAttribute("aria-label"))).toEqual([
      `打开运行 ${newest.id}`, `打开运行 ${older.id}`,
    ]);
  });

  it("fences a stale project response", async () => {
    let resolve!: (value: { runs: RunSummary[]; nextCursor: null }) => void;
    const stale = new Promise<{ runs: RunSummary[]; nextCursor: null }>((done) => { resolve = done; });
    const api = { listRuns: vi.fn((project: string) => project === projectId ? stale : Promise.resolve({ runs: [], nextCursor: null })) } as unknown as InspectorApiClient;
    const view = render(<RunHistory api={api} projectId={projectId} onOpen={vi.fn()} />);
    view.rerender(<RunHistory api={api} projectId="00000000-0000-4000-8000-000000000899" onOpen={vi.fn()} />);
    resolve({ runs: [item("00000000-0000-4000-8000-000000000818", "2026-08-17T00:00:00.000Z", null)], nextCursor: null });
    await waitFor(() => expect(screen.queryByText("00000000-0000-4000-8000-000000000818")).not.toBeInTheDocument());
  });
});
