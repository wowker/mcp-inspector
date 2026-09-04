// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient, RunDetail } from "../../../api/api-client.js";
import { AppToaster } from "../../../app/AppToaster.js";
import { i18n } from "../../../i18n/index.js";
import { TestSuiteReportViewer } from "../TestSuiteReportViewer.js";

vi.mock("../../runs/RunResultPanel.js", () => ({
  RunResultPanel: ({ run }: { run: RunDetail }) => <div data-testid="run-result-panel">{run.id}</div>,
}));

const projectId = "00000000-0000-4000-8000-000000000101";
const suiteId = "00000000-0000-4000-8000-000000000102";
const executionId = "00000000-0000-4000-8000-000000000103";
const memberId = "00000000-0000-4000-8000-000000000104";
const testCaseId = "00000000-0000-4000-8000-000000000105";
const testExecutionId = "00000000-0000-4000-8000-000000000106";
const failedStepId = "00000000-0000-4000-8000-000000000107";
const passedStepId = "00000000-0000-4000-8000-000000000108";
const failedRunId = "00000000-0000-4000-8000-000000000109";
const passedRunId = "00000000-0000-4000-8000-000000000110";
const timestamp = "2026-09-04T00:00:00.000Z";

const suiteSnapshot = { id: suiteId, projectId, name: "订单回归", description: "", tags: [], revision: 3,
  members: [{ id: memberId, testCaseId, position: 0, isEnabled: true }],
  executionPolicy: { concurrency: 4, stopOnFailure: false }, createdAt: timestamp, updatedAt: timestamp };
const suiteExecution = { id: executionId, projectId, suiteId, suiteRevision: 3, status: "FAILED" as const,
  suiteSnapshot, summary: { total: 1, passed: 0, failed: 1, errors: 0, cancelled: 0 }, error: null,
  createdAt: timestamp, startedAt: timestamp, completedAt: timestamp, durationMs: 120,
  items: [{ id: memberId, suiteExecutionId: executionId, suiteMemberId: memberId, testCaseId,
    testExecutionId, position: 0, status: "FAILED" as const, error: null, createdAt: timestamp,
    startedAt: timestamp, completedAt: timestamp, durationMs: 120 }] };
const outline = { execution: suiteExecution, members: [{ item: suiteExecution.items[0], testExecution: {
  id: testExecutionId, testCaseId, testCaseRevision: 2, testCaseName: "创建订单", testCaseKind: "scenario" as const,
  status: "FAILED" as const, createdAt: timestamp, startedAt: timestamp, completedAt: timestamp, durationMs: 120, error: null,
}, calls: [
  { stepRecordId: passedStepId, stepId: "prepare", stepKind: "tool" as const, position: 0, attempt: 1,
    runId: passedRunId, workflowExecutionId: null, status: "PASSED" as const, startedAt: timestamp,
    completedAt: timestamp, durationMs: 40, error: null },
  { stepRecordId: failedStepId, stepId: "create", stepKind: "tool" as const, position: 1, attempt: 2,
    runId: failedRunId, workflowExecutionId: null, status: "FAILED" as const, startedAt: timestamp,
    completedAt: timestamp, durationMs: 80, error: { code: "ASSERTION_FAILED", message: "库存不足" } },
] }] };

