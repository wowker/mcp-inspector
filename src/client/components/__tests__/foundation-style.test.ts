import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(fileURLToPath(new URL("../foundation.css", import.meta.url)), "utf8");

describe("UI Foundation theme contract", () => {
  it("uses semantic UI tokens so the same primitives work in light and dark themes", () => {
    expect(stylesheet).toContain("var(--ui-surface)");
    expect(stylesheet).toContain("var(--ui-text)");
    expect(stylesheet).toContain("var(--ui-border)");
    expect(stylesheet).toContain("var(--ui-focus)");
    expect(stylesheet).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(/i);
  });
});
