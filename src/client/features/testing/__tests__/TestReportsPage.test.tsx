// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient } from "../../../api/api-client.js";
import { i18n } from "../../../i18n/index.js";
import { TestReportsPage } from "../TestReportsPage.js";

const projectId = "00000000-0000-4000-8000-000000000951";
const testCaseId = "00000000-0000-4000-8000-000000000952";
const executionId = "00000000-0000-4000-8000-000000000953";
const runId = "00000000-0000-4000-8000-000000000954";
const connectionId = "00000000-0000-4000-8000-000000000955";
const snapshotId = "00000000-0000-4000-8000-000000000956";
const timestamp = "2026-09-01T00:00:00.000Z";

describe("TestReportsPage", () => {
  beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });
  afterEach(cleanup);

  it("uses the compact testing module header", async () => {
    const api = {
      listTestExecutions: vi.fn(async () => ({ items: [], nextCursor: null })),
    } as unknown as InspectorApiClient;
    const { container } = render(<TestReportsPage api={api} projectId={projectId} />);

    await screen.findByText("还没有测试执行记录。");
    expect(container.querySelector(".testing-page__heading--compact")).toContainElement(
      screen.getByRole("heading", { name: "测试报告", level: 1 }),
    );
    const description = screen.getByText("查看执行历史、断言结果与完整调用追溯。");
    const actions = container.querySelector<HTMLElement>(".testing-page__create-actions");
    expect(description.parentElement).toContainElement(actions);
    expect(description.compareDocumentPosition(actions!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("loads a historical report and resolves its Run to the Tool snapshot", async () => {
    const summary = { id: executionId, projectId, testCaseId, testCaseRevision: 1, testCaseName: "价格基线",
      testCaseKind: "tool" as const, status: "PASSED" as const, assertionSummary: { total: 1, passed: 1, failed: 0, error: 0 },
      createdAt: timestamp, startedAt: timestamp, completedAt: timestamp, durationMs: 12, error: null };
    const definition = { id: testCaseId, projectId, revision: 1, kind: "tool" as const, name: "价格基线",
      description: "", tags: [], isEnabled: true, target: { connectionId, toolName: "get_price" }, arguments: {},
      assertions: [{ id: "value", source: "MCP_RESULT" as const, path: "$.value", operator: "EQUALS" as const, expected: 1 }],
      timeoutMs: 1000, createdAt: timestamp, updatedAt: timestamp };
    const detail = { ...summary, definitionSnapshot: definition, inputs: {}, assertions: [{
      id: "00000000-0000-4000-8000-000000000958", executionId, stepRecordId: null, assertionId: "value",
      position: 0, status: "FAILED" as const, definition: definition.assertions[0], resolvedPath: "$.value",
      actual: 2, expected: 1, errorCode: null, message: null, durationMs: 1, isRedacted: false,
    }], steps: [{
      id: "00000000-0000-4000-8000-000000000957", executionId, stepId: "main", position: 0, attempt: 1,
      status: "PASSED" as const, runId, workflowExecutionId: null, resolvedArguments: {}, startedAt: timestamp,
      completedAt: timestamp, durationMs: 12, error: null,
    }] };
    const api = {
      listTestExecutions: vi.fn(async () => ({ items: [summary], nextCursor: null })),
      getTestExecution: vi.fn(async () => detail),
      getRunSummary: vi.fn(async () => ({ id: runId, projectId, connectionId, tabId: null, toolName: "get_price",
        toolSnapshotId: snapshotId, idempotencyKey: "test", status: "succeeded", createdAt: timestamp,
        startedAt: timestamp, completedAt: timestamp, durationMs: 12, networkDurationMs: 10 })),
      updateTestExecutionBaseline: vi.fn(async () => ({ testCase: { ...definition, revision: 2 }, updatedAssertions: 1 })),
    } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<TestReportsPage api={api} projectId={projectId} />);
    await user.click(await screen.findByRole("button", { name: /价格基线/ }));
    expect(await screen.findByText(snapshotId)).toBeVisible();
    expect(screen.getByText(connectionId)).toBeVisible();
    expect(api.getRunSummary).toHaveBeenCalledWith(projectId, runId);
    await user.click(screen.getByRole("button", { name: "更新基线" }));
    expect(screen.getByRole("dialog", { name: "更新测试基线？" })).toHaveTextContent("第 1 版");
    await user.click(screen.getByRole("button", { name: "确认更新基线" }));
    expect(api.updateTestExecutionBaseline).toHaveBeenCalledWith(projectId, executionId, { revision: 1, confirm: true });
  });

  it("lists saved suite report versions and opens one immutable execution", async () => {
    const suiteId = "00000000-0000-4000-8000-000000000960";
    const suiteExecutionId = "00000000-0000-4000-8000-000000000961";
    const reportId = "00000000-0000-4000-8000-000000000962";
    const suiteSnapshot = { id: suiteId, projectId, name: "发布回归", description: "", tags: [], revision: 1,
      members: [], executionPolicy: { concurrency: 4, stopOnFailure: false }, createdAt: timestamp, updatedAt: timestamp };
    const suiteExecution = { id: suiteExecutionId, projectId, suiteId, suiteRevision: 1, status: "PASSED" as const,
      suiteSnapshot, summary: { total: 0, passed: 0, failed: 0, errors: 0, cancelled: 0 }, error: null,
      createdAt: timestamp, startedAt: timestamp, completedAt: timestamp, durationMs: 20, items: [] };
    const saved = { id: reportId, projectId, suiteId, suiteExecutionId, name: "生产发布前", versionLabel: "2.0",
      note: "release", revision: 1, createdAt: timestamp, updatedAt: timestamp };
    const api = {
      listTestExecutions: vi.fn(async () => ({ items: [], nextCursor: null })),
      listTestSuites: vi.fn(async () => ({ items: [], nextCursor: null })),
      listSavedTestSuiteReports: vi.fn(async () => ({ items: [saved], nextCursor: null })),
      listTestSuiteExecutions: vi.fn(async () => ({ items: [], nextCursor: null })),
      getTestSuiteExecutionReport: vi.fn(async () => ({ execution: suiteExecution, members: [] })),
    } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<TestReportsPage api={api} projectId={projectId} />);

    await user.click(await screen.findByRole("tab", { name: "套件报告" }));
    await user.click(await screen.findByRole("button", { name: /生产发布前.*2.0/ }));
    expect(await screen.findByRole("heading", { name: "发布回归", level: 3 })).toBeVisible();
    expect(api.getTestSuiteExecutionReport).toHaveBeenCalledWith(projectId, suiteExecutionId);
  });

  it("opens a pressure report and keeps full Tool details behind one selected call", async () => {
    const pressureTestId = "00000000-0000-4000-8000-000000000971";
    const pressureExecutionId = "00000000-0000-4000-8000-000000000972";
    const pressureDefinition = { id: pressureTestId, projectId, name: "库存压测", description: "", revision: 1,
      target: { testCaseId }, inputs: {}, load: { virtualUsers: 2, rampUpMs: 0, durationMs: 1000, thinkTimeMs: 0, maxIterations: 10 },
      thresholds: { maxErrorRate: .01, maxP95DurationMs: 500, minRequestsPerSecond: 1, stopOnErrorRate: true },
      createdAt: timestamp, updatedAt: timestamp };
    const execution = { id: pressureExecutionId, projectId, pressureTestId, pressureTestRevision: 1,
      definitionSnapshot: pressureDefinition, targetSnapshot: { id: testCaseId, name: "库存", kind: "tool" as const, revision: 1 },
      status: "PASSED" as const, summary: { total: 1, passed: 1, failed: 0, errors: 0, cancelled: 0,
        errorRate: 0, averageRequestsPerSecond: 1, peakRequestsPerSecond: 1,
        duration: { minMs: 10, maxMs: 10, averageMs: 10, p50Ms: 10, p90Ms: 10, p95Ms: 10, p99Ms: 10 },
        thresholds: [{ metric: "ERROR_RATE" as const, target: .01, actual: 0, passed: true },
          { metric: "P95_DURATION" as const, target: 500, actual: 10, passed: true },
          { metric: "REQUESTS_PER_SECOND" as const, target: 1, actual: 1, passed: true }] },
      error: null, createdAt: timestamp, startedAt: timestamp, completedAt: timestamp, durationMs: 1000 };
    const sample = { id: "00000000-0000-4000-8000-000000000973", projectId,
      pressureTestExecutionId: pressureExecutionId, testExecutionId: executionId, virtualUser: 1, iteration: 1,
      status: "PASSED" as const, startedAt: timestamp, completedAt: timestamp, durationMs: 10, error: null };
    const api = { listTestExecutions: vi.fn(async () => ({ items: [], nextCursor: null })),
      listPressureTestExecutions: vi.fn(async () => ({ items: [execution], nextCursor: null })),
      getPressureTestExecution: vi.fn(async () => execution),
      listPressureTestSamples: vi.fn(async () => ({ items: [sample], nextCursor: null })),
    } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<TestReportsPage api={api} projectId={projectId} />);
    await user.click(await screen.findByRole("tab", { name: "压力报告" }));
    await user.click(await screen.findByRole("button", { name: /库存压测/ }));
    expect(await screen.findByText("0.00%")).toBeVisible();
    expect(screen.getByRole("img", { name: "压力测试每秒调用数和平均延迟趋势" })).toBeVisible();
    expect(screen.getByRole("table", { name: "压力测试时间序列数据" })).toBeVisible();
    expect(screen.getByRole("button", { name: /#1/ })).toBeVisible();
    expect(api.getTestExecution).toBeUndefined();
  });

  it("moves between report tabs with the keyboard", async () => {
    const api = { listTestExecutions: vi.fn(async () => ({ items: [], nextCursor: null })),
      listTestSuites: vi.fn(async () => ({ items: [], nextCursor: null })),
      listSavedTestSuiteReports: vi.fn(async () => ({ items: [], nextCursor: null })),
      listPressureTestExecutions: vi.fn(async () => ({ items: [], nextCursor: null })),
    } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<TestReportsPage api={api} projectId={projectId} />);
    const caseTab = await screen.findByRole("tab", { name: "用例报告" });
    caseTab.focus(); await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "套件报告" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "压力报告" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "压力报告" })).toHaveAttribute("aria-selected", "true");
  });

  it("bounds concurrent history requests when loading many suites", async () => {
    const suites = Array.from({ length: 9 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      projectId, name: `套件 ${index + 1}`, description: "", tags: [], revision: 1, memberCount: 0,
      executionPolicy: { concurrency: 1, stopOnFailure: false }, createdAt: timestamp, updatedAt: timestamp,
    }));
    let active = 0;
    let peak = 0;
    const api = {
      listTestExecutions: vi.fn(async () => ({ items: [], nextCursor: null })),
      listTestSuites: vi.fn(async () => ({ items: suites, nextCursor: null })),
      listSavedTestSuiteReports: vi.fn(async () => ({ items: [], nextCursor: null })),
      listTestSuiteExecutions: vi.fn(async () => {
        active += 1; peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 0));
        active -= 1;
        return { items: [], nextCursor: null };
      }),
    } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<TestReportsPage api={api} projectId={projectId} />);

    await user.click(await screen.findByRole("tab", { name: "套件报告" }));
    await screen.findByText("没有符合条件的套件执行报告。");
    expect(api.listTestSuiteExecutions).toHaveBeenCalledTimes(9);
    expect(peak).toBe(8);
  });

  it("requires an explicit Server binding before importing definitions", async () => {
    const envelope = { format: "mcp-inspector-automated-tests" as const, version: 1 as const, exportedAt: timestamp,
      sourceProject: { id: projectId, name: "Source" },
      connections: [{ alias: "server-1", sourceConnectionId: connectionId, name: "Source API" }],
      data: { testCases: [], testSuites: [] } };
    const targetConnectionId = "00000000-0000-4000-8000-000000000959";
    const api = {
      listTestExecutions: vi.fn(async () => ({ items: [], nextCursor: null })),
      listConnections: vi.fn(async () => [{ id: targetConnectionId, projectId, name: "Target API",
        url: "https://target.example/mcp", transport: "streamable-http" as const, authMode: "none" as const,
        bearerToken: null, headers: {}, redactSensitiveInfo: true, authorizationStatus: "not-required" as const,
        timeoutMs: 10_000, status: "disconnected" as const, lastProtocolVersion: null, lastServerInfo: null, lastError: null }]),
      importAutomatedTests: vi.fn(async () => ({ importedTestCases: 0, importedTestSuites: 0,
        skippedTestCases: 0, skippedTestSuites: 0, testCaseIds: {}, testSuiteIds: {} })),
    } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<TestReportsPage api={api} projectId={projectId} />);
    const file = new File([JSON.stringify(envelope)], "tests.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => JSON.stringify(envelope) });
    await user.upload(screen.getByLabelText("选择自动化测试 JSON 文件"), file);
    const dialog = await screen.findByRole("dialog", { name: "导入自动化测试" });
    expect(screen.getByRole("button", { name: "确认导入" })).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: "为 Source API 绑定 Server" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索可绑定的 Server" }), "Target");
    await user.click(screen.getByRole("option", { name: "Target API" }));
    await user.selectOptions(screen.getByRole("combobox", { name: /冲突处理/ }), "OVERWRITE");
    await user.click(screen.getByRole("button", { name: "确认导入" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(api.importAutomatedTests).toHaveBeenCalledWith(projectId, {
      envelope, bindings: { "server-1": targetConnectionId }, conflictPolicy: "OVERWRITE", confirm: true,
    });
  });
});
