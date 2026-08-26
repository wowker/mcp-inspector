import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Makefile service lifecycle", () => {
  it("treats a second start as a no-op instead of launching a competing process", () => {
    const root = mkdtempSync(join(tmpdir(), "inspector-make-"));
    const runDir = join(root, "run");
    const lock = join(root, "listener.lock");
    const count = join(root, "starts.txt");
    const buildEntry = join(root, "main.js");
    const appEntry = join(root, "fake-app.mjs");
    const makefile = join(root, "Makefile");
    writeFileSync(buildEntry, "");
    writeFileSync(appEntry, `import { appendFileSync, mkdirSync, rmSync } from "node:fs";
const lock = process.env.FAKE_LOCK;
const count = process.env.FAKE_COUNT;
try { mkdirSync(lock); } catch { console.error("Unable to start fake Inspector"); process.exit(1); }
appendFileSync(count, "start\\n");
let closed = false;
function close() { if (closed) return; closed = true; rmSync(lock, { recursive: true, force: true }); process.exit(0); }
process.on("SIGTERM", close);
process.on("SIGINT", close);
setInterval(() => undefined, 1_000);
`);
    writeFileSync(makefile, readFileSync(resolve("Makefile"), "utf8").replaceAll("dist/server/main.js", buildEntry));
    const args = ["-f", makefile, "start", `NODE=${process.execPath}`, `RUN_DIR=${runDir}`, `APP_ENTRY=${appEntry}`];
    const options = { cwd: resolve("."), encoding: "utf8" as const, timeout: 10_000,
      env: { ...process.env, FAKE_LOCK: lock, FAKE_COUNT: count } };
    try {
      const first = spawnSync("make", args, options);
      expect(first.status, `${first.stdout}${first.stderr}`).toBe(0);
      const pid = readFileSync(join(runDir, "mcp-inspector.pid"), "utf8").trim();
      const command = spawnSync("ps", ["-p", pid, "-o", "command="], { encoding: "utf8" }).stdout;
      expect(command).toContain(appEntry);
      const second = spawnSync("make", args, options);
      expect(second.status, `${second.stdout}${second.stderr}`).toBe(0);
      expect(second.stdout).toContain("already running");
      expect(readFileSync(count, "utf8").trim().split("\n")).toEqual(["start"]);
    } finally {
      spawnSync("make", ["-f", makefile, "stop", `NODE=${process.execPath}`, `RUN_DIR=${runDir}`, `APP_ENTRY=${appEntry}`], options);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stops a legacy DSers Inspector process before starting the renamed app", () => {
    const root = mkdtempSync(join(tmpdir(), "inspector-make-legacy-"));
    const runDir = join(root, "run");
    const lock = join(root, "listener.lock");
    const count = join(root, "starts.txt");
    const buildEntry = join(root, "main.js");
    const legacyEntry = join(root, "dsers-inspector.mjs");
    const currentEntry = join(root, "mcp-inspector.mjs");
    const makefile = join(root, "Makefile");
    writeFileSync(buildEntry, "");
    const app = `import { appendFileSync, mkdirSync, rmSync } from "node:fs";
const lock = process.env.FAKE_LOCK;
const count = process.env.FAKE_COUNT;
try { mkdirSync(lock); } catch { console.error("Unable to start fake Inspector"); process.exit(1); }
appendFileSync(count, process.argv[1] + "\\n");
let closed = false;
function close() { if (closed) return; closed = true; rmSync(lock, { recursive: true, force: true }); process.exit(0); }
process.on("SIGTERM", close);
process.on("SIGINT", close);
setInterval(() => undefined, 1_000);
`;
    writeFileSync(legacyEntry, app);
    writeFileSync(currentEntry, app);
    writeFileSync(makefile, readFileSync(resolve("Makefile"), "utf8").replaceAll("dist/server/main.js", buildEntry));
    const options = { cwd: resolve("."), encoding: "utf8" as const, timeout: 10_000,
      env: { ...process.env, FAKE_LOCK: lock, FAKE_COUNT: count } };
    const legacyArgs = ["-f", makefile, "start", `NODE=${process.execPath}`, `RUN_DIR=${runDir}`,
      `APP_ENTRY=${legacyEntry}`, `PID_FILE=${join(runDir, "dsers-inspector.pid")}`];
    const currentArgs = ["-f", makefile, "restart", `NODE=${process.execPath}`, `NPM=true`, `RUN_DIR=${runDir}`,
      `APP_ENTRY=${currentEntry}`, `LEGACY_APP_ENTRY=${legacyEntry}`];
    try {
      const legacy = spawnSync("make", legacyArgs, options);
      expect(legacy.status, `${legacy.stdout}${legacy.stderr}`).toBe(0);

      const renamed = spawnSync("make", currentArgs, options);
      expect(renamed.status, `${renamed.stdout}${renamed.stderr}`).toBe(0);
      expect(renamed.stdout).toContain("stopped");
      expect(readFileSync(count, "utf8").trim().split("\n")).toEqual([legacyEntry, currentEntry]);
    } finally {
      spawnSync("make", ["-f", makefile, "stop", `NODE=${process.execPath}`, `RUN_DIR=${runDir}`,
        `APP_ENTRY=${currentEntry}`, `LEGACY_APP_ENTRY=${legacyEntry}`], options);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Makefile npm release", () => {
  it("requires explicit confirmation and runs every release gate before publishing", () => {
    const root = mkdtempSync(join(tmpdir(), "inspector-make-release-"));
    const npm = join(root, "npm");
    const git = join(root, "git");
    const npmLog = join(root, "npm.log");
    const version = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;
    writeFileSync(npm, `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_NPM_LOG"
if [ "$1" = "whoami" ]; then printf 'wuwei0215\\n'; fi
`);
    writeFileSync(git, `#!/bin/sh
if [ "$1" = "tag" ] && [ "$2" = "--points-at" ]; then printf 'v${version}\\n'; fi
`);
    chmodSync(npm, 0o755);
    chmodSync(git, 0o755);
    const args = [`NPM=${npm}`, `GIT=${git}`, `NODE=${process.execPath}`];
    const env: NodeJS.ProcessEnv = { ...process.env, FAKE_NPM_LOG: npmLog };
    delete env.CONFIRM;
    delete env.MAKEFLAGS;
    delete env.MFLAGS;
    delete env.MAKELEVEL;
    const options = { cwd: resolve("."), encoding: "utf8" as const, env };

    try {
      const unconfirmed = spawnSync("make", ["publish", ...args], options);
      expect(unconfirmed.status).not.toBe(0);
      expect(`${unconfirmed.stdout}${unconfirmed.stderr}`).toContain("CONFIRM=publish");
      expect(existsSync(npmLog)).toBe(false);

      const confirmed = spawnSync("make", ["publish", "CONFIRM=publish", ...args], options);
      expect(confirmed.status, `${confirmed.stdout}${confirmed.stderr}`).toBe(0);
      expect(readFileSync(npmLog, "utf8").trim().split("\n")).toEqual([
        "whoami --registry=https://registry.npmjs.org/",
        "run verify",
        "audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org/",
        "pack --dry-run --registry=https://registry.npmjs.org/",
        "publish --access public --tag latest --registry=https://registry.npmjs.org/",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates a semantic release commit and tag through npm version", () => {
    const root = mkdtempSync(join(tmpdir(), "inspector-make-version-"));
    const npm = join(root, "npm");
    const git = join(root, "git");
    const npmLog = join(root, "npm.log");
    writeFileSync(npm, `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_NPM_LOG"
`);
    writeFileSync(git, "#!/bin/sh\n");
    chmodSync(npm, 0o755);
    chmodSync(git, 0o755);

    try {
      const result = spawnSync("make", ["release-version", "BUMP=major", `NPM=${npm}`, `GIT=${git}`], {
        cwd: resolve("."), encoding: "utf8", env: { ...process.env, FAKE_NPM_LOG: npmLog },
      });
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
      expect(readFileSync(npmLog, "utf8").trim()).toBe('version major -m chore(release): v%s');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
