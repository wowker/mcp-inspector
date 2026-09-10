import { gzipSync } from "node:zlib";

export const RELEASE_BUDGETS = Object.freeze({
  initialJavaScriptGzipBytes: 220 * 1024,
  initialCssGzipBytes: 70 * 1024,
});

export function initialAssetPaths(indexHtml) {
  const javascript = [...indexHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)]
    .map((match) => match[1]);
  const css = [...indexHtml.matchAll(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/giu)]
    .map((match) => match[1]);
  return { javascript, css };
}

export function measureGzipBytes(files) {
  return files.reduce((total, file) => total + gzipSync(file).byteLength, 0);
}

export function assertWithinBudget(label, actualBytes, maximumBytes) {
  if (actualBytes > maximumBytes) {
    throw new Error(`${label} is ${(actualBytes / 1024).toFixed(2)} KiB gzip; budget is ${(maximumBytes / 1024).toFixed(2)} KiB`);
  }
}

export function validatePublishedFiles(files, options = {}) {
  const names = files.map((file) => typeof file === "string" ? file : file.path);
  const exact = new Set([
    "package.json",
    "README.md",
    "bin/mcp-inspector.mjs",
    "dist/client/index.html",
    "dist/server/main.js",
    "dist/server/workflows/script-worker.js",
  ]);
  const allowedPatterns = [
    /^dist\/client\/assets\/[A-Za-z0-9][A-Za-z0-9_-]*-[A-Za-z0-9_-]{8,}\.(?:css|js)$/u,
    /^dist\/server\/projects\/migrations\/\d{3}_[a-z0-9_]+\.sql$/u,
    /^dist\/server\/registry\/migrations\/\d{3}_[a-z0-9_]+\.sql$/u,
  ];
  const unexpected = names.filter((name) =>
    !exact.has(name) && !allowedPatterns.some((pattern) => pattern.test(name)));
  if (unexpected.length > 0) {
    throw new Error(`npm package contains unexpected files: ${unexpected.join(", ")}`);
  }

  const required = ["package.json", "README.md", "bin/mcp-inspector.mjs", "dist/server/main.js",
    "dist/server/workflows/script-worker.js", "dist/client/index.html", ...(options.requiredFiles ?? [])];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw new Error(`npm package is missing runtime files: ${missing.join(", ")}`);
  }

  const migrationRoots = ["projects", "registry"];
  let migrationCount = 0;
  for (const root of migrationRoots) {
    const migrations = names
      .filter((name) => new RegExp(`^dist/server/${root}/migrations/\\d{3}_.+\\.sql$`, "u").test(name))
      .sort();
    if (migrations.length === 0) {
      throw new Error(`npm package is missing ${root} SQLite migrations`);
    }
    const versions = migrations.map((name) => Number(name.match(/\/(\d{3})_/u)?.[1]));
    const expected = versions.map((_, index) => index + 1);
    if (versions.some((version, index) => version !== expected[index])) {
      throw new Error(`npm package migrations are not contiguous for ${root}: ${versions.join(", ")}`);
    }
    migrationCount += migrations.length;
  }

  return { fileCount: names.length, migrationCount };
}

export function validateReleaseManifest(manifest) {
  if (typeof manifest?.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)) {
    throw new Error("package version must be valid SemVer");
  }
  if (manifest.engines?.node !== ">=22") throw new Error("package must require Node.js >=22");
  if (manifest.bin?.["mcp-inspector"] !== "bin/mcp-inspector.mjs") {
    throw new Error("package must expose the production mcp-inspector entry");
  }
  for (const path of ["bin", "dist", "README.md"]) {
    if (!manifest.files?.includes(path)) throw new Error(`package files must include ${path}`);
  }
  const sdk = manifest.dependencies?.["@modelcontextprotocol/sdk"];
  if (typeof sdk !== "string") throw new Error("@modelcontextprotocol/sdk must be a runtime dependency");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(sdk)) {
    throw new Error("@modelcontextprotocol/sdk runtime dependency must be pinned");
  }
  return { version: manifest.version, mcpSdkVersion: sdk };
}

export function validateProductionEntry(source) {
  if (!source.includes("/mcp/authoring") || !source.includes("inspector_get_capabilities")) {
    throw new Error("Production entry is missing the Authoring MCP runtime");
  }
  if (!source.includes("runInspectorCli")) throw new Error("Production entry is missing the CLI runtime");
  return true;
}
