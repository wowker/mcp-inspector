import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("packaged bin entry", () => {
  test("delegates startup and failure reporting to the shared CLI boundary", () => {
    const source = readFileSync(resolve("bin/dsers-inspector.mjs"), "utf8");
    expect(source).toContain('import { runInspectorCli } from "../dist/server/main.js";');
    expect(source).toContain("process.exitCode = await runInspectorCli();");
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("console.error");
  });
});