function apiFixture() {
  return {
    getTestSuiteExecutionReport: vi.fn(async () => outline),
    listSavedTestSuiteReports: vi.fn(async () => ({ items: [{ id: "00000000-0000-4000-8000-000000000111",
      projectId, suiteId, suiteExecutionId: executionId, name: "订单回归报告", versionLabel: "1.0", note: null,
      revision: 1, createdAt: timestamp, updatedAt: timestamp }], nextCursor: null })),
    listTestSuiteExecutions: vi.fn(async () => ({ items: [], nextCursor: null })),
    getTestExecution: vi.fn(async () => ({ id: testExecutionId, projectId, testCaseId, testCaseRevision: 2,
      status: "FAILED", definitionSnapshot: { id: testCaseId, projectId, kind: "scenario", name: "创建订单",
        description: "", tags: [], revision: 2, isEnabled: true, inputs: [], steps: [], cleanupSteps: [],
        assertions: [], failurePolicy: "STOP", createdAt: timestamp, updatedAt: timestamp }, inputs: {},
      steps: [{ id: passedStepId, executionId: testExecutionId, stepId: "prepare", position: 0, attempt: 1,
        status: "PASSED", runId: passedRunId, workflowExecutionId: null, resolvedArguments: { page: 1 },
        startedAt: timestamp, completedAt: timestamp, durationMs: 40, error: null },
      { id: failedStepId, executionId: testExecutionId, stepId: "create", position: 1, attempt: 2,
        status: "FAILED", runId: failedRunId, workflowExecutionId: null, resolvedArguments: { sku: "SKU-1" },
        startedAt: timestamp, completedAt: timestamp, durationMs: 80, error: null }], assertions: [],
      error: null, createdAt: timestamp, startedAt: timestamp, completedAt: timestamp, durationMs: 120 })),
    getRun: vi.fn(async (_projectId: string, runId: string) => ({ id: runId } as RunDetail)),
    createSavedTestSuiteReport: vi.fn(async (_projectId: string, _key: string, input: any) => ({
      id: "00000000-0000-4000-8000-000000000112", projectId, suiteId, suiteExecutionId: executionId,
      name: input.name, versionLabel: input.versionLabel, note: input.note ?? null, revision: 1,
      createdAt: timestamp, updatedAt: timestamp,
    })),
    updateSavedTestSuiteReport: vi.fn(async (_projectId: string, _reportId: string, input: any) => ({
      id: "00000000-0000-4000-8000-000000000111", projectId, suiteId, suiteExecutionId: executionId,
      name: input.name, versionLabel: input.versionLabel, note: input.note, revision: 2,
      createdAt: timestamp, updatedAt: timestamp,
    })),
    deleteSavedTestSuiteReport: vi.fn(async () => undefined),
  } as unknown as InspectorApiClient;
}

