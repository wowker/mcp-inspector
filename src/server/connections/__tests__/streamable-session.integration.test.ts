import { afterEach, describe, expect, it } from "vitest";
import { startStreamableMcpServer } from "../../../../test-support/streamable-mcp-server.js";
import type { WireObservation } from "../connection-runtime.js";
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
});
