import { afterEach, describe, expect, it } from "vitest";
import { startStreamableMcpServer } from "../../../../test-support/streamable-mcp-server.js";
import type { WireObservation } from "../connection-runtime.js";
import { OAuthFlowCoordinator } from "../oauth-flow.js";
import { createStreamableMcpSessionFactory } from "../streamable-session.js";

describe("Streamable HTTP MCP session", () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(async () => { await stop?.(); });

  it("initializes, lists tools, calls sum, and observes both RPC directions", async () => {
    const fixture = await startStreamableMcpServer();
    stop = fixture.stop;
    const observations: WireObservation[] = [];
    const session = await createStreamableMcpSessionFactory({ appVersion: "0.1.0-test" })({
      id: "00000000-0000-4000-8000-000000000402",
      projectId: "00000000-0000-4000-8000-000000000001",
      name: "Fixture",
      url: fixture.url,
      transport: "streamable-http",
      authMode: "none",
      bearerToken: null,
      headers: { "X-API-Key": "local-secret", "X-Tenant": "supplier-eu" },
      redactSensitiveInfo: true,
      timeoutMs: 2_000,
      status: "disconnected",
      lastProtocolVersion: null,
      lastServerInfo: null,
      lastError: null,
    }, (event) => observations.push(event));

    try {
      const listed = await session.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["echo", "sum"]);
      const result = await session.callTool({ name: "sum", arguments: { a: 2, b: 3 } });
      expect(result.structuredContent).toEqual({ total: 5 });
      expect(session.protocolVersion).not.toBe("unknown");
      expect(session.serverInfo).toEqual({ name: "loopback-fixture", version: "1.0.0" });
      expect(observations.some((event) => event.kind === "rpc-out")).toBe(true);
      expect(observations.some((event) => event.kind === "rpc-in")).toBe(true);
      expect(fixture.receivedRequestHeaders.length).toBeGreaterThan(0);
      expect(fixture.receivedRequestHeaders.every((headers) =>
        headers["x-api-key"] === "local-secret" && headers["x-tenant"] === "supplier-eu"))
        .toBe(true);
      expect(observations.filter((event) => event.kind === "http-request").every((event) =>
        event.headers["x-api-key"] === "[REDACTED]" && event.headers["x-tenant"] === "supplier-eu"))
        .toBe(true);
    } finally {
      await session.close();
    }
  });

  it("uses pure None authentication without sending credential headers", async () => {
    const fixture = await startStreamableMcpServer({
      forbiddenRequestHeaders: ["authorization", "x-api-key", "cookie"],
    });
    stop = fixture.stop;
    const session = await createStreamableMcpSessionFactory()({
      id: "00000000-0000-4000-8000-000000000406",
      projectId: "00000000-0000-4000-8000-000000000001",
      name: "None fixture",
      url: fixture.url,
      transport: "streamable-http",
      authMode: "none",
      bearerToken: null,
      headers: {},
      redactSensitiveInfo: true,
      timeoutMs: 2_000,
      status: "disconnected",
      lastProtocolVersion: null,
      lastServerInfo: null,
      lastError: null,
    }, () => {});
    try {
      await expect(session.listTools()).resolves.toEqual(expect.objectContaining({ tools: expect.any(Array) }));
      expect(fixture.receivedRequestHeaders.every((headers) =>
        headers.authorization === undefined && headers["x-api-key"] === undefined && headers.cookie === undefined)).toBe(true);
    } finally { await session.close(); }
  });

  it("sends a configured Bearer token together with custom headers", async () => {
    const fixture = await startStreamableMcpServer({
      expectedRequestHeaders: {
        authorization: "Bearer opaque.test-token_123",
        "x-tenant": "supplier-eu",
      },
    });
    stop = fixture.stop;
    const observations: WireObservation[] = [];
    const session = await createStreamableMcpSessionFactory()({
      id: "00000000-0000-4000-8000-000000000403",
      projectId: "00000000-0000-4000-8000-000000000001",
      name: "Bearer fixture",
      url: fixture.url,
      transport: "streamable-http",
      authMode: "bearer",
      bearerToken: "opaque.test-token_123",
      headers: { "X-Tenant": "supplier-eu" },
      redactSensitiveInfo: true,
      timeoutMs: 2_000,
      status: "disconnected",
      lastProtocolVersion: null,
      lastServerInfo: null,
      lastError: null,
    }, (event) => observations.push(event));

    try {
      await session.listTools();
      expect(fixture.receivedRequestHeaders.length).toBeGreaterThan(0);
      expect(fixture.receivedRequestHeaders.every((headers) =>
        headers.authorization === "Bearer opaque.test-token_123" && headers["x-tenant"] === "supplier-eu"))
        .toBe(true);
      expect(observations.filter((event) => event.kind === "http-request").every((event) =>
        event.headers.authorization === "[REDACTED]" && event.headers["x-tenant"] === "supplier-eu"))
        .toBe(true);
    } finally {
      await session.close();
    }
  });

  it("resolves literal and templated authentication values from the current Server environment", async () => {
    const fixture = await startStreamableMcpServer({
      expectedRequestHeaders: {
        authorization: "Bearer server-token",
        "x-tenant": "supplier-eu",
        "x-region": "region-global",
        "x-literal": "kept",
      },
    });
    stop = fixture.stop;
    const session = await createStreamableMcpSessionFactory({
      resolveEnvironment: () => ({
        project: { TOKEN: "project-token", REGION: "global" },
        server: { TOKEN: "server-token", TENANT: "supplier-eu" },
      }),
    })({
      id: "00000000-0000-4000-8000-000000000404",
      projectId: "00000000-0000-4000-8000-000000000001",
      name: "Environment fixture",
      url: fixture.url,
      transport: "streamable-http",
      authMode: "bearer",
      bearerToken: "{{TOKEN}}",
      headers: { "X-Tenant": "{{TENANT}}", "X-Region": "region-{{REGION}}", "X-Literal": "kept" },
      redactSensitiveInfo: true,
      timeoutMs: 2_000,
      status: "disconnected",
      lastProtocolVersion: null,
      lastServerInfo: null,
      lastError: null,
    }, () => {});

    try {
      await session.listTools();
      expect(fixture.receivedRequestHeaders.every((headers) =>
        headers.authorization === "Bearer server-token" && headers["x-tenant"] === "supplier-eu" &&
        headers["x-region"] === "region-global" && headers["x-literal"] === "kept")).toBe(true);
    } finally {
      await session.close();
    }
  });

  it("uses connection-scoped OAuth tokens against a real authenticated MCP fixture", async () => {
    const fixture = await startStreamableMcpServer({
      expectedRequestHeaders: { authorization: "Bearer oauth-connection-token" },
    });
    stop = fixture.stop;
    const oauth = new OAuthFlowCoordinator({
      redirectUrl: () => "http://127.0.0.1/oauth/callback",
      openAuthorizationUrl: () => undefined,
    });
    const connectionId = "00000000-0000-4000-8000-000000000405";
    await oauth.provider(connectionId, () => { throw new Error("Authorization must not restart"); })
      .saveTokens({ access_token: "oauth-connection-token", token_type: "Bearer" });
    const session = await createStreamableMcpSessionFactory({ oauth })({
      id: connectionId,
      projectId: "00000000-0000-4000-8000-000000000001",
      name: "OAuth fixture",
      url: fixture.url,
      transport: "streamable-http",
      authMode: "oauth",
      bearerToken: null,
      headers: {},
      redactSensitiveInfo: true,
      timeoutMs: 2_000,
      status: "disconnected",
      lastProtocolVersion: null,
      lastServerInfo: null,
      lastError: null,
    }, () => {});

    try {
      await expect(session.listTools()).resolves.toEqual(expect.objectContaining({
        tools: expect.arrayContaining([expect.objectContaining({ name: "sum" })]),
      }));
      expect(fixture.receivedRequestHeaders.length).toBeGreaterThan(0);
      expect(fixture.receivedRequestHeaders.every((headers) =>
        headers.authorization === "Bearer oauth-connection-token")).toBe(true);
    } finally {
      await session.close();
    }
  });

  it("isolates OAuth and Bearer credentials by connection ID on the same URL", async () => {
    const oauthFixture = await startStreamableMcpServer({
      expectedRequestHeaders: { authorization: "Bearer oauth-only-token" },
      closeResponseConnection: true,
    });
    stop = oauthFixture.stop;
    const port = new URL(oauthFixture.url).port;
    const oauth = new OAuthFlowCoordinator({
      redirectUrl: () => "http://127.0.0.1/oauth/callback",
      openAuthorizationUrl: () => undefined,
    });
    const oauthId = "00000000-0000-4000-8000-000000000407";
    const bearerId = "00000000-0000-4000-8000-000000000408";
    await oauth.provider(oauthId, () => { throw new Error("Authorization must not restart"); })
      .saveTokens({ access_token: "oauth-only-token", token_type: "Bearer" });
    const factory = createStreamableMcpSessionFactory({ oauth });
    const base = {
      projectId: "00000000-0000-4000-8000-000000000001",
      url: oauthFixture.url,
      transport: "streamable-http" as const,
      headers: {},
      redactSensitiveInfo: true,
      timeoutMs: 2_000,
      status: "disconnected" as const,
      lastProtocolVersion: null,
      lastServerInfo: null,
      lastError: null,
    };
    const oauthSession = await factory({ ...base, id: oauthId, name: "OAuth same URL",
      authMode: "oauth", bearerToken: null }, () => {});
    try {
      await oauthSession.listTools();
      const oauthHeaders = [...oauthFixture.receivedRequestHeaders];
      expect(oauthHeaders.every((headers) => headers.authorization === "Bearer oauth-only-token")).toBe(true);
      await oauthSession.close();
      await oauthFixture.stop();

      const bearerFixture = await startStreamableMcpServer({
        port: Number(port),
        expectedRequestHeaders: { authorization: "Bearer bearer-only-token" },
        closeResponseConnection: true,
      });
      stop = bearerFixture.stop;
      expect(bearerFixture.url).toBe(base.url);
      const bearerSession = await factory({ ...base, id: bearerId, name: "Bearer same URL",
        authMode: "bearer", bearerToken: "bearer-only-token" }, () => {});
      try {
        await bearerSession.listTools();
        expect(bearerFixture.receivedRequestHeaders.length).toBeGreaterThan(0);
        expect(bearerFixture.receivedRequestHeaders.every((headers) =>
          headers.authorization === "Bearer bearer-only-token")).toBe(true);
        expect(JSON.stringify(oauthHeaders)).not.toContain("bearer-only-token");
        expect(JSON.stringify(bearerFixture.receivedRequestHeaders)).not.toContain("oauth-only-token");
      } finally { await bearerSession.close(); }
    } finally {
      await oauthSession.close().catch(() => undefined);
    }
  });
});
