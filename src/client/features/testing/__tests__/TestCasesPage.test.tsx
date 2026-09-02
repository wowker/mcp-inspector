// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogToolSummary, InspectorApiClient, RunDetail } from "../../../api/api-client.js";
import { AppToaster } from "../../../app/AppToaster.js";
import { i18n } from "../../../i18n/index.js";
import { TestCasesPage } from "../TestCasesPage.js";
import { buildTestCaseCreationPreview } from "../../../../shared/testing/creation-preview.js";
import type { TestExecutionDetail } from "../../../../shared/testing/test-execution.js";

const projectId = "00000000-0000-4000-8000-000000000101";
const connectionId = "00000000-0000-4000-8000-000000000102";
const testCaseId = "00000000-0000-4000-8000-000000000103";
const timestamp = "2026-09-01T00:00:00.000Z";
const tool: CatalogToolSummary = {
  projectId, connectionId, name: "get_price", status: "current", folderId: null,
  favorite: false, lastUsedAt: null, updatedAt: timestamp,
  currentSnapshot: {
    id: "00000000-0000-4000-8000-000000000104", projectId, connectionId, toolName: "get_price",
    contentHash: "hash", createdAt: timestamp,
    definition: { name: "get_price", description: "Read price",
      inputSchema: { type: "object", properties: { product_id: { type: "string" } }, required: ["product_id"] },
    },
  },
};
const existingDefinition = {
  id: testCaseId, projectId, kind: "tool" as const, name: "已有用例", description: "", tags: [], revision: 2,
  isEnabled: true, target: { connectionId, toolName: "get_price" }, arguments: { product_id: "42" }, assertions: [],
  timeoutMs: 30000, createdAt: timestamp, updatedAt: timestamp,
};
const existingScenarioDefinition = {
  id: testCaseId, projectId, kind: "scenario" as const, name: "场景用例", description: "", tags: [], revision: 1,
  isEnabled: true, inputs: [{ name: "initial", description: "起始值", isRequired: true }], assertions: [],
  failurePolicy: "STOP" as const, cleanupSteps: [], createdAt: timestamp, updatedAt: timestamp,
  steps: [{ id: "first", name: "第一步", target: { connectionId, toolName: "get_price" }, fixedArguments: {},
    mappings: [], extractors: [], assertions: [], condition: null, polling: null, onFailure: "STOP" as const }],
};
const executionId = "00000000-0000-4000-8000-000000000106";
function execution(status: TestExecutionDetail["status"]): TestExecutionDetail {
  return {
    id: executionId, projectId, testCaseId, testCaseRevision: 2, status,
    createdAt: timestamp, startedAt: status === "QUEUED" ? null : timestamp,
    completedAt: status === "QUEUED" || status === "RUNNING" ? null : timestamp,
    durationMs: status === "QUEUED" || status === "RUNNING" ? null : 12, error: null,
    definitionSnapshot: existingDefinition, inputs: {}, steps: [],
    assertions: status === "PASSED" ? [{
      id: "00000000-0000-4000-8000-000000000107", executionId, stepRecordId: null, position: 0,
      assertionId: "price", status: "PASSED", definition: { id: "price", source: "MCP_RESULT", path: "/price", operator: "EQUALS", expected: 12.5 },
      resolvedPath: "/price", actual: 12.5, expected: 12.5, errorCode: null, message: null, durationMs: 1, isRedacted: false,
    }] : [],
  };
}

