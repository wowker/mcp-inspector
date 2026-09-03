import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { startInspector } from "../dist/server/main.js";
import { inspectorApiHeaders } from "./session.js";
import { startStreamableMcpServer } from "../test-support/streamable-mcp-server.js";

interface InspectorRuntime { address: { origin: string }; close(): Promise<void> }

test("runs a persisted Tool test suite through the production UI", async ({ page, request }) => {
  const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-suite-e2e-"));
  let mcp: Awaited<ReturnType<typeof startStreamableMcpServer>> | undefined;
  let inspector: InspectorRuntime | undefined;
  try {
    mcp = await startStreamableMcpServer();
    let browserUrl = "";
    inspector = await startInspector({ host: "127.0.0.1", port: 0, dataRoot,
      installSignalHandlers: false, openBrowser: async (url) => { browserUrl = url; } });
    await page.goto(browserUrl);
    const headers = { ...(await inspectorApiHeaders(page, inspector.address.origin)), "Content-Type": "application/json" };
    await page.getByLabel("项目名称").fill("Suite E2E");
    await page.getByRole("button", { name: "创建并打开" }).click();
    const projects = await (await request.get(`${inspector.address.origin}/api/projects`, { headers })).json() as
      { projects: Array<{ id: string; name: string }> };
    const projectId = projects.projects.find(({ name }) => name === "Suite E2E")!.id;

    const connectionResponse = await request.post(`${inspector.address.origin}/api/projects/${projectId}/connections`, {
      headers, data: { name: "Suite MCP", url: mcp.url, transport: "streamable-http", authMode: "none",
        headers: {}, redactSensitiveInfo: true, timeoutMs: 10_000 },
    });
    expect(connectionResponse.status()).toBe(201);
    const connectionId = ((await connectionResponse.json()) as { connection: { id: string } }).connection.id;
    expect((await request.post(`${inspector.address.origin}/api/projects/${projectId}/connections/${connectionId}/connect`,
      { headers })).status()).toBe(200);
    expect((await request.post(`${inspector.address.origin}/api/projects/${projectId}/connections/${connectionId}/tools/refresh`,
      { headers })).status()).toBe(200);

    await page.getByRole("button", { name: "自动化测试" }).click();
    await page.getByRole("button", { name: "新建测试用例" }).click();
    await expect(page.getByRole("button", { name: "测试配置" })).toHaveAttribute("aria-expanded", "true");
    const basicsDisclosure = page.getByRole("button", { name: "基本信息" });
    await basicsDisclosure.click();
    await expect(basicsDisclosure).toHaveAttribute("aria-expanded", "false");
    await basicsDisclosure.hover();
    await expect(basicsDisclosure).toHaveCSS("background-color", "rgb(247, 246, 243)");
    await basicsDisclosure.click();
    await page.getByRole("combobox", { name: "Server" }).click();
    await page.getByRole("searchbox", { name: "搜索 Server" }).fill("Suite MCP");
    await page.getByRole("option", { name: "Suite MCP" }).click();
    await page.getByRole("combobox", { name: "Tool" }).click();
    await page.getByRole("searchbox", { name: "搜索 Tool" }).fill("echo");
    await expect(page.getByRole("option", { name: "echo" })).toBeVisible();
    expect((await new AxeBuilder({ page }).include(".searchable-select__popover")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.getByRole("option", { name: "echo" }).click();
    await expect(page.getByLabel("标签")).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "是否启用" })).toBeChecked();
    const enabledControl = page.locator(".testing-enabled");
    await expect(enabledControl.locator(".ui-switch__track")).toHaveCount(1);
    const enabledLabelBox = await enabledControl.locator(".ui-switch__label").boundingBox();
    expect(enabledLabelBox).not.toBeNull();
    expect(enabledLabelBox!.width).toBeGreaterThan(40);
    expect(enabledLabelBox!.height).toBeLessThan(30);
    await page.getByRole("button", { name: "断言" }).click();
    await page.getByRole("button", { name: "添加断言" }).click();
    await page.getByRole("combobox", { name: "运算符" }).click();
    await page.getByRole("searchbox", { name: "搜索断言运算符" }).fill("DURATION");
    await page.getByRole("option", { name: "DURATION_LTE", exact: true }).click();
    await page.getByRole("button", { name: "取消" }).click();

    const caseResponse = await request.post(`${inspector.address.origin}/api/projects/${projectId}/test-cases`, {
      headers, data: { kind: "tool", name: "Echo smoke", description: "", tags: ["smoke"], isEnabled: true,
        target: { connectionId, toolName: "echo" }, arguments: { message: "suite-ok" }, assertions: [], timeoutMs: 10_000 },
    });
    expect(caseResponse.status()).toBe(201);
    const testCaseId = ((await caseResponse.json()) as { testCase: { id: string } }).testCase.id;
    const suiteResponse = await request.post(`${inspector.address.origin}/api/projects/${projectId}/test-suites`, {
      headers, data: { name: "Smoke suite", description: "", tags: ["smoke"],
        members: [{ id: randomUUID(), testCaseId, position: 0, isEnabled: true }],
        executionPolicy: { concurrency: 1, stopOnFailure: true } },
    });
    expect(suiteResponse.status()).toBe(201);

    await page.getByRole("button", { name: "测试套件" }).click();
    await page.getByRole("button", { name: /Smoke suite/ }).click();
    await page.getByRole("button", { name: "执行套件" }).click();
    const report = page.locator(".suite-report");
    await expect(report).toBeVisible();
    await expect(report).toContainText("通过");
    await expect(report).toContainText("Echo smoke");

    await page.getByRole("button", { name: "自动化测试" }).click();
    await page.getByRole("button", { name: /Echo smoke/ }).first().click();
    await expect(page.getByRole("button", { name: "测试配置" })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "执行结果" })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "执行测试" }).click();
    await expect(page.getByRole("button", { name: /执行结果.*通过/ })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("heading", { name: "响应结果（1）" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "请求与结果" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("suite-ok", { exact: true }).first()).toBeVisible();

    const scenarioResponse = await request.post(`${inspector.address.origin}/api/projects/${projectId}/test-cases`, {
      headers, data: {
        kind: "scenario", name: "Echo scenario", description: "", tags: ["scenario"], isEnabled: true,
        inputs: [], failurePolicy: "STOP", assertions: [], cleanupSteps: [],
        steps: [{ id: "echo-step", name: "Echo step", target: { connectionId, toolName: "echo" },
          fixedArguments: { message: "scenario-ok" }, mappings: [], extractors: [], assertions: [],
          condition: null, polling: null, onFailure: "STOP" }],
      },
    });
    expect(scenarioResponse.status()).toBe(201);
    await page.getByRole("button", { name: "测试套件" }).click();
    await page.getByRole("button", { name: "自动化测试" }).click();
    await page.locator(".testing-case-list").getByRole("button", { name: /Echo scenario/ }).click();
    await expect(page.getByRole("button", { name: "场景配置" })).toHaveAttribute("aria-expanded", "false");
    const executionWorkspace = page.locator(".test-execution-workspace");
    await expect(executionWorkspace.getByRole("button", { name: "执行结果" })).toHaveAttribute("aria-expanded", "false");
    await expect(executionWorkspace.getByRole("button", { name: "执行历史" })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "执行场景" }).click();
    await expect(page.getByRole("button", { name: /执行结果.*通过/ })).toBeVisible();
    const scenarioStep = page.getByRole("button", { name: /Echo step.*尝试 1.*通过/ });
    await expect(scenarioStep).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("点击左侧执行步骤查看详情")).toBeVisible();
    await scenarioStep.click();
    await expect(scenarioStep).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("heading", { name: "输入参数" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "响应结果" })).toBeVisible();
    await expect(page.getByText("scenario-ok", { exact: true }).first()).toBeVisible();
    await scenarioStep.click();
    await expect(page.getByText("点击左侧执行步骤查看详情")).toBeVisible();

    await page.getByRole("article", { name: "编辑场景测试" }).getByRole("button", { name: "执行历史" }).click();
    await expect(executionWorkspace.getByRole("button", { name: "执行历史" })).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: /Echo scenario.*通过/ }).click();
    await expect(page.getByRole("button", { name: /Echo step.*尝试 1.*通过/ })).toBeVisible();

    await page.getByRole("button", { name: "测试报告" }).click();
    await page.getByRole("button", { name: /Echo smoke/ }).first().click();
    await expect(page.getByText(connectionId)).toBeVisible();
    await expect(page.getByText("Tool 快照 ID")).toBeVisible();

    const exportResponse = await request.get(
      `${inspector.address.origin}/api/projects/${projectId}/automated-tests/export`, { headers },
    );
    expect(exportResponse.status()).toBe(200);
    const envelope = await exportResponse.json();
    await page.getByLabel("选择自动化测试 JSON 文件").setInputFiles({
      name: "automated-tests.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(envelope)),
    });
    await page.getByRole("combobox", { name: "为 Suite MCP 绑定 Server" }).click();
    await page.getByRole("searchbox", { name: "搜索可绑定的 Server" }).fill("Suite MCP");
    await page.getByRole("option", { name: "Suite MCP" }).click();
    await page.getByRole("combobox", { name: /冲突处理/ }).selectOption("COPY");
    await page.getByRole("button", { name: "确认导入" }).click();
    await expect(page.getByText(/已导入 2 个用例、1 个套件/)).toBeVisible();

    for (const width of [320, 760, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("button", { name: "导出定义" })).toBeVisible();
      await expect(page.getByRole("button", { name: "导入定义" })).toBeVisible();
      await expect(page.getByRole("button", { name: "刷新" })).toBeVisible();
    }
    await page.getByRole("button", { name: "了解测试报告" }).click();
    await expect(page.getByRole("dialog", { name: "测试报告" })).toBeVisible();
    await page.getByRole("button", { name: "关闭测试报告说明" }).click();

    const casesAfterImport = await (await request.get(
      `${inspector.address.origin}/api/projects/${projectId}/test-cases`, { headers },
    )).json() as { items: Array<{ id: string }> };
    expect(casesAfterImport.items).toHaveLength(4);
  } finally {
    await inspector?.close();
    await mcp?.stop();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
