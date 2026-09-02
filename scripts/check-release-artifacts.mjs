import { mkdtemp, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  RELEASE_BUDGETS,
  assertWithinBudget,
  initialAssetPaths,
  measureGzipBytes,
  validatePublishedFiles,
} from "./release-artifact-policy.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const clientRoot = join(root, "dist", "client");
const indexHtml = await readFile(join(clientRoot, "index.html"), "utf8");
const initial = initialAssetPaths(indexHtml);
const readAssets = async (paths) => Promise.all(paths.map((path) => readFile(join(clientRoot, path.replace(/^\//u, "")))));
const [javascript, css] = await Promise.all([readAssets(initial.javascript), readAssets(initial.css)]);
const javascriptBytes = measureGzipBytes(javascript);
const cssBytes = measureGzipBytes(css);
assertWithinBudget("Initial JavaScript", javascriptBytes, RELEASE_BUDGETS.initialJavaScriptGzipBytes);
assertWithinBudget("Initial CSS", cssBytes, RELEASE_BUDGETS.initialCssGzipBytes);

const sourceMigrationRoot = join(root, "src", "server", "projects", "migrations");
const bundledMigrationRoot = join(root, "dist", "server", "projects", "migrations");
const migrationNames = (await readdir(sourceMigrationRoot)).filter((name) => name.endsWith(".sql")).sort();
const bundledNames = (await readdir(bundledMigrationRoot)).filter((name) => name.endsWith(".sql")).sort();
if (JSON.stringify(migrationNames) !== JSON.stringify(bundledNames)) {
  throw new Error("Bundled migration filenames do not match source migrations");
}
for (const name of migrationNames) {
  const [source, bundled] = await Promise.all([
    readFile(join(sourceMigrationRoot, name)),
    readFile(join(bundledMigrationRoot, name)),
  ]);
  if (!source.equals(bundled)) throw new Error(`Bundled migration differs from source: ${name}`);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCache = await mkdtemp(join(tmpdir(), "mcp-inspector-release-cache-"));
const releaseRoot = join(root, ".release");
const releaseArtifact = join(releaseRoot, "package.tgz");
let packageResult;
try {
  await rm(releaseRoot, { recursive: true, force: true });
  await mkdir(releaseRoot, { recursive: true });
  const pack = spawnSync(npmCommand, ["pack", "--json", "--ignore-scripts", "--pack-destination", releaseRoot], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: npmCache, npm_config_update_notifier: "false" },
  });
  if (pack.status !== 0) throw new Error(`npm pack failed:\n${pack.stderr || pack.stdout}`);
  const packageReport = JSON.parse(pack.stdout);
  packageResult = validatePublishedFiles(packageReport[0]?.files ?? []);
  const packedName = packageReport[0]?.filename;
  if (typeof packedName !== "string" || packedName.length === 0) throw new Error("npm pack did not report an artifact");
  await rename(join(releaseRoot, packedName), releaseArtifact);
} finally {
  await rm(npmCache, { recursive: true, force: true });
}
const artifactBytes = await readFile(releaseArtifact);
const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");

console.log(JSON.stringify({
  initialJavaScriptGzipKiB: Number((javascriptBytes / 1024).toFixed(2)),
  initialCssGzipKiB: Number((cssBytes / 1024).toFixed(2)),
  migrationCount: migrationNames.length,
  ...packageResult,
  artifact: ".release/package.tgz",
  artifactSha256,
}, null, 2));
