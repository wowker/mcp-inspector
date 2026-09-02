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
    await user.selectOptions(screen.getByLabelText("为 Source API 绑定 Server"), targetConnectionId);
    await user.selectOptions(screen.getByRole("combobox", { name: /冲突处理/ }), "OVERWRITE");
    await user.click(screen.getByRole("button", { name: "确认导入" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(api.importAutomatedTests).toHaveBeenCalledWith(projectId, {
      envelope, bindings: { "server-1": targetConnectionId }, conflictPolicy: "OVERWRITE", confirm: true,
    });
  });
});