function api(overrides: Partial<InspectorApiClient> = {}): InspectorApiClient {
  return {
    listTestCases: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listConnections: vi.fn().mockResolvedValue([{
      id: connectionId, projectId, name: "Price Server", url: "https://example.test/mcp", transport: "streamable-http",
      authMode: "none", bearerToken: null, headers: {}, redactSensitiveInfo: true, authorizationStatus: "not-required",
      timeoutMs: 10000, status: "connected", lastProtocolVersion: null, lastServerInfo: null, lastError: null,
    }]),
    listTools: vi.fn().mockResolvedValue([tool]),
    createTestCase: vi.fn().mockImplementation(async (_projectId, input) => ({
      ...input, id: testCaseId, projectId, revision: 1, createdAt: timestamp, updatedAt: timestamp,
    })),
    updateTestCase: vi.fn(), deleteTestCase: vi.fn(), getTestCase: vi.fn(),
    previewTestCaseFromRun: vi.fn(), previewTestCaseFromSavedItem: vi.fn(),
    listTestSuites: vi.fn(), getTestSuite: vi.fn(), createTestSuite: vi.fn(), updateTestSuite: vi.fn(), deleteTestSuite: vi.fn(),
    startTestSuiteExecution: vi.fn(), getTestSuiteExecution: vi.fn(), cancelTestSuiteExecution: vi.fn(),
    startTestExecution: vi.fn(), listTestExecutions: vi.fn(), updateTestExecutionBaseline: vi.fn(), getTestExecution: vi.fn(), cancelTestExecution: vi.fn(),
    exportAutomatedTests: vi.fn(), importAutomatedTests: vi.fn(),
    ...overrides,
  } as unknown as InspectorApiClient;
}

beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("TestCasesPage", () => {
  it("uses the compact testing module header", async () => {
    const { container } = render(<TestCasesPage api={api()} projectId={projectId} />);

    await screen.findByText("还没有测试用例");
    expect(container.querySelector(".testing-page__heading--compact")).toContainElement(
      screen.getByRole("heading", { name: "自动化测试", level: 1 }),
    );
  });

  it("creates a scenario definition with stable ordered steps", async () => {
    const client = api();
    const user = userEvent.setup();
    render(<><AppToaster /><TestCasesPage api={client} projectId={projectId} /></>);

    expect(await screen.findByText("还没有测试用例")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "新建场景测试" }));
    await user.type(screen.getByLabelText("名称"), "商品发布场景");
    await user.click(screen.getByRole("button", { name: "添加主步骤" }));
    await user.clear(screen.getByLabelText("步骤名称"));
    await user.type(screen.getByLabelText("步骤名称"), "读取商品");
    await user.selectOptions(screen.getByLabelText("Server"), connectionId);
    await waitFor(() => expect(screen.getByLabelText("Tool")).not.toBeDisabled());
    await user.selectOptions(screen.getByLabelText("Tool"), "get_price");
    await user.click(screen.getByLabelText("启用轮询"));
    await user.click(screen.getByRole("button", { name: "保存测试用例" }));

    await waitFor(() => expect(client.createTestCase).toHaveBeenCalledWith(projectId, expect.objectContaining({
      kind: "scenario", name: "商品发布场景", steps: [expect.objectContaining({
        id: expect.any(String), name: "读取商品", target: { connectionId, toolName: "get_price" },
        polling: expect.objectContaining({ intervalMs: 1000, maxAttempts: 10, timeoutMs: 30000 }),
      })], cleanupSteps: [], failurePolicy: "STOP",
    })));
  });

  it("creates and saves a single-Tool test without executing the Tool", async () => {
    const client = api();
    const user = userEvent.setup();
    render(<><AppToaster /><TestCasesPage api={client} projectId={projectId} /></>);

    expect(await screen.findByText("还没有测试用例")).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "新建测试用例" })[0]!);
    await user.type(screen.getByLabelText("名称"), "价格基线");
    await user.selectOptions(screen.getByLabelText("Server"), connectionId);
    await waitFor(() => expect(screen.getByLabelText("Tool")).not.toBeDisabled());
    await user.selectOptions(screen.getByLabelText("Tool"), "get_price");
    expect(await screen.findByLabelText(/product_id/)).toBeVisible();
    await user.type(screen.getByLabelText(/product_id/), "42");
    await user.click(screen.getByRole("button", { name: "添加断言" }));
    await user.clear(screen.getByLabelText("期望值（JSON）"));
    await user.type(screen.getByLabelText("期望值（JSON）"), "12.5");
    await user.click(screen.getByRole("button", { name: "保存测试用例" }));

    await waitFor(() => expect(client.createTestCase).toHaveBeenCalledWith(projectId, expect.objectContaining({
      kind: "tool", name: "价格基线", target: { connectionId, toolName: "get_price" },
      arguments: { product_id: "42" }, assertions: [expect.objectContaining({ expected: 12.5 })], timeoutMs: 30000,
    })));
    expect(client.startRun).toBeUndefined();
    expect(screen.getByRole("button", { name: "执行测试" })).toBeVisible();
  });

  it("keeps the local draft when saving fails", async () => {
    const client = api({ createTestCase: vi.fn().mockRejectedValue(new Error("revision unavailable")) });
    const user = userEvent.setup();
    render(<><AppToaster /><TestCasesPage api={client} projectId={projectId} /></>);
    await screen.findByText("还没有测试用例");
    await user.click(screen.getAllByRole("button", { name: "新建测试用例" })[0]!);
    await user.type(screen.getByLabelText("名称"), "保留这个草稿");
    await user.selectOptions(screen.getByLabelText("Server"), connectionId);
    await waitFor(() => expect(screen.getByLabelText("Tool")).not.toBeDisabled());
    await user.selectOptions(screen.getByLabelText("Tool"), "get_price");
    await user.click(screen.getByRole("button", { name: "保存测试用例" }));
    expect(await screen.findByText("保存失败，草稿已保留")).toBeVisible();
    expect(screen.getByLabelText("名称")).toHaveValue("保留这个草稿");
  });

  it("renders the workflow in English", async () => {
    await i18n.changeLanguage("en-US");
    render(<TestCasesPage api={api()} projectId={projectId} />);
    expect(await screen.findByRole("heading", { name: "Automated testing" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "New test case" }).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("Search test cases")).toBeVisible();
  });

  it("shows a safe preview for a truncated Run and omits secret-shaped arguments", async () => {
    const run = {
      id: "00000000-0000-4000-8000-000000000105", projectId, connectionId, toolName: "get_price",
      request: { arguments: { product_id: "42", api_token: "do-not-copy" } },
      response: { result: { price: 12.5 }, error: null, truncated: true, originalBytes: 4000 },
    } as unknown as RunDetail;
    const client = api({ previewTestCaseFromRun: vi.fn().mockResolvedValue(buildTestCaseCreationPreview({
      source: { kind: "run", id: run.id }, connectionId, toolName: "get_price", name: "get_price baseline",
      argumentsValue: run.request.arguments, baseline: run.response?.result, truncated: true, toolStatus: "current",
    })) });
    render(<TestCasesPage api={client} projectId={projectId} sourceIntent={{ sequence: 1, source: { kind: "run", run } }} />);

    expect(await screen.findByText("创建预览需要确认")).toBeVisible();
    expect(screen.getByText(/已忽略疑似敏感字段/)).toBeVisible();
    expect(screen.getByText(/来源响应已截断/)).toBeVisible();
    expect(await screen.findByLabelText(/product_id/)).toHaveValue("42");
    expect(screen.queryByDisplayValue("do-not-copy")).not.toBeInTheDocument();
    expect(screen.getByText(/尚未添加断言/)).toBeVisible();
  });

  it("requires confirmation before deleting an existing test case", async () => {
    const deleteTestCase = vi.fn().mockResolvedValue(undefined);
    const client = api({
      listTestCases: vi.fn().mockResolvedValue({ items: [{
        id: testCaseId, projectId, kind: "tool", name: "已有用例", description: "", tags: [], revision: 2,
        isEnabled: true, targetConnectionIds: [connectionId], createdAt: timestamp, updatedAt: timestamp,
      }], nextCursor: null }),
      getTestCase: vi.fn().mockResolvedValue(existingDefinition), deleteTestCase,
    });
    const user = userEvent.setup();
    render(<TestCasesPage api={client} projectId={projectId} />);
    await user.click(await screen.findByRole("button", { name: /已有用例/ }));
    await user.click(await screen.findByRole("button", { name: "删除测试用例" }));
    expect(screen.getByRole("dialog", { name: "删除测试用例？" })).toBeVisible();
    expect(deleteTestCase).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(deleteTestCase).toHaveBeenCalledWith(projectId, testCaseId));
  });

  it("runs a saved test and renders each assertion result without opening a debug Tab", async () => {
    const startTestExecution = vi.fn().mockResolvedValue(execution("PASSED"));
    const client = api({
      listTestCases: vi.fn().mockResolvedValue({ items: [{
        id: testCaseId, projectId, kind: "tool", name: "已有用例", description: "", tags: [], revision: 2,
        isEnabled: true, targetConnectionIds: [connectionId], createdAt: timestamp, updatedAt: timestamp,
      }], nextCursor: null }),
      getTestCase: vi.fn().mockResolvedValue(existingDefinition), startTestExecution,
    });
    const user = userEvent.setup();
    render(<><AppToaster /><TestCasesPage api={client} projectId={projectId} /></>);
    await user.click(await screen.findByRole("button", { name: /已有用例/ }));
    await user.click(await screen.findByRole("button", { name: "执行测试" }));
    await waitFor(() => expect(startTestExecution).toHaveBeenCalledWith(projectId, testCaseId, expect.any(String), {}));
    expect(await screen.findByText("最近一次执行")).toBeVisible();
    expect(screen.getAllByText("通过").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("MCP_RESULT/price")).toBeVisible();
    expect(client.openTab).toBeUndefined();
  });

  it("cancels an active execution and refreshes its terminal state", async () => {
    const client = api({
      listTestCases: vi.fn().mockResolvedValue({ items: [{
        id: testCaseId, projectId, kind: "tool", name: "已有用例", description: "", tags: [], revision: 2,
        isEnabled: true, targetConnectionIds: [connectionId], createdAt: timestamp, updatedAt: timestamp,
      }], nextCursor: null }),
      getTestCase: vi.fn().mockResolvedValue(existingDefinition),
      startTestExecution: vi.fn().mockResolvedValue(execution("RUNNING")),
      cancelTestExecution: vi.fn().mockResolvedValue(undefined),
      getTestExecution: vi.fn().mockResolvedValue(execution("CANCELLED")),
    });
    const user = userEvent.setup();
    render(<TestCasesPage api={client} projectId={projectId} />);
    await user.click(await screen.findByRole("button", { name: /已有用例/ }));
    await user.click(await screen.findByRole("button", { name: "执行测试" }));
    await user.click(await screen.findByRole("button", { name: "取消执行" }));
    await waitFor(() => expect(client.cancelTestExecution).toHaveBeenCalledWith(projectId, executionId));
    expect(await screen.findByText("已取消")).toBeVisible();
  });

  it("runs a saved scenario with JSON inputs and renders every step attempt", async () => {
    const completed: TestExecutionDetail = {
      ...execution("PASSED"), testCaseRevision: 1, definitionSnapshot: existingScenarioDefinition,
      inputs: { initial: 1 }, assertions: [], steps: [{
        id: "00000000-0000-4000-8000-000000000108", executionId, stepId: "first", position: 0,
        attempt: 1, status: "PASSED", runId: "00000000-0000-4000-8000-000000000109",
        workflowExecutionId: null, resolvedArguments: { product_id: "42" }, startedAt: timestamp,
        completedAt: timestamp, durationMs: 12, error: null,
      }],
    };
    const startTestExecution = vi.fn().mockResolvedValue(completed);
    const client = api({
      listTestCases: vi.fn().mockResolvedValue({ items: [{
        id: testCaseId, projectId, kind: "scenario", name: "场景用例", description: "", tags: [], revision: 1,
        isEnabled: true, targetConnectionIds: [connectionId], createdAt: timestamp, updatedAt: timestamp,
      }], nextCursor: null }),
      getTestCase: vi.fn().mockResolvedValue(existingScenarioDefinition), startTestExecution,
    });
    const user = userEvent.setup();
    render(<TestCasesPage api={client} projectId={projectId} />);
    await user.click(await screen.findByRole("button", { name: /场景用例/ }));
    await user.type(await screen.findByLabelText("initial（JSON）"), "1");
    await user.click(screen.getByRole("button", { name: "执行场景" }));
    await waitFor(() => expect(startTestExecution).toHaveBeenCalledWith(
      projectId, testCaseId, expect.any(String), { inputs: { initial: 1 } },
    ));
    expect(await screen.findByText("步骤执行记录（1）")).toBeVisible();
    expect(screen.getAllByText("第一步").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("尝试 1")).toBeVisible();
  });
});
