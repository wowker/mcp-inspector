import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startInspector } from "../dist/server/main.js";
import { startStreamableMcpServer } from "../test-support/streamable-mcp-server.js";

interface InspectorRuntime { address: { origin: string }; close(): Promise<void> }

test("eight same-Tool Tabs preserve out-of-order calls, traces, and reload state", async ({ page, request }) => {
  const dataRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-e2e-"));
  let mcp: Awaited<ReturnType<typeof startStreamableMcpServer>> | undefined;
  let browserUrl = "";
  let inspector: InspectorRuntime | undefined;
  let primaryFailure: unknown;
  try {
    mcp = await startStreamableMcpServer({ controlCalls: true });
    inspector = await startInspector({
      host: "127.0.0.1",
      port: 0,
      dataRoot,
      installSignalHandlers: false,
      openBrowser: async (url) => { browserUrl = url; },
    });
    const bootstrap = new URL(browserUrl);
    const token = bootstrap.searchParams.get("session")!;
    const apiHeaders = { Origin: inspector.address.origin, "X-DSers-Inspector-Session": token };
    expect((await request.get(`${inspector.address.origin}/api/health`, { headers: {
      Origin: inspector.address.origin, "X-DSers-Inspector-Session": "invalid-session",
    } })).status()).toBe(401);
    expect((await request.get(`${inspector.address.origin}/api/health`, { headers: {
      Origin: "https://attacker.example", "X-DSers-Inspector-Session": token,
    } })).status()).toBe(403);

    await page.goto(browserUrl);
    await expect(page.getByText("本地服务已就绪")).toBeVisible();
    await page.getByLabel("项目名称").fill("Core E2E");
    await page.getByRole("button", { name: "创建并打开" }).click();
    await expect(page.getByRole("heading", { name: "Servers", level: 1 })).toBeVisible();
    await expect(page.getByText("Core E2E")).toBeVisible();

    await page.getByRole("button", { name: "添加连接" }).click();
    const connectionDialog = page.getByRole("dialog", { name: "添加连接" });
    await expect(connectionDialog).toBeVisible();
    await connectionDialog.getByLabel("连接名称").fill("Loopback MCP");
    await connectionDialog.getByLabel("MCP URL").fill(mcp.url);
    await connectionDialog.getByLabel("请求超时（毫秒）").fill("60000");
    await connectionDialog.getByRole("button", { name: "保存连接" }).click();
    await expect(connectionDialog).toBeHidden();
    await expect(page.getByText(mcp.url)).toBeVisible();
    await page.getByRole("button", { name: "连接 Loopback MCP" }).click();
    await expect(page.getByRole("tab", { name: "Loopback MCP" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Tools", level: 1 })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "echo，当前" })).toBeVisible();
    const sumTool = page.getByRole("treeitem", { name: "sum，当前" });
    await expect(sumTool).toBeVisible();

    const titles = ["sum", ...Array.from({ length: 7 }, (_, index) => `sum (${index + 2})`)];
    for (let index = 0; index < 8; index += 1) {
      await sumTool.dblclick();
      await expect(page.getByRole("tab", { name: titles[index], exact: true })).toBeVisible();
    }
    const tabList = page.getByRole("tablist", { name: "Tool 调试 Tabs" });
    await expect(tabList.getByRole("tab")).toHaveCount(8);

    await page.getByRole("tab", { name: "sum", exact: true }).click();
    await page.getByRole("tab", { name: "Raw JSON" }).click();
    await page.getByLabel("完整 arguments JSON").fill("{}");
    await page.getByRole("tab", { name: "Form" }).click();
    await expect(page.getByRole("tab", { name: "Form" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel(/^a（必填）$/)).toBeVisible();
    await page.getByRole("button", { name: "Tool 定义" }).click();
    const definition = page.locator("article.tool-definition");
    await expect(definition.getByText("Add two numbers")).toBeVisible();
    await expect(definition.getByRole("table", { name: "Input Schema 字段" })).toContainText("a");
    await page.getByRole("button", { name: "调试" }).click();

    const inputs = Array.from({ length: 8 }, (_, index) => ({
      a: 100 + index,
      b: 1000 + index,
      total: 1100 + index * 2,
    }));
    for (let index = 0; index < 8; index += 1) {
      const tab = page.getByRole("tab", { name: titles[index], exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      if (index % 2 === 0) {
        await page.getByLabel(/^a（必填）$/).fill(String(inputs[index].a));
        await page.getByLabel(/^b（必填）$/).fill(String(inputs[index].b));
      } else {
        await page.getByRole("tab", { name: "Raw JSON" }).click();
        await page.getByLabel("完整 arguments JSON").fill(JSON.stringify(inputs[index], ["a", "b"]));
      }
    }

    const acceptedRuns: string[] = [];
    page.on("response", async (response) => {
      if (response.request().method() !== "POST" || !/\/api\/projects\/[^/]+\/runs$/.test(response.url()) || response.status() !== 202) return;
      const payload = await response.json() as { run: { id: string } };
      acceptedRuns.push(payload.run.id);
    });
    for (let index = 0; index < 8; index += 1) {
      const tab = page.getByRole("tab", { name: titles[index], exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await page.getByRole("button", { name: "执行", exact: true }).click();
    }
    await expect.poll(() => acceptedRuns.length).toBe(8);
    await expect.poll(() => mcp!.enteredTotals.length).toBe(8);
    expect(mcp.completedTotals).toEqual([]);
    expect(mcp.maxConcurrentCalls).toBe(8);
    for (const [released, input] of [...inputs].reverse().entries()) {
      mcp.release(input.total);
      await expect.poll(() => mcp!.completedTotals.length).toBe(released + 1);
      expect(mcp.completedTotals.at(-1)).toBe(input.total);
    }

    const runIds: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const tab = page.getByRole("tab", { name: titles[index], exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      const detail = page.locator("article.run-result");
      await expect(detail.locator(".run-status")).toHaveText("成功");
      await detail.getByRole("tab", { name: "格式化结果" }).click();
      const formattedResult = detail.locator(".json-block").filter({ hasText: "结构化内容" }).locator("pre");
      await expect(formattedResult).toContainText(`"total": ${inputs[index].total}`);
      for (const other of inputs.filter((_, otherIndex) => otherIndex !== index)) {
        await expect(formattedResult).not.toContainText(`"total": ${other.total}`);
      }
      const runId = await detail.locator(".run-metadata div").filter({ hasText: "Run ID" }).locator("dd").innerText();
      runIds.push(runId);

      await detail.getByRole("tab", { name: "RPC" }).click();
      await expect(detail.locator(".result-view")).toContainText("tools/call");
      await expect(detail.locator(".result-view")).toContainText(`"a": ${inputs[index].a}`);
      await expect(detail.locator(".result-view")).toContainText(`"b": ${inputs[index].b}`);
      for (const other of inputs.filter((_, otherIndex) => otherIndex !== index)) {
        await expect(detail.locator(".result-view")).not.toContainText(`"a": ${other.a}`);
        await expect(detail.locator(".result-view")).not.toContainText(`"b": ${other.b}`);
      }
      await detail.getByRole("tab", { name: "HTTP" }).click();
      await expect(detail.locator(".result-view")).toContainText("200");
    }
    expect(new Set(runIds).size).toBe(8);

    const reloadTab = page.getByRole("tab", { name: titles[5], exact: true });
    await reloadTab.click();
    await expect(reloadTab).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Servers", level: 1 })).toBeVisible();
    await page.getByRole("tab", { name: "Loopback MCP" }).click();
    await expect(page.getByRole("heading", { name: "Tools", level: 1 })).toBeVisible();
    await expect(tabList.getByRole("tab")).toHaveCount(8);
    await expect(page.getByRole("tab", { name: titles[5], exact: true })).toHaveAttribute("aria-selected", "true");
    for (let index = 0; index < 8; index += 1) {
      const tab = page.getByRole("tab", { name: titles[index], exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tab", { name: index % 2 === 0 ? "Form" : "Raw JSON" })).toHaveAttribute("aria-selected", "true");
      if (index % 2 === 0) {
        await expect(page.getByLabel(/^a（必填）$/)).toHaveValue(String(inputs[index].a));
        await expect(page.getByLabel(/^b（必填）$/)).toHaveValue(String(inputs[index].b));
      } else {
        const raw = await page.getByLabel("完整 arguments JSON").inputValue();
        expect(JSON.parse(raw)).toEqual({ a: inputs[index].a, b: inputs[index].b });
      }
      await page.locator("article.run-result").getByRole("tab", { name: "格式化结果" }).click();
      await expect(page.locator("article.run-result .json-block").filter({ hasText: "结构化内容" }).locator("pre"))
        .toContainText(`"total": ${inputs[index].total}`);
    }

    await page.getByRole("button", { name: "运行历史" }).click();
    const history = page.getByRole("region", { name: "项目运行历史" });
    await expect(history.locator("li")).toHaveCount(8);
    const historyIds = await history.locator("li button span:first-child").allTextContents();
    expect(new Set(historyIds).size).toBe(8);
    expect(new Set(historyIds)).toEqual(new Set(runIds));
    await history.locator("li button").first().click();
    await expect(page.locator("article.run-result")).toBeVisible();

    const projectsResponse = await request.get(`${inspector.address.origin}/api/projects`, { headers: apiHeaders });
    const projects = await projectsResponse.json() as { projects: Array<{ id: string }> };
    const projectId = projects.projects[0].id;
    const runsResponse = await request.get(`${inspector.address.origin}/api/projects/${projectId}/runs`, { headers: apiHeaders });
    const runs = await runsResponse.json() as { runs: Array<{ id: string; status: string; createdAt: string }> };
    expect(runs.runs).toHaveLength(8);
    expect(runs.runs.every(({ status }) => status === "succeeded")).toBe(true);
    expect(runs.runs).toEqual([...runs.runs].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)));
    for (const { id } of runs.runs) {
      const detailResponse = await request.get(`${inspector.address.origin}/api/projects/${projectId}/runs/${id}`, { headers: apiHeaders });
      const payload = await detailResponse.json() as { run: { events: Array<{ sequence: number; kind: string; payload: unknown }> } };
      const sequences = payload.run.events.map(({ sequence }) => sequence);
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
      expect(new Set(sequences).size).toBe(sequences.length);
      const rpcRequests = payload.run.events.filter(({ kind, payload: eventPayload }) => kind === "rpc-out" &&
        JSON.stringify(eventPayload).includes("tools/call"));
      expect(rpcRequests).toHaveLength(1);
      expect(payload.run.events.filter(({ kind }) => kind === "http-request")).toHaveLength(1);
      expect(payload.run.events.filter(({ kind }) => kind === "http-response")).toHaveLength(1);
      const terminalStatuses = new Set(["succeeded", "failed", "cancelled", "interrupted"]);
      const terminalEvents = payload.run.events.filter(({ kind, payload: eventPayload }) => kind === "run-status" &&
        typeof eventPayload === "object" && eventPayload !== null &&
        terminalStatuses.has(String((eventPayload as { status?: string }).status)));
      expect(terminalEvents).toHaveLength(1);
      expect(payload.run.events.filter(({ kind }) => kind === "run-error")).toHaveLength(0);
    }
  } catch (error) {
    primaryFailure = error;
  } finally {
    const cleanupErrors: unknown[] = [];
    try { await page.close(); } catch (error) { cleanupErrors.push(error); }
    try { mcp?.releaseAll(); } catch (error) { cleanupErrors.push(error); }
    const closeResults = await Promise.allSettled([
      inspector?.close() ?? Promise.resolve(),
      mcp?.stop() ?? Promise.resolve(),
    ]);
    for (const result of closeResults) if (result.status === "rejected") cleanupErrors.push(result.reason);
    try { rmSync(dataRoot, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
    if (primaryFailure !== undefined || cleanupErrors.length > 0) {
      throw new AggregateError([
        ...(primaryFailure === undefined ? [] : [primaryFailure]),
        ...cleanupErrors,
      ], primaryFailure === undefined ? "E2E cleanup failed" : "E2E failed and cleanup was incomplete");
    }
  }
});
