import { describe, expect, test, vi } from "vitest";
import { createApp } from "../app.js";
import { createRuntimeConfig } from "../config/runtime-config.js";
import { APP_VERSION } from "../config/app-version.js";

describe("createApp", () => {
  const app = createApp({
    sessionToken: "test-session",
    allowedOrigin: "http://127.0.0.1:5173",
    version: "0.1.0",
  });

  test("rejects a health request without the session token", async () => {
    const response = await app.request("/api/health", {
      headers: { Origin: "http://127.0.0.1:5173" },
    });

    expect(response.status).toBe(401);
  });

  test("rejects a health request from a foreign origin", async () => {
    const response = await app.request("/api/health", {
      headers: {
        Origin: "https://malicious.example",
        "X-MCP-Inspector-Session": "test-session",
      },
    });

    expect(response.status).toBe(403);
  });

  test("returns health data for the authorized local session", async () => {
    const response = await app.request("/api/health", {
      headers: {
        Origin: "http://127.0.0.1:5173",
        "X-MCP-Inspector-Session": "test-session",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: "0.1.0" });
  });

  test("rejects an invalid session token", async () => {
    const response = await app.request("/api/health", {
      headers: {
        Origin: "http://127.0.0.1:5173",
        "X-MCP-Inspector-Session": "wrong-session",
      },
    });

    expect(response.status).toBe(401);
  });

  test("protects Tab and Run resources before route resolution", async () => {
    for (const path of [
      "/api/projects/00000000-0000-4000-8000-000000000001/tabs",
      "/api/projects/00000000-0000-4000-8000-000000000001/runs",
    ]) {
      expect((await app.request(path, { headers: { Origin: "http://127.0.0.1:5173" } })).status).toBe(401);
      expect((await app.request(path, { headers: { Origin: "https://malicious.example",
        "X-MCP-Inspector-Session": "test-session" } })).status).toBe(403);
    }
  });

  test("rejects an equal-length invalid session token", async () => {
    const response = await app.request("/api/health", {
      headers: {
        Origin: "http://127.0.0.1:5173",
        "X-MCP-Inspector-Session": "wrong-sessio",
      },
    });

    expect(response.status).toBe(401);
  });

  test("rejects a foreign origin before checking an invalid token", async () => {
    const response = await app.request("/api/health", {
      headers: {
        Origin: "https://malicious.example",
        "X-MCP-Inspector-Session": "wrong-sessio",
      },
    });

    expect(response.status).toBe(403);
  });
});

describe("OAuth callback", () => {
  test("completes a callback without exposing the Inspector session token", async () => {
    const completeOAuth = vi.fn(async () => "connection-1");
    const app = createApp({
      sessionToken: "test-session", allowedOrigin: "http://127.0.0.1:5173", version: "0.1.0",
      connections: { completeOAuth } as never,
    });
    const response = await app.request("/oauth/callback?state=state-1&code=code-1");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src 'nonce-");
    expect(csp).not.toContain("'unsafe-inline'");
    const html = await response.text();
    expect(html).toContain("正在返回 Server 管理");
    expect(html).toContain("history.replaceState");
    expect(html).toContain("MCP Inspector");
    expect(html).toContain("oauth-status--success");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("返回 MCP Inspector");
    expect(html).toContain("BroadcastChannel");
    expect(html).toContain("oauth-complete");
    expect(html).toContain("connection-1");
    expect(html).toContain("window.close()");
    expect(html).toContain("location.assign(returnUrl)");
    expect(html).toContain("location.replace(returnUrl)");
    const returnPath = html.match(/\/oauth\/return\?ticket=[A-Za-z0-9_-]+/)?.[0];
    expect(returnPath).toBeTruthy();
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).not.toContain("test-session");
    expect(completeOAuth).toHaveBeenCalledOnce();

    const returnResponse = await app.request(returnPath!);
    expect(returnResponse.status).toBe(302);
    expect(returnResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(returnResponse.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(returnResponse.headers.get("Location")).toBe(
      "http://127.0.0.1:5173/?session=test-session#servers",
    );

    const replayResponse = await app.request(returnPath!);
    expect(replayResponse.status).toBe(400);
    expect(replayResponse.headers.get("Location")).toBeNull();
    expect(await replayResponse.text()).not.toContain("test-session");
  });

  test("returns a generic failure page for invalid or replayed state", async () => {
    const app = createApp({
      sessionToken: "test-session", allowedOrigin: "http://127.0.0.1:5173", version: "0.1.0",
      connections: { completeOAuth: vi.fn(async () => { throw new Error("secret upstream details"); }) } as never,
    });
    const response = await app.request("/oauth/callback?state=bad&error=access_denied");
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).not.toContain("secret upstream details");
    expect(html).toContain("MCP Inspector");
    expect(html).toContain("oauth-status--error");
    expect(html).toContain("返回 Inspector 后重新连接");
    expect(response.headers.get("Content-Security-Policy")).toContain("style-src 'nonce-");
  });
});

describe("createRuntimeConfig", () => {
  test("uses the application version from package.json", () => {
    const config = createRuntimeConfig({ sessionToken: "fixed" });

    expect(config.version).toBe(APP_VERSION);
  });

  test("uses an OS-assigned port and a separate loopback origin for the Vite client", () => {
    const config = createRuntimeConfig({ sessionToken: "fixed" });

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(0);
    expect(config.allowedOrigin).toBe("http://127.0.0.1:5173");
  });

  test("refuses a non-loopback host at runtime", () => {
    expect(() =>
      createRuntimeConfig({ host: "0.0.0.0" as "127.0.0.1" }),
    ).toThrow(/loopback/i);
  });
});
