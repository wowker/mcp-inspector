import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { reportStartupFailure, runInspectorCli, startInspector } from "../main.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mcp-inspector-main-"));
  const staticRoot = join(root, "client");
  mkdirSync(join(staticRoot, "assets"), { recursive: true });
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html><main>Inspector shell</main>");
  writeFileSync(join(staticRoot, "assets", "app.js"), "globalThis.inspectorLoaded = true;");
  return { root, dataRoot: join(root, "data"), staticRoot };
}

describe("startInspector", () => {
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
      expect(openedUrl.searchParams.get("session")).toMatch(/^[A-Za-z0-9_-]{43}$/);
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
      const token = new URL(browserUrl).searchParams.get("session")!;
      expect(new URL(browserUrl).origin).toBe("http://127.0.0.1:5173");
      const health = await fetch(`${runtime.address.origin}/api/health`, { headers: {
        Origin: "http://127.0.0.1:5173", "X-MCP-Inspector-Session": token,
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
      const token = new URL(browserUrl).searchParams.get("session")!;
      const headers = { Origin: runtime.address.origin, "X-MCP-Inspector-Session": token };
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
    const token = opened.searchParams.get("session")!;
    expect((thrown as Error).message).toBe("Unable to open Inspector browser");
    expect(String(thrown)).not.toContain(token);
    expect(String(thrown)).not.toContain(openedUrl);
    const logged: string[] = [];
    reportStartupFailure(thrown, (message) => { logged.push(message); });
    expect(logged).toEqual(["Unable to start MCP Inspector"]);
    expect(logged.join("\n")).not.toContain(token);
    expect(logged.join("\n")).not.toContain(openedUrl);
    await expect(fetch(opened.origin)).rejects.toThrow();
    expect(process.listenerCount("SIGINT")).toBe(before.sigint);
    expect(process.listenerCount("SIGTERM")).toBe(before.sigterm);
    rmSync(root, { recursive: true, force: true });
    expect(existsSync(root)).toBe(false);
  });
});

describe("runInspectorCli", () => {
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
