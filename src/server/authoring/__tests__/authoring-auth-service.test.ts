import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createApp } from "../../app.js";
import { InstallationSettingsRepository } from "../../registry/installation-settings-repository.js";
import { createAuthoringAuthService } from "../authoring-auth-service.js";

describe("AuthoringAuthService", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-authoring-auth-"));
    roots.push(dataRoot);
    const repository = new InstallationSettingsRepository({ dataRoot });
    const service = createAuthoringAuthService({
      repository,
      now: () => new Date("2026-09-10T01:02:03.000Z"),
    });
    return { repository, service };
  }

  test("issues plaintext once and persists only its digest and non-sensitive hint", async () => {
    const { repository, service } = fixture();
    try {
      expect(service.getStatus()).toEqual({
        enabled: false,
        configured: false,
        tokenHint: null,
        tokenCreatedAt: null,
        tokenRotatedAt: null,
        updatedAt: null,
      });

      const issued = await service.enable();
      const token = issued.token;
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      if (token === null) throw new Error("Expected first enable to issue a Token");
      expect(issued.status).toEqual({
        enabled: true,
        configured: true,
        tokenHint: `${token.slice(0, 4)}…${token.slice(-4)}`,
        tokenCreatedAt: "2026-09-10T01:02:03.000Z",
        tokenRotatedAt: null,
        updatedAt: "2026-09-10T01:02:03.000Z",
      });
      expect(await service.verify(token)).toBe(true);
      expect(await service.verify(`${token.slice(0, -1)}x`)).toBe(false);

      const stored = repository.getAuthoring();
      expect(stored.tokenDigest).toMatch(/^scrypt:v1:/);
      expect(stored.tokenDigest).not.toContain(token);
      expect(JSON.stringify(stored)).not.toContain(token);

      const enabledAgain = await service.enable();
      expect(enabledAgain.token).toBeNull();
      expect(repository.getAuthoring().tokenDigest).toBe(stored.tokenDigest);
    } finally {
      repository.close();
    }
  });

  test("rotation invalidates the previous token and disablement rejects the current token", async () => {
    const { repository, service } = fixture();
    try {
      const first = await service.enable();
      const second = await service.rotate();
      expect(second.token).not.toBe(first.token);
      expect(second.status.tokenCreatedAt).toBe(first.status.tokenCreatedAt);
      expect(second.status.tokenRotatedAt).toBe("2026-09-10T01:02:03.000Z");
      expect(await service.verify(first.token!)).toBe(false);
      expect(await service.verify(second.token)).toBe(true);

      const disabled = service.disable();
      expect(disabled.enabled).toBe(false);
      expect(disabled.configured).toBe(true);
      expect(await service.verify(second.token)).toBe(false);
      expect(repository.getAuthoring().tokenDigest).not.toBeNull();
    } finally {
      repository.close();
    }
  });
});

describe("Authoring settings routes", () => {
  test("inherit browser session protection and never return the stored digest", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-authoring-routes-"));
    const repository = new InstallationSettingsRepository({ dataRoot });
    const authoringAuth = createAuthoringAuthService({ repository });
    const app = createApp({
      sessionToken: "browser-session",
      allowedOrigin: "http://127.0.0.1:5173",
      version: "3.0.0",
      authoringAuth,
    });
    const headers = {
      Origin: "http://127.0.0.1:5173",
      "X-MCP-Inspector-Session": "browser-session",
    };
    try {
      expect((await app.request("/api/authoring/settings")).status).toBe(401);
      const enabled = await app.request("/api/authoring/settings/enable", {
        method: "POST",
        headers,
      });
      expect(enabled.status).toBe(200);
      expect(enabled.headers.get("Cache-Control")).toBe("no-store");
      const enabledBody = await enabled.json() as { token: string; settings: unknown; endpoint: string };
      expect(enabledBody.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(enabledBody.endpoint).toBe("/mcp/authoring");
      expect(JSON.stringify(enabledBody)).not.toContain("scrypt:v1:");

      const status = await app.request("/api/authoring/settings", { headers });
      const statusText = await status.text();
      expect(status.status).toBe(200);
      expect(statusText).not.toContain(enabledBody.token);
      expect(statusText).not.toContain("scrypt:v1:");

      const rotated = await app.request("/api/authoring/settings/token", {
        method: "POST",
        headers,
      });
      expect(rotated.status).toBe(200);
      expect((await rotated.json() as { token: string }).token).not.toBe(enabledBody.token);

      const disabled = await app.request("/api/authoring/settings/disable", {
        method: "POST",
        headers,
      });
      expect(disabled.status).toBe(200);
      expect((await disabled.json() as { settings: { enabled: boolean } }).settings.enabled).toBe(false);
    } finally {
      repository.close();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});
