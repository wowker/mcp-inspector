import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { startInspector } from "../dist/server/main.js";
import { startStreamableMcpServer } from "../test-support/streamable-mcp-server.js";
import { inspectorApiHeaders } from "./session.js";

interface InspectorRuntime { address: { origin: string }; close(): Promise<void> }
type Headers = Record<string, string>;

async function waitForRun(request: APIRequestContext, origin: string, headers: Headers,
  projectId: string, runId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await request.get(`${origin}/api/projects/${projectId}/runs/${runId}`, { headers });
    expect(response.status()).toBe(200);
    const run = (await response.json() as { run: Record<string, unknown> }).run;
    if (["succeeded", "failed", "cancelled", "interrupted"].includes(String(run.status))) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Run did not reach a terminal state");
}

test("history preflight, confirmed replay, pinning, and ignored comparison survive reload", async ({ page, request }) => {
  const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-replay-e2e-"));
  const mcp = await startStreamableMcpServer({ comparisonMode: true });
  let inspector: InspectorRuntime | undefined;
  let primaryFailure: unknown;
  try {
    let browserUrl = "";
    inspector = await startInspector({ host: "127.0.0.1", port: 0, dataRoot,
      installSignalHandlers: false, openBrowser: async (url) => { browserUrl = url; } });
    await page.goto(browserUrl);
    const headers = await inspectorApiHeaders(page, inspector.address.origin);
    await page.getByLabel("项目名称").fill("Replay comparison E2E");
    await page.getByRole("button", { name: "创建并打开" }).click();
    await page.getByRole("button", { name: "添加连接" }).click();
    const connectionDialog = page.getByRole("dialog", { name: "添加连接" });
    await connectionDialog.getByLabel("连接名称").fill("Replay MCP");
    await connectionDialog.getByLabel("MCP URL").fill(mcp.url);
    await connectionDialog.getByRole("button", { name: "保存连接" }).click();
    await page.getByRole("button", { name: "连接 Replay MCP" }).click();
    await expect(page.getByRole("button", { name: "sum", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "sum", exact: true }).dblclick();
    await page.getByLabel(/^a(?:\s|\*)*必填$/).fill("7");
    await page.getByLabel(/^b(?:\s|\*)*必填$/).fill("8");
    await page.getByRole("button", { name: "执行", exact: true }).click();
    await expect(page.locator("article.run-result").locator(".run-status")).toHaveText("成功");

    const projects = await (await request.get(`${inspector.address.origin}/api/projects`, { headers })).json() as
      { projects: Array<{ id: string }> };
    const projectId = projects.projects[0]!.id;
    const connections = await (await request.get(
      `${inspector.address.origin}/api/projects/${projectId}/connections`, { headers })).json() as
      { connections: Array<{ id: string }> };
    const connectionId = connections.connections[0]!.id;
    const firstPage = await (await request.get(`${inspector.address.origin}/api/projects/${projectId}/runs`, { headers })).json() as
      { runs: Array<{ id: string }> };
    const sourceRunId = firstPage.runs[0]!.id;
    const oldPreflight = await (await request.get(
      `${inspector.address.origin}/api/projects/${projectId}/runs/${sourceRunId}/replay-preflight`, { headers })).json() as
      { preflight: { digest: string } };

    mcp.updateSumSchema();
    expect((await request.post(
      `${inspector.address.origin}/api/projects/${projectId}/connections/${connectionId}/tools/refresh`, { headers })).status()).toBe(200);
    const stale = await request.post(
      `${inspector.address.origin}/api/projects/${projectId}/runs/${sourceRunId}/replay`, {
        headers: { ...headers, "Content-Type": "application/json" },
        data: { idempotencyKey: randomUUID(), preflightDigest: oldPreflight.preflight.digest,
          confirmSchemaDrift: true, confirmSideEffects: true },
      });
    expect(stale.status()).toBe(409);
    expect((await stale.json() as { error: { code: string } }).error.code).toBe("REPLAY_STALE_PREFLIGHT");
    expect(mcp.completedTotals).toHaveLength(1);

    await page.getByRole("button", { name: "运行历史" }).click();
    await page.getByRole("button", { name: `固定运行 ${sourceRunId}` }).click();
    await page.getByRole("button", { name: `打开运行 ${sourceRunId}` }).click();
    await expect(page.locator(".history-page__detail article.run-result")).toBeVisible();
    await page.getByRole("button", { name: "回放", exact: true }).click();
    const replayDialog = page.getByRole("dialog", { name: "确认回放 Tool" });
    await expect(replayDialog.getByRole("heading", { name: "Schema 变化" })).toBeVisible();
    await replayDialog.getByLabel("我已了解本次调用可能产生副作用").check();
    await replayDialog.getByLabel("我已检查 Schema 变化并确认继续").check();
    await replayDialog.getByRole("button", { name: "开始回放" }).click();

    await expect.poll(() => mcp.completedTotals.length).toBe(2);
    const secondPage = await (await request.get(`${inspector.address.origin}/api/projects/${projectId}/runs`, { headers })).json() as
      { runs: Array<{ id: string; replayedFromRunId: string | null }> };
    const replayRunId = secondPage.runs.find(({ replayedFromRunId }) => replayedFromRunId === sourceRunId)!.id;
    const replayRun = await waitForRun(request, inspector.address.origin, headers, projectId, replayRunId);
    expect(replayRun.status).toBe("succeeded");
    expect(replayRun.replayedFromRunId).toBe(sourceRunId);
    expect((replayRun.request as { arguments: unknown }).arguments).toEqual({ a: 7, b: 8 });
    expect((replayRun.events as Array<{ kind: string }>).filter(({ kind }) => kind === "http-request")).toHaveLength(1);

    await expect(page.getByRole("button", { name: "对比来源" })).toBeVisible();
    await page.getByRole("button", { name: "对比来源" }).click();
    const comparisonDialog = page.getByRole("dialog", { name: "对比回放结果" });
    await expect(comparisonDialog.getByText("/structuredContent/requestId")).toBeVisible();
    const rules = comparisonDialog.getByRole("textbox", { name: "项目对比忽略规则" });
    await rules.fill('$["structuredContent"]["requestId"]');
    await comparisonDialog.getByRole("button", { name: "预览" }).click();
    await expect(comparisonDialog.getByRole("heading", { name: /已忽略变化 1/ })).toBeVisible();
    await comparisonDialog.getByRole("button", { name: "保存规则" }).click();
    await expect(page.getByText("忽略规则已保存")).toBeVisible();

    await page.reload();
    const comparison = await (await request.get(
      `${inspector.address.origin}/api/projects/${projectId}/runs/${replayRunId}/comparison`, { headers })).json() as
      { comparison: { ruleExpressions: string[]; diff: { changes: Array<{ path: string; ignored: boolean }> } } };
    expect(comparison.comparison.ruleExpressions).toEqual(['$["structuredContent"]["requestId"]']);
    expect(comparison.comparison.diff.changes).toContainEqual(expect.objectContaining({
      path: "/structuredContent/requestId", ignored: true,
    }));
    const source = await waitForRun(request, inspector.address.origin, headers, projectId, sourceRunId);
    expect(source.pinned).toBe(true);
  } catch (error) {
    primaryFailure = error;
  } finally {
    const cleanupErrors: unknown[] = [];
    try { await page.close(); } catch (error) { cleanupErrors.push(error); }
    const closed = await Promise.allSettled([inspector?.close() ?? Promise.resolve(), mcp.stop()]);
    for (const result of closed) if (result.status === "rejected") cleanupErrors.push(result.reason);
    try { rmSync(dataRoot, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length > 0) throw new AggregateError([
      ...(primaryFailure === undefined ? [] : [primaryFailure]), ...cleanupErrors,
    ], primaryFailure === undefined ? "E2E cleanup failed" : "E2E failed and cleanup was incomplete");
    if (primaryFailure !== undefined) throw primaryFailure;
  }
});
