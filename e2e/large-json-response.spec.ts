import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startInspector } from "../dist/server/main.js";
import { startStreamableMcpServer } from "../test-support/streamable-mcp-server.js";

interface InspectorRuntime { address: { origin: string }; close(): Promise<void> }

test("renders a real 10 MB MCP JSON response through the decode Worker", async ({ page }) => {
  const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-large-json-"));
  let browserUrl = "";
  let inspector: InspectorRuntime | undefined;
  let mcp: Awaited<ReturnType<typeof startStreamableMcpServer>> | undefined;
  try {
    mcp = await startStreamableMcpServer({ largeResponseBytes: 10 * 1024 * 1024 });
    inspector = await startInspector({
      host: "127.0.0.1", port: 0, dataRoot, installSignalHandlers: false,
      openBrowser: async (url) => { browserUrl = url; },
    });
    let workerRequested = false;
    page.on("request", (request) => {
      if (request.url().includes("run-detail-worker-")) workerRequested = true;
    });
    await page.goto(browserUrl);
    await page.getByLabel("项目名称").fill("Large JSON E2E");
    await page.getByRole("button", { name: "创建并打开" }).click();
    await page.getByRole("button", { name: "添加连接" }).click();
    const dialog = page.getByRole("dialog", { name: "添加连接" });
    await dialog.getByLabel("连接名称").fill("Large JSON MCP");
    await dialog.getByLabel("MCP URL").fill(mcp.url);
    await dialog.getByRole("button", { name: "保存连接" }).click();
    await page.getByRole("button", { name: "连接 Large JSON MCP" }).click();
    await page.getByRole("button", { name: "large_payload", exact: true }).dblclick();

    await page.evaluate(() => {
      const target = window as Window & { __largeJsonStartedAt?: number; __largeJsonPerf?: {
        supported: boolean; longTasks: number[]; maxTimerDrift: number; timer: number; observer?: PerformanceObserver;
      } };
      target.__largeJsonStartedAt = performance.now();
      const state = { supported: PerformanceObserver.supportedEntryTypes.includes("longtask"), longTasks: [] as number[],
        maxTimerDrift: 0, timer: 0, observer: undefined as PerformanceObserver | undefined };
      if (state.supported) {
        state.observer = new PerformanceObserver((list) => {
          state.longTasks.push(...list.getEntries().map(({ duration }) => duration));
        });
        state.observer.observe({ type: "longtask", buffered: true });
      }
      let expected = performance.now() + 16;
      state.timer = window.setInterval(() => {
        const now = performance.now();
        state.maxTimerDrift = Math.max(state.maxTimerDrift, now - expected);
        expected = now + 16;
      }, 16);
      target.__largeJsonPerf = state;
    });
    await page.getByRole("button", { name: "执行", exact: true }).click();
    const result = page.locator("article.run-result");
    await expect(result.locator(".run-status")).toHaveText("成功", { timeout: 30_000 });
    await expect(result.locator(".json-viewer-large")).toBeVisible({ timeout: 30_000 });
    const interactiveWithinMs = await page.evaluate(() => performance.now()
      - ((window as Window & { __largeJsonStartedAt?: number }).__largeJsonStartedAt ?? performance.now()));
    expect(workerRequested).toBe(true);
    expect(interactiveWithinMs).toBeLessThan(15_000);
    const responsiveness = await page.evaluate(() => {
      const state = (window as Window & { __largeJsonPerf?: {
        supported: boolean; longTasks: number[]; maxTimerDrift: number; timer: number; observer?: PerformanceObserver;
      } }).__largeJsonPerf;
      if (state === undefined) throw new Error("Large JSON performance observer is unavailable");
      window.clearInterval(state.timer);
      state.observer?.disconnect();
      return { supported: state.supported, maxLongTask: Math.max(0, ...state.longTasks), maxTimerDrift: state.maxTimerDrift };
    });
    expect(responsiveness.supported).toBe(true);
    expect(responsiveness.maxLongTask).toBeLessThan(100);
    expect(responsiveness.maxTimerDrift).toBeLessThan(100);
    await result.getByRole("button", { name: "复制", exact: true }).first().focus();
    await expect(result.getByRole("button", { name: "复制", exact: true }).first()).toBeFocused();
  } finally {
    await inspector?.close();
    await mcp?.stop();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
