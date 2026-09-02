import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startInspector } from "../dist/server/main.js";
import { startStreamableMcpServer } from "../test-support/streamable-mcp-server.js";

interface InspectorRuntime { address: { origin: string }; close(): Promise<void> }

test("keeps 1,000 Tools bounded and returns exact search feedback within budget", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-catalog-performance-"));
  let inspector: InspectorRuntime | undefined;
  let mcp: Awaited<ReturnType<typeof startStreamableMcpServer>> | undefined;
  let browserUrl = "";
  try {
    mcp = await startStreamableMcpServer({ catalogToolCount: 1_000 });
    inspector = await startInspector({
      host: "127.0.0.1", port: 0, dataRoot, installSignalHandlers: false,
      openBrowser: async (url) => { browserUrl = url; },
    });
    await page.goto(browserUrl);
    await page.getByLabel("项目名称").fill("Catalog Performance");
    await page.getByRole("button", { name: "创建并打开" }).click();
    await page.getByRole("button", { name: "添加连接" }).click();
    const dialog = page.getByRole("dialog", { name: "添加连接" });
    await dialog.getByLabel("连接名称").fill("Large Catalog");
    await dialog.getByLabel("MCP URL").fill(mcp.url);
    await dialog.getByRole("button", { name: "保存连接" }).click();
    await page.getByRole("button", { name: "连接 Large Catalog" }).click();

    await expect(page.getByText("1–200 / 1,002")).toBeVisible();
    await expect(page.locator(".tool-row")).toHaveCount(200);
    const tree = page.locator(".tool-tree");
    const panel = page.locator(".tool-tree-panel");
    await expect(tree).toHaveCSS("overflow-y", "auto");
    const scrollBounds = await tree.evaluate((element) => ({
      clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
    }));
    expect(scrollBounds.scrollHeight).toBeGreaterThan(scrollBounds.clientHeight);
    expect(await panel.evaluate((element) => element.scrollHeight)).toBeLessThanOrEqual(
      await panel.evaluate((element) => element.clientHeight),
    );
    await tree.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await tree.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const scrollResponsiveness = await tree.evaluate(async (element) => {
      const supported = PerformanceObserver.supportedEntryTypes.includes("longtask");
      const longTasks: number[] = [];
      const observer = supported ? new PerformanceObserver((list) => {
        longTasks.push(...list.getEntries().map(({ duration }) => duration));
      }) : null;
      observer?.observe({ type: "longtask", buffered: true });
      const frameGaps: number[] = [];
      let previous = performance.now();
      for (let frame = 0; frame < 60; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame((now) => {
          frameGaps.push(now - previous);
          previous = now;
          element.scrollTop = frame % 2 === 0 ? element.scrollHeight : 0;
          resolve();
        }));
      }
      longTasks.push(...(observer?.takeRecords() ?? []).map(({ duration }) => duration));
      observer?.disconnect();
      return {
        supported,
        maxFrameGap: Math.max(0, ...frameGaps),
        maxLongTask: Math.max(0, ...longTasks),
      };
    });
    expect(scrollResponsiveness.supported).toBe(true);
    expect(scrollResponsiveness.maxFrameGap).toBeLessThan(100);
    expect(scrollResponsiveness.maxLongTask).toBeLessThan(100);
    await page.getByRole("button", { name: "下一页" }).click();
    await expect(page.getByText("201–400 / 1,002")).toBeVisible();
    await expect.poll(() => tree.evaluate((element) => element.scrollTop)).toBe(0);

    const searchDurationMs = await page.evaluate(async () => {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索 Tool"]');
      const catalog = document.querySelector(".tool-tree-panel");
      if (input === null || catalog === null) throw new Error("Tool catalog controls are unavailable");
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setValue === undefined) throw new Error("Input value setter is unavailable");
      const start = performance.now();
      setValue.call(input, "load_test_tool_0999");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => { observer.disconnect(); reject(new Error("Search did not settle")); }, 2_000);
        const check = () => {
          const names = [...catalog.querySelectorAll(".tool-item strong")].map((node) => node.textContent);
          if (!names.includes("load_test_tool_0999")) return;
          window.clearTimeout(timeout); observer.disconnect(); resolve();
        };
        const observer = new MutationObserver(check);
        observer.observe(catalog, { childList: true, subtree: true });
        check();
      });
      return performance.now() - start;
    });
    expect(searchDurationMs).toBeLessThan(100);
    await expect(page.locator(".tool-row")).toHaveCount(1);
  } finally {
    await inspector?.close();
    await mcp?.stop();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
