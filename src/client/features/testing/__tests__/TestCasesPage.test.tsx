// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspectorApiError, type CatalogToolSummary, type InspectorApiClient, type RunDetail } from "../../../api/api-client.js";
import { AppToaster } from "../../../app/AppToaster.js";
import { i18n } from "../../../i18n/index.js";
import { TestCasesPage } from "../TestCasesPage.js";
import { TestExecutionPanel } from "../TestExecutionPanel.js";
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
const runId = "00000000-0000-4000-8000-000000000109";
const completedRun: RunDetail = {
  id: runId, projectId, connectionId, tabId: null, toolName: "get_price",
  toolSnapshotId: tool.currentSnapshot.id, toolSnapshotHash: "a".repeat(64), idempotencyKey: "test-execution",
  status: "succeeded", createdAt: timestamp, startedAt: timestamp, completedAt: timestamp,
  durationMs: 12, networkDurationMs: 8, pinned: false, replayedFromRunId: null,
  protocolVersion: "2025-06-18", serverInfo: { name: "fixture", version: "1" },
  clientInfo: { name: "MCP Inspector", version: "2.0.4" },
  request: { arguments: { product_id: "42" }, jsonrpc: { jsonrpc: "2.0", id: 1, method: "tools/call" }, http: null },
  response: { result: { structuredContent: { price: 12.5 } }, error: null, truncated: false, originalBytes: 32 },
  events: [],
};
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
    const list = screen.getByRole("complementary", { name: "测试用例" });
    const search = screen.getByPlaceholderText("搜索测试用例");
    const createTool = screen.getByRole("button", { name: "新建测试用例" });
    const createScenario = screen.getByRole("button", { name: "新建场景测试" });
    expect(list).toContainElement(createTool);
    expect(search.compareDocumentPosition(createTool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "新建测试用例" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "新建场景测试" })).toHaveLength(1);
    expect(createTool).toHaveAttribute("data-variant", "secondary");
    expect(createScenario).toHaveAttribute("data-variant", "secondary");
  });

  it("keeps the enable switch accessible without repeating enabled or disabled state text", async () => {
    const user = userEvent.setup();
    render(<TestCasesPage api={api()} projectId={projectId} />);

    await screen.findByText("还没有测试用例");
    await user.click(screen.getByRole("button", { name: "新建测试用例" }));
    const toolSwitch = screen.getByRole("switch", { name: "是否启用" });
    expect(toolSwitch).toBeChecked();
    expect(screen.queryByText("已启用")).not.toBeInTheDocument();
    await user.click(toolSwitch);
    expect(toolSwitch).not.toBeChecked();
    expect(screen.queryByText("已停用")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新建场景测试" }));
    expect(screen.getByRole("switch", { name: "是否启用" })).toBeChecked();
    expect(screen.queryByText("已启用")).not.toBeInTheDocument();
  });

  it("orders case actions and collapses basic information and Test configuration while editing", async () => {
    const client = api({
      listTestCases: vi.fn().mockResolvedValue({ items: [{
        id: testCaseId, projectId, kind: "tool", name: "已有用例", description: "", tags: [], revision: 2,
        isEnabled: true, targetConnectionIds: [connectionId], createdAt: timestamp, updatedAt: timestamp,
      }], nextCursor: null }),
      getTestCase: vi.fn().mockResolvedValue(existingDefinition),
    });
    const user = userEvent.setup();
    render(<TestCasesPage api={client} projectId={projectId} />);

    await user.click(await screen.findByRole("button", { name: /已有用例/ }));
    const basics = screen.getByRole("button", { name: "基本信息" });
    expect(basics).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("名称")).not.toBeInTheDocument();
    const configuration = screen.getByRole("button", { name: "测试配置" });
    expect(configuration).toHaveAttribute("aria-expanded", "false");
    const argumentsDisclosure = await screen.findByRole("button", { name: "请求参数" });
    const assertionsDisclosure = screen.getByRole("button", { name: "断言" });
    const resultDisclosure = screen.getByRole("button", { name: "执行结果" });
    expect(argumentsDisclosure).toHaveAttribute("aria-expanded", "false");
    expect(assertionsDisclosure).toHaveAttribute("aria-expanded", "false");
    expect(resultDisclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("combobox", { name: "Server" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("超时时间（毫秒）")).not.toBeInTheDocument();
    await user.click(basics);
    expect(screen.getByLabelText("名称")).toHaveValue("已有用例");
    expect(screen.queryByLabelText("标签")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "是否启用" })).toBeChecked();
    await user.click(configuration);
    expect(screen.getByRole("combobox", { name: "Server" })).toHaveTextContent("Price Server");
    expect(screen.getByRole("combobox", { name: "Tool" })).toHaveTextContent("get_price");
    expect(screen.getByLabelText("超时时间（毫秒）")).toHaveValue(30000);
    await user.click(argumentsDisclosure);
    expect(screen.getByRole("tab", { name: "Form" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "收起参数" })).not.toBeInTheDocument();
    await user.click(assertionsDisclosure);
    expect(screen.getByRole("button", { name: "添加断言" })).toBeVisible();

    const actions = screen.getByRole("button", { name: "执行测试" }).parentElement!;
    expect([...actions.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "执行测试", "保存", "取消", "删除",
    ]);

    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "新建测试用例" }));
    expect(screen.getByRole("button", { name: "基本信息" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "测试配置" })).toHaveAttribute("aria-expanded", "true");
  });

  it("groups Server, Tool, and timeout in that order inside Test configuration", async () => {
    const user = userEvent.setup();
    render(<TestCasesPage api={api()} projectId={projectId} />);
    await screen.findByText("还没有测试用例");
    await user.click(screen.getByRole("button", { name: "新建测试用例" }));

    const basics = screen.getByRole("button", { name: "基本信息" });
    const configuration = screen.getByRole("button", { name: "测试配置" });
    expect(basics.compareDocumentPosition(configuration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(configuration).toHaveAttribute("aria-expanded", "true");
    const server = screen.getByRole("combobox", { name: "Server" });
    const toolTarget = screen.getByRole("combobox", { name: "Tool" });
    const timeout = screen.getByLabelText("超时时间（毫秒）");
    expect(configuration.parentElement).toContainElement(server);
    expect(configuration.parentElement).toContainElement(toolTarget);
    expect(configuration.parentElement).toContainElement(timeout);
    expect(server.compareDocumentPosition(toolTarget) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toolTarget.compareDocumentPosition(timeout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "测试目标" })).not.toBeInTheDocument();
  });

  it("creates a scenario definition with stable ordered steps", async () => {
    const client = api();
    const user = userEvent.setup();
    render(<><AppToaster /><TestCasesPage api={client} projectId={projectId} /></>);

    expect(await screen.findByText("还没有测试用例")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "新建场景测试" }));
    expect(screen.getByRole("button", { name: "场景配置" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByLabelText("标签")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "是否启用" })).toBeChecked();
    await user.type(screen.getByLabelText("名称"), "商品发布场景");
    await user.click(screen.getByRole("button", { name: "添加主步骤" }));
    await user.clear(screen.getByLabelText("步骤名称"));
    await user.type(screen.getByLabelText("步骤名称"), "读取商品");
    await user.click(screen.getByRole("combobox", { name: "Server" }));
    await user.click(screen.getByRole("option", { name: "Price Server" }));
    await waitFor(() => expect(screen.getByLabelText("Tool")).not.toBeDisabled());
    await user.click(screen.getByRole("combobox", { name: "Tool" }));
    await user.click(screen.getByRole("option", { name: "get_price" }));
    await user.click(screen.getByLabelText("启用轮询"));
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(client.createTestCase).toHaveBeenCalledWith(projectId, expect.objectContaining({
      kind: "scenario", name: "商品发布场景", steps: [expect.objectContaining({
        id: expect.any(String), name: "读取商品", target: { connectionId, toolName: "get_price" },
        polling: expect.objectContaining({ intervalMs: 1000, maxAttempts: 10, timeoutMs: 30000 }),
      })], cleanupSteps: [], failurePolicy: "STOP",
    })));
    expect(screen.getByRole("button", { name: "场景配置" })).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps an existing scenario configuration expanded when saving fails", async () => {
    const updateTestCase = vi.fn().mockRejectedValue(new Error("offline"));
    const client = api({
      listTestCases: vi.fn().mockResolvedValue({ items: [{ id: testCaseId, projectId, kind: "scenario", name: "场景用例",
        description: "", tags: [], revision: 1, isEnabled: true, targetConnectionIds: [connectionId], createdAt: timestamp, updatedAt: timestamp }], nextCursor: null }),
      getTestCase: vi.fn().mockResolvedValue(existingScenarioDefinition), updateTestCase,
    });
    const user = userEvent.setup();
    render(<><AppToaster /><TestCasesPage api={client} projectId={projectId} /></>);
    await user.click(await screen.findByRole("button", { name: /场景用例/ }));
    const configuration = screen.getByRole("button", { name: "场景配置" });
    await user.click(configuration);
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateTestCase).toHaveBeenCalled());
    expect(configuration).toHaveAttribute("aria-expanded", "true");
  });

  it("creates and saves a single-Tool test without executing the Tool", async () => {
    const client = api();
    const user = userEvent.setup();
    render(<><AppToaster /><TestCasesPage api={client} projectId={projectId} /></>);

    expect(await screen.findByText("还没有测试用例")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "新建测试用例" }));
    expect(screen.queryByLabelText("标签")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "是否启用" })).toBeChecked();
    await user.type(screen.getByLabelText("名称"), "价格基线");
    await user.click(screen.getByRole("combobox", { name: "Server" }));
    await user.click(screen.getByRole("option", { name: "Price Server" }));
    await waitFor(() => expect(screen.getByLabelText("Tool")).not.toBeDisabled());
    await user.click(screen.getByRole("combobox", { name: "Tool" }));
    await user.click(screen.getByRole("option", { name: "get_price" }));
    const argumentsDisclosure = await screen.findByRole("button", { name: "请求参数" });
    expect(argumentsDisclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: "收起参数" })).not.toBeInTheDocument();
    expect(await screen.findByLabelText(/product_id/)).toBeVisible();
    await user.type(screen.getByLabelText(/product_id/), "42");
    const assertionsDisclosure = screen.getByRole("button", { name: "断言" });
    expect(assertionsDisclosure).toHaveAttribute("aria-expanded", "false");
    await user.click(assertionsDisclosure);
    await user.click(screen.getByRole("button", { name: "添加断言" }));
    await user.clear(screen.getByLabelText("期望值（JSON）"));
    await user.type(screen.getByLabelText("期望值（JSON）"), "12.5");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(client.createTestCase).toHaveBeenCalledWith(projectId, expect.objectContaining({
      kind: "tool", name: "价格基线", target: { connectionId, toolName: "get_price" },
      arguments: { product_id: "42" }, assertions: [{
        id: expect.any(String), source: "MCP_RESULT", path: "", operator: "EQUALS", expected: 12.5,
      }], timeoutMs: 30000,
    })));
    expect(client.startRun).toBeUndefined();
    expect(screen.getByRole("button", { name: "执行测试" })).toBeVisible();
    expect(argumentsDisclosure).toHaveAttribute("aria-expanded", "false");
  });

  it("searches assertion sources and operators through the shared searchable select", async () => {
    const user = userEvent.setup();
    render(<TestCasesPage api={api()} projectId={projectId} />);
    await screen.findByText("还没有测试用例");
    await user.click(screen.getByRole("button", { name: "新建测试用例" }));
    await user.click(screen.getByRole("button", { name: "断言" }));
    await user.click(screen.getByRole("button", { name: "添加断言" }));

    await user.click(screen.getByRole("combobox", { name: "数据源" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索断言数据源" }), "HTTP");
    await user.click(screen.getByRole("option", { name: "HTTP" }));
    expect(screen.getByRole("combobox", { name: "数据源" })).toHaveTextContent("HTTP");

    await user.click(screen.getByRole("combobox", { name: "运算符" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索断言运算符" }), "DURATION");
    await user.click(screen.getByRole("option", { name: "DURATION_LTE" }));
    expect(screen.getByRole("combobox", { name: "运算符" })).toHaveTextContent("DURATION_LTE");
  });

  it("searches Server and Tool targets while preserving their stable values", async () => {
    const client = api();
    const user = userEvent.setup();
    render(<TestCasesPage api={client} projectId={projectId} />);

    await screen.findByText("还没有测试用例");
    await user.click(screen.getByRole("button", { name: "新建测试用例" }));
    await user.click(screen.getByRole("combobox", { name: "Server" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索 Server" }), "price");
    await user.click(screen.getByRole("option", { name: "Price Server" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Tool" })).not.toBeDisabled());
    await user.click(screen.getByRole("combobox", { name: "Tool" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索 Tool" }), "GET_PRICE");
    await user.click(screen.getByRole("option", { name: "get_price" }));

    expect(screen.getByRole("combobox", { name: "Server" })).toHaveTextContent("Price Server");
    expect(screen.getByRole("combobox", { name: "Tool" })).toHaveTextContent("get_price");
    expect(screen.getByLabelText(/product_id/)).toBeVisible();
  });

  it("explains assertion purpose, setup, and syntax from the assertion heading", async () => {
    const user = userEvent.setup();
    render(<TestCasesPage api={api()} projectId={projectId} />);
    await screen.findByText("还没有测试用例");
    await user.click(screen.getByRole("button", { name: "新建测试用例" }));

    await user.click(screen.getByRole("button", { name: "断言" }));
    await user.click(screen.getByRole("button", { name: "了解断言设置" }));
    const dialog = screen.getByRole("dialog", { name: "断言设置说明" });
    expect(dialog).toHaveTextContent("断言的作用");
    expect(dialog).toHaveTextContent("如何设置断言");
    expect(dialog).toHaveTextContent("断言语法");
    expect(dialog).toHaveTextContent("$.structuredContent.items[0].id");
  });

  it("keeps the local draft when saving fails", async () => {
    const client = api({ createTestCase: vi.fn().mockRejectedValue(
      new InspectorApiError("TEST_TARGET_NOT_AVAILABLE", "Test target is unavailable", 409),
    ) });
    const user = userEvent.setup();
    render(<><AppToaster /><TestCasesPage api={client} projectId={projectId} /></>);
    await screen.findByText("还没有测试用例");
    await user.click(screen.getByRole("button", { name: "新建测试用例" }));
    await user.type(screen.getByLabelText("名称"), "保留这个草稿");
    await user.click(screen.getByRole("combobox", { name: "Server" }));
    await user.click(screen.getByRole("option", { name: "Price Server" }));
    await waitFor(() => expect(screen.getByLabelText("Tool")).not.toBeDisabled());
    await user.click(screen.getByRole("combobox", { name: "Tool" }));
    await user.click(screen.getByRole("option", { name: "get_price" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText(/目标 Server 或 Tool 当前不可用.*草稿已保留.*TEST_TARGET_NOT_AVAILABLE/)).toBeVisible();
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
    const user = userEvent.setup();
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
    await user.click(screen.getByRole("button", { name: "断言" }));
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
    await user.click(await screen.findByRole("button", { name: "删除" }));
    expect(screen.getByRole("dialog", { name: "删除测试用例？" })).toBeVisible();
    expect(deleteTestCase).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(deleteTestCase).toHaveBeenCalledWith(projectId, testCaseId));
  });

  it("runs a saved test and renders each assertion result without opening a debug Tab", async () => {
    const completed = { ...execution("PASSED"), steps: [{
      id: "00000000-0000-4000-8000-000000000108", executionId, stepId: "tool", position: 0,
      attempt: 1, status: "PASSED" as const, runId, workflowExecutionId: null,
      resolvedArguments: { product_id: "42" }, startedAt: timestamp, completedAt: timestamp,
      durationMs: 12, error: null,
    }] };
    const startTestExecution = vi.fn().mockResolvedValue(completed);
    const client = api({
      listTestCases: vi.fn().mockResolvedValue({ items: [{
        id: testCaseId, projectId, kind: "tool", name: "已有用例", description: "", tags: [], revision: 2,
        isEnabled: true, targetConnectionIds: [connectionId], createdAt: timestamp, updatedAt: timestamp,
      }], nextCursor: null }),
      getTestCase: vi.fn().mockResolvedValue(existingDefinition), startTestExecution,
      getRun: vi.fn().mockResolvedValue(completedRun),
    });
    const user = userEvent.setup();
    render(<><AppToaster /><TestCasesPage api={client} projectId={projectId} /></>);
    await user.click(await screen.findByRole("button", { name: /已有用例/ }));
    expect(screen.getByRole("button", { name: "执行结果" })).toHaveAttribute("aria-expanded", "false");
    await user.click(await screen.findByRole("button", { name: "执行测试" }));
    await waitFor(() => expect(startTestExecution).toHaveBeenCalledWith(projectId, testCaseId, expect.any(String), {}));
    expect(await screen.findByRole("button", { name: /执行结果.*通过/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText("通过").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("MCP_RESULT")).toBeVisible();
    expect(screen.getByText("/price")).toBeVisible();
    expect(await screen.findByRole("heading", { name: "响应结果（1）" })).toBeVisible();
    expect(client.getRun).toHaveBeenCalledWith(projectId, runId);
    expect(screen.getByRole("tab", { name: "请求与结果" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/^price/)).toBeVisible();
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
    expect(await screen.findByRole("button", { name: /执行结果.*已取消/ })).toBeVisible();
  });

  it("runs a saved scenario with JSON inputs and renders every step attempt", async () => {
    const completed: TestExecutionDetail = {
      ...execution("PASSED"), testCaseRevision: 1, definitionSnapshot: existingScenarioDefinition,
      inputs: { initial: 1 }, assertions: [{
        id: "00000000-0000-4000-8000-000000000120", executionId,
        stepRecordId: "00000000-0000-4000-8000-000000000108", position: 0,
        assertionId: "price", status: "PASSED", definition: {
          id: "price", source: "MCP_RESULT", path: "$.structuredContent.price", operator: "EQUALS", expected: 12.5,
        }, resolvedPath: "$.structuredContent.price", actual: 12.5, expected: 12.5,
        errorCode: null, message: null, durationMs: 1, isRedacted: false,
      }, {
        id: "00000000-0000-4000-8000-000000000124", executionId, stepRecordId: null, position: 1,
        assertionId: "scenario-final", status: "PASSED", definition: {
          id: "scenario-final", source: "RUN", path: "$.status", operator: "EQUALS", expected: "succeeded",
        }, resolvedPath: "$.status", actual: "succeeded", expected: "succeeded",
        errorCode: null, message: null, durationMs: 1, isRedacted: false,
      }], steps: [{
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
      getRun: vi.fn().mockResolvedValue(completedRun),
    });
    const user = userEvent.setup();
    render(<TestCasesPage api={client} projectId={projectId} />);
    await user.click(await screen.findByRole("button", { name: /场景用例/ }));
    expect(screen.getByRole("button", { name: "基本信息" })).toHaveAttribute("aria-expanded", "false");
    const configuration = screen.getByRole("button", { name: "场景配置" });
    expect(configuration).toHaveAttribute("aria-expanded", "false");
    const resultDisclosure = screen.getByRole("button", { name: "执行结果" });
    const historyDisclosure = screen.getAllByRole("button", { name: "执行历史" })
      .find((button) => button.hasAttribute("aria-expanded"));
    expect(resultDisclosure).toHaveAttribute("aria-expanded", "false");
    expect(historyDisclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("tablist", { name: "执行结果视图" })).not.toBeInTheDocument();
    const actions = screen.getByRole("button", { name: "执行场景" }).parentElement!;
    expect([...actions.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "执行场景", "执行历史", "保存", "取消", "删除",
    ]);
    await user.click(configuration);
    await user.type(await screen.findByLabelText("initial（JSON）"), "1");
    await user.click(screen.getByRole("button", { name: "执行场景" }));
    await waitFor(() => expect(startTestExecution).toHaveBeenCalledWith(
      projectId, testCaseId, expect.any(String), { inputs: { initial: 1 } },
    ));
    expect(await screen.findByRole("button", { name: /执行结果.*通过/ })).toHaveAttribute("aria-expanded", "true");
    const step = screen.getByRole("button", { name: /第一步.*尝试 1.*通过/ });
    expect(step).toBeVisible();
    expect(screen.getByText("点击左侧执行步骤查看详情")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "输入参数" })).not.toBeInTheDocument();
    await user.click(step);
    expect(screen.getByRole("heading", { name: "输入参数" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "响应结果" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "断言结果（1）" })).toBeVisible();
    expect(screen.getByText("$.structuredContent.price")).toBeVisible();
    await user.click(step);
    expect(screen.getByText("点击左侧执行步骤查看详情")).toBeVisible();
    const scenarioAssertions = screen.getByRole("button", { name: /场景断言.*1/ });
    expect(scenarioAssertions).toHaveAttribute("aria-expanded", "false");
    await user.click(scenarioAssertions);
    expect(scenarioAssertions).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("$.status")).toBeVisible();
  });

  it("always renders actual and expected assertion values with distinct empty, null, and redacted states", async () => {
    const valueExecution = { ...execution("FAILED"), assertions: [
      { id: "00000000-0000-4000-8000-000000000121", executionId, stepRecordId: null, position: 0,
        assertionId: "missing", status: "ERROR" as const,
        definition: { id: "missing", source: "MCP_RESULT" as const, path: "$.missing", operator: "EQUALS" as const, expected: 1 },
        resolvedPath: "$.missing", expected: 1, errorCode: "PATH_NOT_FOUND", message: null, durationMs: 1, isRedacted: false },
      { id: "00000000-0000-4000-8000-000000000122", executionId, stepRecordId: null, position: 1,
        assertionId: "null", status: "PASSED" as const,
        definition: { id: "null", source: "MCP_RESULT" as const, path: "$.nullable", operator: "IS_NULL" as const },
        resolvedPath: "$.nullable", actual: null, errorCode: null, message: null, durationMs: 1, isRedacted: false },
      { id: "00000000-0000-4000-8000-000000000123", executionId, stepRecordId: null, position: 2,
        assertionId: "secret", status: "ERROR" as const,
        definition: { id: "secret", source: "HTTP" as const, path: "$.authorization", operator: "EXISTS" as const },
        resolvedPath: "$.authorization", errorCode: "REDACTED", message: null, durationMs: 1, isRedacted: true },
    ] };
    const client = api({
      listTestCases: vi.fn().mockResolvedValue({ items: [{ id: testCaseId, projectId, kind: "tool", name: "已有用例",
        description: "", tags: [], revision: 2, isEnabled: true, targetConnectionIds: [connectionId], createdAt: timestamp, updatedAt: timestamp }], nextCursor: null }),
      getTestCase: vi.fn().mockResolvedValue(existingDefinition), startTestExecution: vi.fn().mockResolvedValue(valueExecution),
    });
    const user = userEvent.setup();
    render(<TestCasesPage api={client} projectId={projectId} />);
    await user.click(await screen.findByRole("button", { name: /已有用例/ }));
    await user.click(screen.getByRole("button", { name: "执行测试" }));
    expect(await screen.findAllByText("实际值")).toHaveLength(3);
    expect(screen.getAllByText("期望值")).toHaveLength(3);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("null")).toBeVisible();
    expect(screen.getByText("已脱敏")).toBeVisible();
  });

  it("shows the stable error code together with a scenario execution failure reason", () => {
    const failed: TestExecutionDetail = {
      ...execution("ERROR"), definitionSnapshot: existingScenarioDefinition,
      error: { code: "MCP_CONNECT_FAILED", message: "Unable to connect to MCP server" },
      steps: [], assertions: [],
    };

    render(<TestExecutionPanel execution={failed} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Unable to connect to MCP server");
    expect(alert).toHaveTextContent("MCP_CONNECT_FAILED");
  });

  it("opens case-scoped execution history and reuses the scenario result viewer", async () => {
    const historical = { ...execution("PASSED"), testCaseRevision: 1, definitionSnapshot: existingScenarioDefinition,
      steps: [{ id: "00000000-0000-4000-8000-000000000108", executionId, stepId: "first", position: 0,
        attempt: 1, status: "PASSED" as const, runId, workflowExecutionId: null, resolvedArguments: { product_id: "42" },
        startedAt: timestamp, completedAt: timestamp, durationMs: 12, error: null }], assertions: [] };
    const summary = { id: executionId, projectId, testCaseId, testCaseRevision: 1, testCaseName: "场景用例",
      testCaseKind: "scenario" as const, status: "PASSED" as const, assertionSummary: { total: 0, passed: 0, failed: 0, error: 0 },
      createdAt: timestamp, startedAt: timestamp, completedAt: timestamp, durationMs: 12, error: null };
    const client = api({
      listTestCases: vi.fn().mockResolvedValue({ items: [{ id: testCaseId, projectId, kind: "scenario", name: "场景用例",
        description: "", tags: [], revision: 1, isEnabled: true, targetConnectionIds: [connectionId], createdAt: timestamp, updatedAt: timestamp }], nextCursor: null }),
      getTestCase: vi.fn().mockResolvedValue(existingScenarioDefinition),
      listTestExecutions: vi.fn().mockResolvedValue({ items: [summary], nextCursor: null }),
      getTestExecution: vi.fn().mockResolvedValue(historical), getRun: vi.fn().mockResolvedValue(completedRun),
    });
    const user = userEvent.setup();
    render(<TestCasesPage api={client} projectId={projectId} />);
    await user.click(await screen.findByRole("button", { name: /场景用例/ }));
    const historyAction = screen.getAllByRole("button", { name: "执行历史" })
      .find((button) => !button.hasAttribute("aria-expanded"))!;
    await user.click(historyAction);
    const historyDisclosure = screen.getAllByRole("button", { name: "执行历史" })
      .find((button) => button.hasAttribute("aria-expanded"))!;
    expect(historyDisclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("tab", { name: "执行历史" })).not.toBeInTheDocument();
    expect(client.listTestExecutions).toHaveBeenCalledWith(projectId, { testCaseId, limit: 50 });
    await user.click(await screen.findByRole("button", { name: /场景用例.*通过/ }));
    expect(await screen.findByRole("button", { name: /第一步.*尝试 1.*通过/ })).toBeVisible();
    expect(client.getTestExecution).toHaveBeenCalledWith(projectId, executionId);
    expect(client.getRun).toHaveBeenCalledWith(projectId, runId);
    const historyContent = document.getElementById(historyDisclosure.getAttribute("aria-controls")!);
    expect(historyContent).not.toBeNull();
    expect(within(historyContent!).queryByRole("button", { name: /执行结果/ })).not.toBeInTheDocument();
  });
});
