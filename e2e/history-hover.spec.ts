import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("current Tab history keeps a muted surface when hovered", async ({ page }) => {
  await page.setContent('<section class="run-history"><button type="button" class="history-run">History record</button></section>');
  for (const file of ["app.css", "redesign.css", "run-results.css"]) {
    await page.addStyleTag({ path: resolve("src/client/app", file) });
  }

  const expected = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--ui-surface-muted)";
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });

  await page.getByRole("button", { name: "History record" }).hover();
  await expect(page.getByRole("button", { name: "History record" }))
    .toHaveCSS("background-color", expected);
});
