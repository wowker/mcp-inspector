// @ts-expect-error JavaScript release policy intentionally runs directly under Node during packaging.
import * as releaseArtifactPolicy from "../../../scripts/release-artifact-policy.mjs";
import { describe, expect, it } from "vitest";

const { assertWithinBudget, initialAssetPaths, measureGzipBytes, validateProductionEntry,
  validatePublishedFiles, validateReleaseManifest } = releaseArtifactPolicy;

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
      "README.zh-CN.md",
      "bin/mcp-inspector.mjs",
      "dist/client/index.html",
      "dist/client/assets/index-AbCdEf12.js",
      "dist/server/main.js",
      "dist/server/workflows/script-worker.js",
      "dist/server/projects/migrations/001_projects.sql",
      "dist/server/projects/migrations/002_connections.sql",
      "dist/server/registry/migrations/001_registry.sql",
      "dist/server/registry/migrations/002_authoring.sql",
    ])).toEqual({ fileCount: 12, migrationCount: 4 });
  });

  it("requires the Authoring runtime, MCP SDK dependency, and generated client assets", () => {
    expect(validateReleaseManifest({ version: "3.0.0", engines: { node: ">=22" },
      bin: { "mcp-inspector": "bin/mcp-inspector.mjs" }, files: ["bin", "dist", "README.md", "README.zh-CN.md"],
      dependencies: { "@modelcontextprotocol/sdk": "1.29.0" }, devDependencies: {} })).toEqual({
        version: "3.0.0", mcpSdkVersion: "1.29.0",
      });
    expect(() => validateReleaseManifest({ version: "3.0.0", engines: { node: ">=22" },
      bin: { "mcp-inspector": "bin/mcp-inspector.mjs" }, files: ["bin", "dist", "README.md", "README.zh-CN.md"],
      dependencies: {}, devDependencies: { "@modelcontextprotocol/sdk": "1.29.0" } })).toThrow(/runtime dependency/u);
    expect(() => validateReleaseManifest({ version: "3.0.0", engines: { node: ">=22" },
      bin: { "mcp-inspector": "bin/mcp-inspector.mjs" }, files: ["bin", "dist", "README.md", "README.zh-CN.md"],
      dependencies: { "@modelcontextprotocol/sdk": "^1.29.0" } })).toThrow(/pinned/u);
    expect(validateProductionEntry("/mcp/authoring inspector_get_capabilities runInspectorCli")).toBe(true);
    expect(() => validateProductionEntry("runInspectorCli")).toThrow(/Authoring MCP/u);
    expect(() => validatePublishedFiles([
      "package.json", "README.md", "README.zh-CN.md", "bin/mcp-inspector.mjs", "dist/client/index.html",
      "dist/server/main.js", "dist/server/workflows/script-worker.js",
      "dist/server/projects/migrations/001_a.sql", "dist/server/registry/migrations/001_registry.sql",
    ], { requiredFiles: ["dist/client/assets/index-AbCdEf12.js"] })).toThrow(/missing runtime files/u);
  });

  it("rejects source files, missing runtime files, and migration gaps", () => {
    const runtime = ["package.json", "README.md", "README.zh-CN.md", "bin/mcp-inspector.mjs", "dist/client/index.html",
      "dist/server/main.js", "dist/server/workflows/script-worker.js"];
    expect(() => validatePublishedFiles([...runtime, "src/client/main.tsx", "dist/server/projects/migrations/001_a.sql"]))
      .toThrow(/unexpected files/u);
    expect(() => validatePublishedFiles([
      ...runtime,
      "dist/server/projects/migrations/001_a.sql",
      "dist/server/registry/migrations/002_b.sql",
    ]))
      .toThrow(/not contiguous/u);
    expect(() => validatePublishedFiles([...runtime, "dist/server/projects/migrations/001_a.sql"]))
      .toThrow(/registry SQLite migrations/u);
    expect(() => validatePublishedFiles(["package.json", "README.md", "README.zh-CN.md"]))
      .toThrow(/missing runtime files/u);
    for (const unsafe of ["dist/credentials.txt", "bin/debug-dump", "dist/client/assets/.env", "dist/server/main.js.map"]) {
      expect(() => validatePublishedFiles([
        ...runtime,
        "dist/server/projects/migrations/001_a.sql",
        "dist/server/registry/migrations/001_registry.sql",
        unsafe,
      ]))
        .toThrow(/unexpected files/u);
    }
  });
});
