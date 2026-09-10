import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { reportStartupFailure, runInspectorCli, startInspector } from "../main.js";
import { createRuntimeConfig } from "../config/runtime-config.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mcp-inspector-main-"));
  const staticRoot = join(root, "client");
  mkdirSync(join(staticRoot, "assets"), { recursive: true });
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html><main>Inspector shell</main>");
  writeFileSync(join(staticRoot, "assets", "app.js"), "globalThis.inspectorLoaded = true;");
  return { root, dataRoot: join(root, "data"), staticRoot };
}

describe("startInspector", () => {
  test("uses port 8500 by default while preserving explicit port zero for tests", () => {
    expect(createRuntimeConfig().port).toBe(8500);
    expect(createRuntimeConfig({ port: 0 }).port).toBe(0);
  });

  test("listens on IPv4 loopback, opens only after listening, and generates a strong token", async () => {
    const { dataRoot, staticRoot } = fixture();
    const opened: string[] = [];
    const runtime = await startInspector({
      host: "127.0.0.1",
      port: 0,
      dataRoot,
      staticRoot,
      installSignalHandlers: false,
      openBrowser: async (url) => {
        const health = await fetch(`${runtimeUrl(url)}/api/health`);
        expect(health.status).toBe(401);
        opened.push(url);
      },
    });
    try {
      expect(runtime.address.host).toBe("127.0.0.1");
      expect(runtime.address.port).toBeGreaterThan(0);
      expect(opened).toHaveLength(1);
      const openedUrl = new URL(opened[0]);
      expect(openedUrl.origin).toBe(runtime.address.origin);
      expect(openedUrl.search).toBe("");
      expect(openedUrl.pathname).toMatch(/^\/bootstrap\/[A-Za-z0-9_-]{43}$/);
    } finally {
      await runtime.close();
    }
  });

  test.each(["0.0.0.0", "::", "localhost", "192.168.1.2"])(
    "refuses non-explicit-loopback host %s before creating resources",
    async (host) => {
      const { dataRoot, staticRoot } = fixture();
      const openBrowser = vi.fn();
      await expect(startInspector({ host, port: 0, dataRoot, staticRoot, openBrowser }))
        .rejects.toThrow(/loopback/i);
      expect(openBrowser).not.toHaveBeenCalled();
    },
  );

  test("refuses a non-loopback development client origin", async () => {
    const { dataRoot, staticRoot } = fixture();
    await expect(startInspector({
      host: "127.0.0.1", port: 0, dataRoot, staticRoot,
      clientOrigin: "https://attacker.example", openBrowser: async () => undefined,
    })).rejects.toThrow(/client origin.*loopback/i);
  });

  test("supports the fixed loopback Vite origin in development", async () => {
    const { dataRoot } = fixture();
    let browserUrl = "";
    const runtime = await startInspector({
      host: "127.0.0.1", port: 0, dataRoot,
      clientOrigin: "http://127.0.0.1:5173", installSignalHandlers: false,
      openBrowser: async (url) => { browserUrl = url; },
    });
    try {
      expect(new URL(browserUrl).origin).toBe("http://127.0.0.1:5173");
      expect(new URL(browserUrl).search).toBe("");
      const bootstrap = await fetch(`${runtime.address.origin}${new URL(browserUrl).pathname}`, {
        redirect: "manual",
      });
      const cookie = bootstrap.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
      const health = await fetch(`${runtime.address.origin}/api/health`, { headers: {
        Origin: "http://127.0.0.1:5173", Cookie: cookie,
      } });
      expect(health.status).toBe(200);
    } finally { await runtime.close(); }
  });

  test("serves production assets and safe navigation fallback without swallowing API 404s", async () => {
    const { dataRoot, staticRoot } = fixture();
    let browserUrl = "";
    const runtime = await startInspector({
      host: "127.0.0.1", port: 0, dataRoot, staticRoot, installSignalHandlers: false,
      openBrowser: async (url) => { browserUrl = url; },
    });
    try {
      const bootstrap = await fetch(browserUrl, { redirect: "manual" });
      const headers = { Origin: runtime.address.origin,
        Cookie: bootstrap.headers.get("set-cookie")?.split(";", 1)[0] ?? "" };
      const asset = await fetch(`${runtime.address.origin}/assets/app.js`);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("inspectorLoaded");

      const navigation = await fetch(`${runtime.address.origin}/projects/current`, {
        headers: { Accept: "text/html" },
      });
      expect(navigation.status).toBe(200);
      expect(navigation.headers.get("content-type")).toContain("text/html");
      expect(await navigation.text()).toContain("Inspector shell");

      for (const path of ["/api", "/api/does-not-exist"]) {
        const unknownApi = await fetch(`${runtime.address.origin}${path}`, { headers });
        expect(unknownApi.status).toBe(404);
        expect(unknownApi.headers.get("content-type")).toContain("application/json");
        expect(await unknownApi.json()).toEqual({ error: "Not found" });
      }
    } finally {
      await runtime.close();
    }
  });

  test("closes idempotently and releases the listener", async () => {
    const { dataRoot, staticRoot } = fixture();
    const runtime = await startInspector({
      host: "127.0.0.1", port: 0, dataRoot, staticRoot,
      installSignalHandlers: false, openBrowser: async () => undefined,
    });
    const origin = runtime.address.origin;
    await Promise.all([runtime.close(), runtime.close()]);
    await runtime.close();
    await expect(fetch(`${origin}/`)).rejects.toThrow();
  });

  test("reports an occupied configured port without silently falling back", async () => {
    const ownerFixture = fixture();
    const contenderFixture = fixture();
    const owner = await startInspector({
      host: "127.0.0.1", port: 0,
      dataRoot: ownerFixture.dataRoot, staticRoot: ownerFixture.staticRoot,
      installSignalHandlers: false, openBrowser: async () => undefined,
    });
    const openBrowser = vi.fn();
    try {
      let failure: unknown;
      try {
        await startInspector({
          host: "127.0.0.1", port: owner.address.port,
          dataRoot: contenderFixture.dataRoot, staticRoot: contenderFixture.staticRoot,
          installSignalHandlers: false, openBrowser,
        });
      } catch (error) {
        failure = error;
      }
      const errors: string[] = [];
      reportStartupFailure(failure, (message) => { errors.push(message); });
      expect(errors).toEqual([`Port ${owner.address.port} is already in use`]);
      expect(openBrowser).not.toHaveBeenCalled();
    } finally {
      await owner.close();
    }
  });

  test("removes its process signal handlers during graceful close", async () => {
    const { dataRoot, staticRoot } = fixture();
    const before = { sigint: process.listenerCount("SIGINT"), sigterm: process.listenerCount("SIGTERM") };
    const runtime = await startInspector({
      host: "127.0.0.1", port: 0, dataRoot, staticRoot,
      openBrowser: async () => undefined,
    });
    expect(process.listenerCount("SIGINT")).toBe(before.sigint + 1);
    expect(process.listenerCount("SIGTERM")).toBe(before.sigterm + 1);
    await runtime.close();
    expect(process.listenerCount("SIGINT")).toBe(before.sigint);
    expect(process.listenerCount("SIGTERM")).toBe(before.sigterm);
  });

  test("normalizes a malicious browser-open error and cleans every partial-start resource", async () => {
    const { root, dataRoot, staticRoot } = fixture();
    let openedUrl = "";
    let thrown: unknown;
    const before = { sigint: process.listenerCount("SIGINT"), sigterm: process.listenerCount("SIGTERM") };
    try {
      await startInspector({
        host: "127.0.0.1", port: 0, dataRoot, staticRoot,
        openBrowser: async (url) => { openedUrl = url; throw new Error(`open failed: ${url}`); },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const opened = new URL(openedUrl);
    const ticket = opened.pathname.split("/").at(-1)!;
    expect((thrown as Error).message).toBe("Unable to open Inspector browser");
    expect(String(thrown)).not.toContain(ticket);
    expect(String(thrown)).not.toContain(openedUrl);
    const logged: string[] = [];
    reportStartupFailure(thrown, (message) => { logged.push(message); });
    expect(logged).toEqual(["Unable to start MCP Inspector"]);
    expect(logged.join("\n")).not.toContain(ticket);
    expect(logged.join("\n")).not.toContain(openedUrl);
    await expect(fetch(opened.origin)).rejects.toThrow();
    expect(process.listenerCount("SIGINT")).toBe(before.sigint);
    expect(process.listenerCount("SIGTERM")).toBe(before.sigterm);
    rmSync(root, { recursive: true, force: true });
    expect(existsSync(root)).toBe(false);
  });
});

describe("runInspectorCli", () => {
  test.each([
    { name: "CLI over environment", argv: ["--port", "8501"], envPort: "8502", want: 8501 },
    { name: "equals-style CLI over environment", argv: ["--port=8503"], envPort: "8502", want: 8503 },
    { name: "environment fallback", argv: [], envPort: "8502", want: 8502 },
    { name: "default fallback", argv: [], envPort: undefined, want: 8500 },
  ])("resolves $name port precedence", async ({ argv, envPort, want }) => {
    let receivedPort: number | undefined;
    const exitCode = await runInspectorCli({
      argv,
      env: envPort === undefined ? {} : { MCP_INSPECTOR_PORT: envPort },
      start: async ({ port }) => {
        receivedPort = port;
        return {
          address: { host: "127.0.0.1", port, origin: `http://127.0.0.1:${port}` },
          close: async () => undefined,
        };
      },
      writeInfo: () => undefined,
    });
    expect(exitCode).toBe(0);
    expect(receivedPort).toBe(want);
  });

  test.each([
    { argv: ["--port", "0"], env: {}, message: "--port must be an integer between 1 and 65535" },
    { argv: ["--port", "70000"], env: {}, message: "--port must be an integer between 1 and 65535" },
    { argv: ["--port"], env: {}, message: "--port requires a value" },
    { argv: [], env: { MCP_INSPECTOR_PORT: "port" }, message: "MCP_INSPECTOR_PORT must be an integer between 1 and 65535" },
  ])("rejects an invalid user-facing port before startup", async ({ argv, env, message }) => {
    const start = vi.fn();
    const errors: string[] = [];
    const exitCode = await runInspectorCli({
      argv,
      env,
      start,
      writeError: (value) => { errors.push(value); },
    });
    expect(exitCode).toBe(1);
    expect(start).not.toHaveBeenCalled();
    expect(errors).toEqual([message]);
  });

  test("routes an adversarial startup error through the shared fixed logger", async () => {
    const secretUrl = "http://127.0.0.1:3000/?session=top-secret";
    const errors: string[] = []; const infos: string[] = [];
    const exitCode = await runInspectorCli({
      start: async () => { throw new Error(`open failed: ${secretUrl}`); },
      writeError: (message) => { errors.push(message); },
      writeInfo: (message) => { infos.push(message); },
    });
    expect(exitCode).toBe(1); expect(infos).toEqual([]);
    expect(errors).toEqual(["Unable to start MCP Inspector"]);
    expect(errors.join("\n")).not.toContain(secretUrl); expect(errors.join("\n")).not.toContain("top-secret");
  });
});

function runtimeUrl(browserUrl: string): string {
  return new URL(browserUrl).origin;
}
