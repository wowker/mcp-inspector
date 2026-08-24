import { describe, expect, test } from "vitest";
import { createApp } from "../app.js";
import { createRuntimeConfig } from "../config/runtime-config.js";

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
        "X-DSers-Inspector-Session": "test-session",
      },
    });

    expect(response.status).toBe(403);
  });

  test("returns health data for the authorized local session", async () => {
    const response = await app.request("/api/health", {
      headers: {
        Origin: "http://127.0.0.1:5173",
        "X-DSers-Inspector-Session": "test-session",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: "0.1.0" });
  });

  test("rejects an invalid session token", async () => {
    const response = await app.request("/api/health", {
      headers: {
        Origin: "http://127.0.0.1:5173",
        "X-DSers-Inspector-Session": "wrong-session",
      },
    });

    expect(response.status).toBe(401);
  });

  test("protects Tab resources before route resolution", async () => {
    const path = "/api/projects/00000000-0000-4000-8000-000000000001/tabs";
    expect((await app.request(path, { headers: { Origin: "http://127.0.0.1:5173" } })).status).toBe(401);
    expect((await app.request(path, { headers: { Origin: "https://malicious.example",
      "X-DSers-Inspector-Session": "test-session" } })).status).toBe(403);
  });

  test("rejects an equal-length invalid session token", async () => {
    const response = await app.request("/api/health", {
      headers: {
        Origin: "http://127.0.0.1:5173",
        "X-DSers-Inspector-Session": "wrong-sessio",
      },
    });

    expect(response.status).toBe(401);
  });

  test("rejects a foreign origin before checking an invalid token", async () => {
    const response = await app.request("/api/health", {
      headers: {
        Origin: "https://malicious.example",
        "X-DSers-Inspector-Session": "wrong-sessio",
      },
    });

    expect(response.status).toBe(403);
  });
});

describe("createRuntimeConfig", () => {
  test("uses separate loopback origins for the API and Vite client", () => {
    const config = createRuntimeConfig({ sessionToken: "fixed" });

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3000);
    expect(config.allowedOrigin).toBe("http://127.0.0.1:5173");
  });

  test("refuses a non-loopback host at runtime", () => {
    expect(() =>
      createRuntimeConfig({ host: "0.0.0.0" as "127.0.0.1" }),
    ).toThrow(/loopback/i);
  });
});
