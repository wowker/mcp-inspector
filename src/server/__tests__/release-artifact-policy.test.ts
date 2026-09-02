// @ts-expect-error JavaScript release policy intentionally runs directly under Node during packaging.
import { assertWithinBudget, initialAssetPaths, measureGzipBytes, validatePublishedFiles } from "../../../scripts/release-artifact-policy.mjs";
import { describe, expect, it } from "vitest";

describe("release artifact policy", () => {
  it("measures only assets loaded by the initial HTML", () => {
    const assets = initialAssetPaths(`
      <script type="module" src="/assets/index.js"></script>
      <link rel="stylesheet" href="/assets/index.css">
    `);
    expect(assets).toEqual({ javascript: ["/assets/index.js"], css: ["/assets/index.css"] });
    expect(measureGzipBytes([Buffer.from("repeat".repeat(1_000))])).toBeLessThan(6_000);
    expect(() => assertWithinBudget("JS", 101, 100)).toThrow(/budget/u);
  });

  it("accepts only the runtime package allowlist and contiguous migrations", () => {
    expect(validatePublishedFiles([
      "package.json",
      "README.md",
      "bin/mcp-inspector.mjs",
      "dist/client/index.html",
      "dist/client/assets/index-AbCdEf12.js",
      "dist/server/main.js",
      "dist/server/workflows/script-worker.js",
      "dist/server/projects/migrations/001_projects.sql",
      "dist/server/projects/migrations/002_connections.sql",
    ])).toEqual({ fileCount: 9, migrationCount: 2 });
  });

  it("rejects source files, missing runtime files, and migration gaps", () => {
    const runtime = ["package.json", "README.md", "bin/mcp-inspector.mjs", "dist/client/index.html",
      "dist/server/main.js", "dist/server/workflows/script-worker.js"];
    expect(() => validatePublishedFiles([...runtime, "src/client/main.tsx", "dist/server/projects/migrations/001_a.sql"]))
      .toThrow(/unexpected files/u);
    expect(() => validatePublishedFiles([...runtime, "dist/server/projects/migrations/002_b.sql"]))
      .toThrow(/not contiguous/u);
    expect(() => validatePublishedFiles(["package.json", "README.md"]))
      .toThrow(/missing runtime files/u);
    for (const unsafe of ["dist/credentials.txt", "bin/debug-dump", "dist/client/assets/.env", "dist/server/main.js.map"]) {
      expect(() => validatePublishedFiles([...runtime, "dist/server/projects/migrations/001_a.sql", unsafe]))
        .toThrow(/unexpected files/u);
    }
  });
});
