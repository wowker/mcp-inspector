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

export function validatePublishedFiles(files) {
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
  ];
  const unexpected = names.filter((name) =>
    !exact.has(name) && !allowedPatterns.some((pattern) => pattern.test(name)));
  if (unexpected.length > 0) {
    throw new Error(`npm package contains unexpected files: ${unexpected.join(", ")}`);
  }

  const required = ["package.json", "README.md", "bin/mcp-inspector.mjs", "dist/server/main.js",
    "dist/server/workflows/script-worker.js", "dist/client/index.html"];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw new Error(`npm package is missing runtime files: ${missing.join(", ")}`);
  }

  const migrations = names
    .filter((name) => /^dist\/server\/projects\/migrations\/\d{3}_.+\.sql$/u.test(name))
    .sort();
  if (migrations.length === 0) {
    throw new Error("npm package is missing SQLite migrations");
  }
  const versions = migrations.map((name) => Number(name.match(/\/(\d{3})_/u)?.[1]));
  const expected = versions.map((_, index) => index + 1);
  if (versions.some((version, index) => version !== expected[index])) {
    throw new Error(`npm package migrations are not contiguous: ${versions.join(", ")}`);
  }

  return { fileCount: names.length, migrationCount: migrations.length };
}
