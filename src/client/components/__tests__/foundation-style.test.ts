import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(fileURLToPath(new URL("../foundation.css", import.meta.url)), "utf8");
const legacyStylesheet = readFileSync(resolve(process.cwd(), "src/client/app/redesign.css"), "utf8");
const testingStylesheet = readFileSync(resolve(process.cwd(), "src/client/features/testing/testing.css"), "utf8");
const runResultsStylesheet = readFileSync(resolve(process.cwd(), "src/client/app/run-results.css"), "utf8");

describe("UI Foundation theme contract", () => {
  it("uses semantic UI tokens so the same primitives work in light and dark themes", () => {
    expect(stylesheet).toContain("var(--ui-surface)");
    expect(stylesheet).toContain("var(--ui-text)");
    expect(stylesheet).toContain("var(--ui-border)");
    expect(stylesheet).toContain("var(--ui-focus)");
    expect(stylesheet).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(/i);
  });

  it("keeps every shared button variant on a semantic hover surface", () => {
    for (const [variant, token] of [["primary", "--ui-action-hover"], ["secondary", "--ui-surface-muted"],
      ["quiet", "--ui-surface-muted"], ["danger", "--ui-danger-muted"]]) {
      expect(stylesheet).toMatch(new RegExp(`\\.ui-button\\[data-variant="${variant}"\\]:hover[^}]*background: var\\(${token}\\)`));
    }
  });

  it("bounds module help to the viewport so only its body scrolls", () => {
    expect(stylesheet).toMatch(/\.module-help__popover\s*\{[^}]*max-height:\s*min\(560px, calc\(100dvh - 24px\)\)/s);
    expect(stylesheet).toMatch(/\.module-help__body\s*\{[^}]*overflow-y:\s*auto/s);
  });

  it("keeps legacy styles from restyling every element inside the shared switch", () => {
    expect(legacyStylesheet).not.toMatch(/\.ui-switch\s+(?:input|span)(?=[\s:{])/);
  });

  it("gives the Run status and pin action separate layout columns", () => {
    expect(legacyStylesheet).toMatch(/\.history-run-row\s*\{[^}]*display:\s*grid[^}]*gap:\s*0[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s);
    expect(legacyStylesheet).toMatch(/\.history-run__pin\s*\{[^}]*align-self:\s*start/s);
    expect(legacyStylesheet).not.toMatch(/\.history-run__pin\s*\{[^}]*position:\s*absolute/s);
  });

  it("uses one identical divider between scenario configuration, result, and history sections", () => {
    expect(testingStylesheet).toMatch(/\.testing-execution--flush\s*\{[^}]*border-bottom:\s*1px solid var\(--ui-border\)/s);
    expect(testingStylesheet).not.toMatch(/\.test-execution-workspace\s*\{[^}]*border-top:/s);
  });

  it("vertically centers icons and labels in every Run result action", () => {
    expect(runResultsStylesheet).toMatch(/\.run-result-action\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*gap:\s*5px[^}]*line-height:\s*1/s);
    expect(runResultsStylesheet).toMatch(/\.run-result-action\s*>\s*svg\s*\{[^}]*display:\s*block/s);
    expect(runResultsStylesheet).toMatch(/\.run-result-actions\s+\.run-result-action\s*\{[^}]*min-height:\s*32px[^}]*border-color:\s*var\(--ui-border\)[^}]*background:\s*var\(--ui-surface\)[^}]*line-height:\s*1/s);
  });
});
