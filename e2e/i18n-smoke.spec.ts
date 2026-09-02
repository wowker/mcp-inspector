import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { startInspector } from "../dist/server/main.js";
import { startStreamableMcpServer } from "../test-support/streamable-mcp-server.js";

interface InspectorRuntime { address: { origin: string }; close(): Promise<void> }

test("opens the primary workflow in English from the persisted locale", async ({ page }) => {
  const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-i18n-e2e-"));
  let browserUrl = "";
  let inspector: InspectorRuntime | undefined;
  let mcp: Awaited<ReturnType<typeof startStreamableMcpServer>> | undefined;
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    mcp = await startStreamableMcpServer();
    inspector = await startInspector({
      host: "127.0.0.1",
      port: 0,
      dataRoot,
      installSignalHandlers: false,
      openBrowser: async (url) => { browserUrl = url; },
    });
    await page.addInitScript(() => localStorage.setItem("mcp-inspector.locale", "en-US"));
    await page.goto(browserUrl);

    await expect(page.getByText("Local service is ready")).toBeVisible();
    await page.getByLabel("Project name").fill("English E2E");
    await page.getByRole("button", { name: "Create and open" }).click();

    await expect(page.getByRole("heading", { name: "Servers", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Workbench navigation" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Environment" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Automated testing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Test suites" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Test reports" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run history" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add connection" })).toBeVisible();
    await page.getByRole("button", { name: "Add connection" }).click();
    const dialog = page.getByRole("dialog", { name: "Add connection" });
    await dialog.getByLabel("Connection name").fill("English MCP");
    await dialog.getByLabel("MCP URL").fill(mcp.url);
    await dialog.getByRole("button", { name: "Save connection" }).click();
    await page.getByRole("button", { name: "Connect English MCP" }).click();
    await expect(page.getByRole("tab", { name: "English MCP" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "sum", exact: true }).dblclick();
    await page.getByLabel(/^a(?:\s|\*)*required$/i).fill("20");
    await page.getByLabel(/^b(?:\s|\*)*required$/i).fill("22");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const result = page.locator("article.run-result");
    await expect(result.locator(".run-status")).toHaveText("Succeeded");
    await expect(result.getByRole("tab", { name: "Request & response" })).toBeVisible();
    await expect(result.getByLabel("Structured response JSON")).toContainText("42");
    const lightA11y = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(lightA11y.violations).toEqual([]);
    const visualMasks = [
      page.locator(".run-result__sticky-header > header"),
      page.locator(".run-overview"),
    ];
    await expect(page).toHaveScreenshot("tool-debug-en-light.png", { animations: "disabled", mask: visualMasks });
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", "light");
    const theme = page.getByRole("button", { name: "Switch to dark theme" });
    await theme.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
    await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeFocused();
    await page.waitForTimeout(50);
    const darkA11y = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(darkA11y.violations).toEqual([]);
    await expect(page).toHaveScreenshot("tool-debug-en-dark.png", { animations: "disabled", mask: visualMasks });
  } finally {
    await mcp?.stop();
    await inspector?.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
