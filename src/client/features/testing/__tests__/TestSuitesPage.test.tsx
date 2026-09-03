// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient } from "../../../api/api-client.js";
import { AppToaster } from "../../../app/AppToaster.js";
import { i18n } from "../../../i18n/index.js";
import { TestSuitesPage } from "../TestSuitesPage.js";

const projectId = "00000000-0000-4000-8000-000000000911";
const testCaseId = "00000000-0000-4000-8000-000000000912";
const suiteId = "00000000-0000-4000-8000-000000000913";
const memberId = "00000000-0000-4000-8000-000000000914";
const secondTestCaseId = "00000000-0000-4000-8000-000000000918";
const secondMemberId = "00000000-0000-4000-8000-000000000919";
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
    const list = screen.getByRole("complementary", { name: "套件" });
    expect(list).toContainElement(screen.getByRole("button", { name: "新建测试套件" }));
    expect(container.querySelector(".testing-page__heading--compact")).not.toContainElement(
      screen.getByRole("button", { name: "新建测试套件" }),
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
    const user = userEvent.setup(); render(<><AppToaster /><TestSuitesPage api={api} projectId={projectId} /></>);
    await screen.findByText("还没有测试套件");
    await user.click(screen.getByRole("button", { name: "新建测试套件" }));
    expect(screen.getByRole("spinbutton", { name: "并发数" })).toHaveAttribute("min", "1");
    expect(screen.getByRole("spinbutton", { name: "并发数" })).toHaveAttribute("max", "8");
    await screen.findByText("List stores");
    await user.type(screen.getByLabelText("名称"), "核心流程");
    await user.click(screen.getByRole("button", { name: "添加成员 List stores" }));
    expect(screen.getByRole("region", { name: "已添加成员" })).toHaveTextContent("List stores");
    await user.click(screen.getByRole("button", { name: "保存测试套件" }));
    expect(createTestSuite).toHaveBeenCalledWith(projectId, expect.objectContaining({
      name: "核心流程", members: [expect.objectContaining({ testCaseId, position: 0 })],
    }));
  });

  it("orders suite actions and reorders stable members by drag or keyboard before saving", async () => {
    const reorderedSuite = { ...suite, members: [
      { id: memberId, testCaseId, position: 0, isEnabled: true },
      { id: secondMemberId, testCaseId: secondTestCaseId, position: 1, isEnabled: true },
    ] };
    const updateTestSuite = vi.fn(async (_projectId, _suiteId, input: any) => ({
      ...reorderedSuite, ...input.definition, revision: 2, executionPolicy: input.definition.executionPolicy,
    }));
    const api = {
      listTestSuites: vi.fn(async () => ({ items: [{ ...suiteSummary, memberCount: 2 }], nextCursor: null })),
      listTestCases: vi.fn(async () => ({ items: [
        { ...toolCase, targetConnectionIds: [toolCase.target.connectionId] },
        { ...toolCase, id: secondTestCaseId, name: "Get product", targetConnectionIds: [toolCase.target.connectionId] },
      ], nextCursor: null })),
      getTestSuite: vi.fn(async () => reorderedSuite), getTestCase: vi.fn(async () => toolCase), updateTestSuite,
    } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<TestSuitesPage api={api} projectId={projectId} />);
    await user.click(await screen.findByRole("button", { name: /核心流程/ }));

    const actions = screen.getByRole("button", { name: "执行套件" }).parentElement!;
    expect([...actions.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "执行套件", "保存测试套件", "删除套件",
    ]);
    expect(screen.getByRole("spinbutton", { name: "并发数" })).toHaveValue(1);
    fireEvent.change(screen.getByRole("spinbutton", { name: "并发数" }), { target: { value: "4" } });

    const first = screen.getByRole("listitem", { name: "套件成员 List stores" });
    const second = screen.getByRole("listitem", { name: "套件成员 Get product" });
    fireEvent.dragStart(second);
    fireEvent.dragOver(first);
    fireEvent.drop(first);
    expect(screen.getAllByRole("listitem", { name: /套件成员/ }).map((item) => item.getAttribute("aria-label"))).toEqual([
      "套件成员 Get product", "套件成员 List stores",
    ]);
    await user.click(screen.getByRole("button", { name: "下移成员 Get product" }));
    await user.click(screen.getByRole("button", { name: "保存测试套件" }));
    await waitFor(() => expect(updateTestSuite).toHaveBeenCalledWith(projectId, suiteId, expect.objectContaining({
      definition: expect.objectContaining({
        executionPolicy: { concurrency: 4, stopOnFailure: false },
        members: [
          expect.objectContaining({ id: memberId, position: 0 }),
          expect.objectContaining({ id: secondMemberId, position: 1 }),
        ],
      }),
    })));
  });

  it("explains why a new suite cannot be saved without members", async () => {
    const api = {
      listTestSuites: vi.fn(async () => ({ items: [], nextCursor: null })),
      listTestCases: vi.fn(async () => ({ items: [], nextCursor: null })),
      createTestSuite: vi.fn(),
    } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<><AppToaster /><TestSuitesPage api={api} projectId={projectId} /></>);
    await screen.findByText("还没有测试套件");
    await user.click(screen.getByRole("button", { name: "新建测试套件" }));
    await user.type(screen.getByLabelText("名称"), "空套件");
    await user.click(screen.getByRole("button", { name: "保存测试套件" }));

    expect(await screen.findByText("请至少添加一个测试用例作为套件成员。草稿已保留。")).toBeVisible();
    expect(api.createTestSuite).not.toHaveBeenCalled();
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
