// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient } from "../../../api/api-client.js";
import { i18n } from "../../../i18n/index.js";
import { TestSuitesPage } from "../TestSuitesPage.js";

const projectId = "00000000-0000-4000-8000-000000000911";
const testCaseId = "00000000-0000-4000-8000-000000000912";
const suiteId = "00000000-0000-4000-8000-000000000913";
const memberId = "00000000-0000-4000-8000-000000000914";
const suite = {
  id: suiteId, projectId, name: "核心流程", description: "", tags: [], revision: 1,
  members: [{ id: memberId, testCaseId, position: 0, isEnabled: true }],
  executionPolicy: { concurrency: 1, stopOnFailure: false },
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
};
const suiteSummary = { ...suite, memberCount: 1 };
const toolCase = { id: testCaseId, projectId, kind: "tool" as const, name: "List stores", description: "", tags: [],
  revision: 1, isEnabled: true, target: { connectionId: "00000000-0000-4000-8000-000000000916", toolName: "list_stores" },
  arguments: {}, assertions: [], timeoutMs: 10_000,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };

describe("TestSuitesPage", () => {
  beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });
  afterEach(cleanup);

  it("uses the compact testing module header", async () => {
    const api = {
      listTestSuites: vi.fn(async () => ({ items: [], nextCursor: null })),
      listTestCases: vi.fn(async () => ({ items: [], nextCursor: null })),
    } as unknown as InspectorApiClient;
    const { container } = render(<TestSuitesPage api={api} projectId={projectId} />);

    await screen.findByText("还没有测试套件");
    expect(container.querySelector(".testing-page__heading--compact")).toContainElement(
      screen.getByRole("heading", { name: "测试套件", level: 1 }),
    );
  });

  it("creates a suite from selected test cases", async () => {
    let savedSuite: any = null;
    const createTestSuite = vi.fn(async (_projectId, definition: any) => {
      savedSuite = { ...definition, id: "00000000-0000-4000-8000-000000000913", projectId, revision: 1,
        createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
      return savedSuite;
    });
    const api = {
      listTestSuites: vi.fn(async () => ({ items: [], nextCursor: null })),
      listTestCases: vi.fn(async () => ({ items: [{ id: testCaseId, projectId, kind: "tool", name: "List stores",
        description: "", tags: [], revision: 1, isEnabled: true, targetConnectionIds: [],
        createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }], nextCursor: null })),
      createTestSuite,
      getTestSuite: vi.fn(async () => savedSuite),
    } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<TestSuitesPage api={api} projectId={projectId} />);
    await screen.findByText("还没有测试套件");
    await user.click(screen.getByRole("button", { name: "新建测试套件" }));
    await screen.findByText("List stores");
    await user.type(screen.getByLabelText("名称"), "核心流程");
    await user.click(screen.getByLabelText(/List stores/));
    await user.click(screen.getByRole("button", { name: "保存测试用例" }));
    expect(createTestSuite).toHaveBeenCalledWith(projectId, expect.objectContaining({
      name: "核心流程", members: [expect.objectContaining({ testCaseId, position: 0 })],
    }));
  });

  it("confirms the complete suite scope before retrying a destructive execution", async () => {
    const startTestSuiteExecution = vi.fn()
      .mockRejectedValueOnce(new Error("Destructive Tool confirmation is required"))
      .mockResolvedValueOnce({ id: "00000000-0000-4000-8000-000000000915", projectId, suiteId,
        suiteRevision: 1, status: "PASSED", suiteSnapshot: suite,
        summary: { total: 1, passed: 1, failed: 0, errors: 0, cancelled: 0 }, error: null,
        createdAt: "2026-09-01T00:00:00.000Z", startedAt: "2026-09-01T00:00:00.000Z",
        completedAt: "2026-09-01T00:00:01.000Z", durationMs: 1_000, items: [] });
    const api = {
      listTestSuites: vi.fn(async () => ({ items: [suiteSummary], nextCursor: null })),
      listTestCases: vi.fn(async () => ({ items: [], nextCursor: null })),
      getTestSuite: vi.fn(async () => suite), getTestCase: vi.fn(async () => toolCase), startTestSuiteExecution,
    } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<TestSuitesPage api={api} projectId={projectId} />);
    await user.click(await screen.findByRole("button", { name: /核心流程/ }));
    await user.click(screen.getByRole("button", { name: "执行套件" }));
    expect(await screen.findByRole("dialog", { name: "执行包含破坏性 Tool 的测试套件？" }))
      .toHaveTextContent("核心流程");
    await user.click(screen.getByRole("button", { name: "确认执行" }));
    expect(startTestSuiteExecution).toHaveBeenLastCalledWith(projectId, suiteId, expect.any(String),
      { confirmDestructive: true });
  });

  it("deletes a selected suite only after confirmation", async () => {
    const deleteTestSuite = vi.fn(async () => undefined);
    const api = {
      listTestSuites: vi.fn(async () => ({ items: [suiteSummary], nextCursor: null })),
      listTestCases: vi.fn(async () => ({ items: [], nextCursor: null })),
      getTestSuite: vi.fn(async () => suite), getTestCase: vi.fn(async () => toolCase), deleteTestSuite,
    } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<TestSuitesPage api={api} projectId={projectId} />);
    await user.click(await screen.findByRole("button", { name: /核心流程/ }));
    await user.click(screen.getByRole("button", { name: "删除套件" }));
    expect(deleteTestSuite).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(deleteTestSuite).toHaveBeenCalledWith(projectId, suiteId);
  });

  it("keeps scenario inputs isolated by suite member and sends parsed JSON values", async () => {
    const scenarioCase = { ...toolCase, kind: "scenario" as const,
      inputs: [{ name: "store_id", description: "Target store", isRequired: true }],
      steps: [{ id: "step-1", name: "List stores", target: toolCase.target, fixedArguments: {}, mappings: [],
        extractors: [], assertions: [], condition: null, polling: null, onFailure: "STOP" as const }],
      cleanupSteps: [], failurePolicy: "STOP" as const };
    const execution = { id: "00000000-0000-4000-8000-000000000917", projectId, suiteId,
      suiteRevision: 1, status: "PASSED" as const, suiteSnapshot: suite,
      summary: { total: 1, passed: 1, failed: 0, errors: 0, cancelled: 0 }, error: null,
      createdAt: "2026-09-01T00:00:00.000Z", startedAt: "2026-09-01T00:00:00.000Z",
      completedAt: "2026-09-01T00:00:01.000Z", durationMs: 1_000, items: [] };
    const startTestSuiteExecution = vi.fn(async () => execution);
    const api = {
      listTestSuites: vi.fn(async () => ({ items: [suiteSummary], nextCursor: null })),
      listTestCases: vi.fn(async () => ({ items: [{ ...suiteSummary, id: testCaseId, kind: "scenario",
        targetConnectionIds: [toolCase.target.connectionId] }], nextCursor: null })),
      getTestSuite: vi.fn(async () => suite), getTestCase: vi.fn(async () => scenarioCase), startTestSuiteExecution,
    } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<TestSuitesPage api={api} projectId={projectId} />);
    await user.click(await screen.findByRole("button", { name: /核心流程/ }));
    await user.type(await screen.findByLabelText(/store_id/), '"200330"');
    await user.click(screen.getByRole("button", { name: "执行套件" }));
    expect(startTestSuiteExecution).toHaveBeenCalledWith(projectId, suiteId, expect.any(String), {
      inputsByMember: { [memberId]: { store_id: "200330" } },
    });
  });
});