describe("TestSuiteReportViewer", () => {
  beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });
  afterEach(cleanup);

  it("shows concurrent calls as a stable list and keeps one selected Run detail", async () => {
    const api = apiFixture();
    const user = userEvent.setup();
    render(<TestSuiteReportViewer api={api} projectId={projectId} suiteId={suiteId} executionId={executionId} />);

    expect(await screen.findByRole("heading", { name: "订单回归" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "报告版本" })).toHaveTextContent("1.0");
    expect(await screen.findByText(failedRunId)).toBeVisible();
    expect(screen.getAllByTestId("run-result-panel")).toHaveLength(1);
    expect(screen.getByText((_, element) => element?.tagName === "PRE" && element.textContent?.includes('"sku": "SKU-1"') === true)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "收起执行报告" }));
    expect(screen.queryByTestId("run-result-panel")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开执行报告" }));
    expect(await screen.findByTestId("run-result-panel")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /prepare/ }));
    await waitFor(() => expect(screen.getByTestId("run-result-panel")).toHaveTextContent(passedRunId));
    expect(screen.getAllByTestId("run-result-panel")).toHaveLength(1);
    expect(screen.getByText((_, element) => element?.tagName === "PRE" && element.textContent?.includes('"page": 1') === true)).toBeVisible();

    await user.click(screen.getByRole("button", { name: /create/ }));
    await waitFor(() => expect(screen.getByTestId("run-result-panel")).toHaveTextContent(failedRunId));
    expect(api.getRun).toHaveBeenCalledTimes(2);
  });

  it("saves the current immutable execution as a named version", async () => {
    const api = apiFixture();
    const onSavedReportsChange = vi.fn();
    const user = userEvent.setup();
    render(<><AppToaster /><TestSuiteReportViewer api={api} projectId={projectId} suiteId={suiteId} executionId={executionId}
      onSavedReportsChange={onSavedReportsChange} /></>);
    await screen.findByRole("heading", { name: "订单回归" });
    await user.click(screen.getByRole("button", { name: "保存为版本" }));
    expect(screen.getByLabelText("报告名称")).toHaveAttribute("maxlength", "120");
    expect(screen.getByLabelText("版本号")).toHaveAttribute("maxlength", "40");
    expect(screen.getByLabelText("备注")).toHaveAttribute("maxlength", "500");
    await user.clear(screen.getByLabelText("报告名称"));
    await user.type(screen.getByLabelText("报告名称"), "发布前回归");
    await user.type(screen.getByLabelText("版本号"), "2.0");
    await user.click(screen.getByRole("button", { name: "保存报告" }));

    await waitFor(() => expect(api.createSavedTestSuiteReport).toHaveBeenCalledWith(projectId, expect.any(String), {
      suiteId, suiteExecutionId: executionId, name: "发布前回归", versionLabel: "2.0", note: null,
    }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSavedReportsChange).toHaveBeenCalledOnce();
  });

  it("labels an execution opened from history without calling it the latest", async () => {
    const api = apiFixture();
    render(<TestSuiteReportViewer api={api} projectId={projectId} suiteId={suiteId} executionId={executionId} anchorIsLatest={false} />);
    expect(await screen.findByRole("combobox", { name: "报告版本" })).toHaveTextContent("所选执行");
    expect(screen.getByRole("combobox", { name: "报告版本" })).not.toHaveTextContent("最新执行");
  });

  it("edits and deletes only a saved version marker", async () => {
    const api = apiFixture();
    const reportId = "00000000-0000-4000-8000-000000000111";
    const user = userEvent.setup();
    render(<TestSuiteReportViewer api={api} projectId={projectId} suiteId={suiteId} executionId={executionId} savedReportId={reportId} />);
    await screen.findByRole("heading", { name: "订单回归" });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "报告版本" })).toHaveValue(`saved:${reportId}`));

    await user.click(screen.getByRole("button", { name: "编辑版本" }));
    await user.clear(screen.getByLabelText("报告名称"));
    await user.type(screen.getByLabelText("报告名称"), "订单回归归档");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(api.updateSavedTestSuiteReport).toHaveBeenCalledWith(projectId, reportId, {
      revision: 1, name: "订单回归归档", versionLabel: "1.0", note: null,
    }));

    await user.click(screen.getByRole("button", { name: "删除版本" }));
    expect(screen.getByRole("dialog", { name: "删除已保存版本？" })).toHaveTextContent("不会删除原始执行历史");
    await user.click(screen.getByRole("button", { name: "确认删除版本" }));
    expect(api.deleteSavedTestSuiteReport).toHaveBeenCalledWith(projectId, reportId);
    expect(screen.getByRole("combobox", { name: "报告版本" })).toHaveValue(`execution:${executionId}`);
  });

  it("does not load a Run for a stale call selection", async () => {
    const api = apiFixture();
    const getTestExecution = vi.mocked(api.getTestExecution);
    const execution = await getTestExecution(projectId, testExecutionId);
    getTestExecution.mockReset();
    let resolveFirst!: (value: typeof execution) => void;
    getTestExecution.mockImplementationOnce(async () => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(execution);
    const user = userEvent.setup();
    render(<TestSuiteReportViewer api={api} projectId={projectId} suiteId={suiteId} executionId={executionId} />);
    await screen.findByRole("heading", { name: "订单回归" });
    await user.click(screen.getByRole("button", { name: /prepare/ }));
    await waitFor(() => expect(api.getRun).toHaveBeenCalledWith(projectId, passedRunId, expect.anything()));
    resolveFirst(execution);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vi.mocked(api.getRun).mock.calls.some(([, id]) => id === failedRunId)).toBe(false);
    expect(screen.getByTestId("run-result-panel")).toHaveTextContent(passedRunId);
  });

  it("keeps a 100 by 20 call outline lazy and mounts only one full response", async () => {
    const api = apiFixture();
    const members = Array.from({ length: 100 }, (_, memberIndex) => {
      const itemId = `00000000-0000-4000-9000-${String(memberIndex + 1).padStart(12, "0")}`;
      return {
        item: { id: itemId, suiteExecutionId: executionId, memberId: itemId, testCaseId,
          testExecutionId, position: memberIndex, status: "PASSED" as const },
        testExecution: { ...outline.members[0]!.testExecution!, id: testExecutionId, status: "PASSED" as const },
        calls: Array.from({ length: 20 }, (_, callIndex) => ({ ...outline.members[0]!.calls[0]!,
          stepRecordId: `00000000-0000-4001-${String(memberIndex).padStart(4, "0")}-${String(callIndex + 1).padStart(12, "0")}`,
          stepId: `step-${callIndex + 1}`, position: callIndex, status: "PASSED" as const,
        })),
      };
    });
    vi.mocked(api.getTestSuiteExecutionReport).mockResolvedValue({
      execution: { ...suiteExecution, status: "PASSED", items: members.map(({ item }) => item) }, members,
    });

    render(<TestSuiteReportViewer api={api} projectId={projectId} suiteId={suiteId} executionId={executionId} />);
    expect(await screen.findByTestId("run-result-panel")).toBeVisible();
    expect(screen.getAllByTestId("run-result-panel")).toHaveLength(1);
    expect(api.getRun).toHaveBeenCalledTimes(1);
  });
});
