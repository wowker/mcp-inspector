import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("packaged bin entry", () => {
  test("delegates startup and failure reporting to the shared CLI boundary", () => {
    const source = readFileSync(resolve("bin/mcp-inspector.mjs"), "utf8");
    expect(source).toContain('import { runInspectorCli } from "../dist/server/main.js";');
    expect(source).toContain("argv: process.argv.slice(2)");
    expect(source).toContain("env: process.env");
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("console.error");
  });
});
