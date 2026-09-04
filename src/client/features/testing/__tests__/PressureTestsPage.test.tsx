// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient } from "../../../api/api-client.js";
import { i18n } from "../../../i18n/index.js";
import { PressureTestsPage } from "../PressureTestsPage.js";

const projectId = "00000000-0000-4000-8000-000000005601";
const testCaseId = "00000000-0000-4000-8000-000000005602";
const pressureTestId = "00000000-0000-4000-8000-000000005603";
const timestamp = "2026-09-04T00:00:00.000Z";
const testCase = { id: testCaseId, projectId, kind: "tool" as const, name: "查询库存", description: "", tags: [],
  revision: 1, isEnabled: true, targetConnectionIds: [], createdAt: timestamp, updatedAt: timestamp };
const definition = { id: pressureTestId, projectId, name: "库存压测", description: "", revision: 1,
  target: { testCaseId }, inputs: {},
  load: { virtualUsers: 2, rampUpMs: 0, durationMs: 10_000, thinkTimeMs: 0, maxIterations: 10 },
  thresholds: { maxErrorRate: 0.01, maxP95DurationMs: 500, minRequestsPerSecond: 1, stopOnErrorRate: true },
  createdAt: timestamp, updatedAt: timestamp };

describe("PressureTestsPage", () => {
  beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });
  afterEach(cleanup);

  it("creates a bounded pressure plan targeting one enabled test case", async () => {
    const createPressureTest = vi.fn(async (_projectId, input) => ({ ...input, id: pressureTestId,
      projectId, revision: 1, createdAt: timestamp, updatedAt: timestamp }));
    const api = { listPressureTests: vi.fn(async () => ({ items: [], nextCursor: null })),
      listTestCases: vi.fn(async () => ({ items: [testCase], nextCursor: null })), createPressureTest,
    } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<PressureTestsPage api={api} projectId={projectId} />);
    await screen.findByText("还没有压测方案");
    await user.click(screen.getByRole("button", { name: "新建压测方案" }));
    expect(screen.getByRole("spinbutton", { name: "虚拟用户数" })).toHaveAttribute("max", "20");
    expect(screen.getByRole("spinbutton", { name: "最大调用次数" })).toHaveAttribute("max", "1000");
    await user.type(screen.getByLabelText("名称"), "库存压测");
    await user.selectOptions(screen.getByLabelText("目标测试用例"), testCaseId);
    await user.click(screen.getByRole("button", { name: "保存压测方案" }));
    expect(createPressureTest).toHaveBeenCalledWith(projectId, expect.objectContaining({
      name: "库存压测", target: { testCaseId }, load: expect.objectContaining({ virtualUsers: 1, maxIterations: 100 }),
    }));
  });

  it("shows the complete call scope before retrying a destructive pressure test", async () => {
    const execution = { id: "00000000-0000-4000-8000-000000005604", projectId, pressureTestId,
      pressureTestRevision: 1, definitionSnapshot: definition,
      targetSnapshot: { id: testCaseId, name: testCase.name, kind: "tool" as const, revision: 1 },
      status: "PASSED" as const, summary: { total: 0, passed: 0, failed: 0, errors: 0, cancelled: 0,
        errorRate: 0, averageRequestsPerSecond: 0, peakRequestsPerSecond: 0,
        duration: { minMs: 0, maxMs: 0, averageMs: 0, p50Ms: 0, p90Ms: 0, p95Ms: 0, p99Ms: 0 },
        thresholds: [{ metric: "ERROR_RATE" as const, target: .01, actual: 0, passed: true },
          { metric: "P95_DURATION" as const, target: 500, actual: 0, passed: true },
          { metric: "REQUESTS_PER_SECOND" as const, target: 1, actual: 0, passed: false }] },
      error: null, createdAt: timestamp, startedAt: timestamp, completedAt: timestamp, durationMs: 0 };
    const start = vi.fn().mockRejectedValueOnce(new Error("Destructive Tool confirmation is required"))
      .mockResolvedValueOnce(execution);
    const api = { listPressureTests: vi.fn(async () => ({ items: [definition], nextCursor: null })),
      listTestCases: vi.fn(async () => ({ items: [testCase], nextCursor: null })),
      getPressureTest: vi.fn(async () => definition), startPressureTestExecution: start,
      listPressureTestSamples: vi.fn(async () => ({ items: [], nextCursor: null })),
    } as unknown as InspectorApiClient;
    const user = userEvent.setup(); render(<PressureTestsPage api={api} projectId={projectId} />);
    await user.click(await screen.findByRole("button", { name: /库存压测/ }));
    await user.click(screen.getByRole("button", { name: "开始压测" }));
    expect(await screen.findByRole("dialog", { name: "对破坏性 Tool 执行压力测试？" })).toHaveTextContent("10 次");
    await user.click(screen.getByRole("button", { name: "确认并开始压测" }));
    expect(start).toHaveBeenLastCalledWith(projectId, pressureTestId, expect.any(String), { confirmDestructive: true });
  });
});
