import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
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

    await page.getByRole("button", { name: "测试报告" }).click();
    await page.getByRole("button", { name: /Echo smoke/ }).click();
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
    await page.getByLabel("为 Suite MCP 绑定 Server").selectOption(connectionId);
    await page.getByRole("combobox", { name: /冲突处理/ }).selectOption("COPY");
    await page.getByRole("button", { name: "确认导入" }).click();
    await expect(page.getByText(/已导入 1 个用例、1 个套件/)).toBeVisible();

    const casesAfterImport = await (await request.get(
      `${inspector.address.origin}/api/projects/${projectId}/test-cases`, { headers },
    )).json() as { items: Array<{ id: string }> };
    expect(casesAfterImport.items).toHaveLength(2);
  } finally {
    await inspector?.close();
    await mcp?.stop();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
