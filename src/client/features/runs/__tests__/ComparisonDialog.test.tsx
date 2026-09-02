// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunComparison } from "../../../../shared/run-comparison.js";
import type { InspectorApiClient } from "../../../api/api-client.js";
import { i18n } from "../../../i18n/index.js";
import { ComparisonDialog } from "../ComparisonDialog.js";

const projectId = "00000000-0000-4000-8000-000000001561";
const replayRunId = "00000000-0000-4000-8000-000000001562";
const sourceRunId = "00000000-0000-4000-8000-000000001563";

function comparison(ruleExpressions = ['$["requestId"]']): RunComparison {
  const metadata = (id: string) => ({
    id, connectionId: "00000000-0000-4000-8000-000000001564", toolName: "sum",
    toolSnapshotId: "00000000-0000-4000-8000-000000001565", status: "succeeded" as const,
    error: null, truncated: false, originalBytes: 100,
  });
  return {
    projectId, replayRunId, sourceRunId, comparable: true, unavailableReason: null,
    source: metadata(sourceRunId), replay: metadata(replayRunId), ruleExpressions,
    diff: { truncated: false, visitedNodes: 4, serializedBytes: 100, changes: [
      { path: "/requestId", kind: "CHANGED", source: "old", replay: "new", ignored: true },
      { path: "/value", kind: "CHANGED", source: 1, replay: 2, ignored: false },
    ] },
  };
}

function api(overrides: Partial<InspectorApiClient> = {}): InspectorApiClient {
  return {
    getRunComparison: vi.fn().mockResolvedValue(comparison()),
    replaceComparisonRules: vi.fn().mockResolvedValue({ rules: [] }),
    ...overrides,
  } as InspectorApiClient;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("ComparisonDialog", () => {
  it("separates material and ignored changes and previews then saves the complete rule set", async () => {
    const client = api();
    const user = userEvent.setup();
    render(<ComparisonDialog api={client} projectId={projectId} replayRunId={replayRunId} onClose={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: /有效变化/ })).toBeVisible();
    expect(screen.getByRole("heading", { name: /已忽略变化/ })).toBeVisible();
    expect(screen.getByText("/value")).toBeVisible();
    expect(screen.getByText("/requestId")).toBeVisible();

    const rules = screen.getByRole("textbox", { name: "项目对比忽略规则" });
    fireEvent.change(rules, { target: { value: "$.rows[*].updatedAt" } });
    vi.mocked(client.getRunComparison).mockResolvedValueOnce(comparison(['$["rows"][*]["updatedAt"]']));
    await user.click(screen.getByRole("button", { name: "预览" }));
    await waitFor(() => expect(client.getRunComparison).toHaveBeenLastCalledWith(
      projectId, replayRunId, ["$.rows[*].updatedAt"],
    ));
    await waitFor(() => expect(rules).toHaveValue('$["rows"][*]["updatedAt"]'));

    vi.mocked(client.getRunComparison).mockResolvedValueOnce(comparison(['$["rows"][*]["updatedAt"]']));
    await user.click(screen.getByRole("button", { name: "保存规则" }));
    await waitFor(() => expect(client.replaceComparisonRules).toHaveBeenCalledWith(
      projectId, ['$["rows"][*]["updatedAt"]'],
    ));
  });

  it("fences a late response after the dialog scope changes", async () => {
    const old = deferred<RunComparison>();
    const nextProjectId = "00000000-0000-4000-8000-000000001569";
    const client = api({ getRunComparison: vi.fn()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValueOnce({ ...comparison([]), projectId: nextProjectId, comparable: false,
        unavailableReason: "NOT_DIRECT_REPLAY", sourceRunId: null, source: null, diff: null }) });
    const { rerender } = render(<ComparisonDialog api={client} projectId={projectId} replayRunId={replayRunId} onClose={vi.fn()} />);
    rerender(<ComparisonDialog api={client} projectId={nextProjectId} replayRunId={replayRunId} onClose={vi.fn()} />);
    expect(await screen.findByText("该 Run 不是可追溯到直接来源的回放 Run。")).toBeVisible();
    old.resolve(comparison());
    await Promise.resolve();
    expect(screen.queryByText("/value")).not.toBeInTheDocument();
  });
});
