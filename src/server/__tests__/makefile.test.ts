import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
});
