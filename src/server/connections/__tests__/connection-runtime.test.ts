import { describe, expect, it, vi } from "vitest";
import { ProtocolError } from "@modelcontextprotocol/client";
import { FakeMcpSession } from "../../../../test-support/fake-mcp-session.js";
import {
  CallCancelledError,
  CallTimeoutError,
  createConnectionRuntime,
  type WireObservation,
} from "../connection-runtime.js";
import type { ConnectionRecord } from "../connection-types.js";
import { createStreamableMcpSessionFactory } from "../streamable-session.js";

const connection: ConnectionRecord = {
  id: "00000000-0000-4000-8000-000000000401",
  projectId: "00000000-0000-4000-8000-000000000001",
  name: "Fake MCP",
  url: "http://127.0.0.1:1/mcp",
  transport: "streamable-http",
  authMode: "none",
  timeoutMs: 20,
  status: "disconnected",
  lastProtocolVersion: null,
  lastServerInfo: null,
  lastError: null,
};

describe("ConnectionRuntime", () => {
  it("coalesces concurrent connects and shares the resolved session", async () => {
    const session = new FakeMcpSession();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const factory = vi.fn(async () => {
      await gate;
      return session;
    });
    const runtime = createConnectionRuntime({
      resolveConnection: () => connection,
      factory,
    });

    const first = runtime.connect(connection.id);
    const second = runtime.connect(connection.id);
    release();

    await expect(first).resolves.toBe(session);
    await expect(second).resolves.toBe(session);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(runtime.get(connection.id)).toBe(session);
  });

  it("does not leave a phantom connecting state when resolution fails", () => {
    const runtime = createConnectionRuntime({
      resolveConnection: () => { throw new Error("missing"); },
      factory: async () => new FakeMcpSession(),
    });

    expect(() => runtime.connect(connection.id)).toThrow("missing");
    expect(runtime.status(connection.id)).toBe("disconnected");
  });

  it("discards a failed attempt, records failure, and permits retry", async () => {
    const session = new FakeMcpSession();
    const persistFailure = vi.fn();
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error("dial secret detail"))
      .mockResolvedValueOnce(session);
    const runtime = createConnectionRuntime({
      resolveConnection: () => connection,
      persistFailure,
      factory,
    });

    await expect(runtime.connect(connection.id)).rejects.toThrow(/connect/i);
    expect(runtime.get(connection.id)).toBeUndefined();
    expect(persistFailure).toHaveBeenCalledWith(connection.id, {
      code: "MCP_CONNECT_FAILED",
      message: "Unable to connect to MCP server",
    });
    await expect(runtime.connect(connection.id)).resolves.toBe(session);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("closes a negotiated session when metadata persistence fails", async () => {
    const session = new FakeMcpSession();
    const runtime = createConnectionRuntime({
      resolveConnection: () => connection,
      factory: async () => session,
      persistSuccess: () => { throw new Error("database closed"); },
    });

    await expect(runtime.connect(connection.id)).rejects.toThrow(/connect/i);
    expect(session.closeCount).toBe(1);
    expect(runtime.get(connection.id)).toBeUndefined();
    expect(runtime.status(connection.id)).toBe("failed");
  });

  it("closes exactly once and removes a connected session", async () => {
    const session = new FakeMcpSession();
    const runtime = createConnectionRuntime({
      resolveConnection: () => connection,
      factory: async () => session,
    });
    await runtime.connect(connection.id);

    await Promise.all([
      runtime.disconnect(connection.id),
      runtime.disconnect(connection.id),
    ]);

    expect(session.closeCount).toBe(1);
    expect(runtime.get(connection.id)).toBeUndefined();
  });

  it("waits for disconnect before establishing a replacement session", async () => {
    const first = new FakeMcpSession();
    const second = new FakeMcpSession();
    let releaseClose!: () => void;
    let markCloseStarted!: () => void;
    const closeGate = new Promise<void>((resolve) => { releaseClose = resolve; });
    const closeStarted = new Promise<void>((resolve) => { markCloseStarted = resolve; });
    first.close = async () => {
      markCloseStarted();
      await closeGate;
      first.closeCount += 1;
    };
    const factory = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const runtime = createConnectionRuntime({ resolveConnection: () => connection, factory });
    await runtime.connect(connection.id);

    const disconnecting = runtime.disconnect(connection.id);
    await closeStarted;
    const reconnecting = runtime.connect(connection.id);
    await Promise.resolve();
    expect(factory).toHaveBeenCalledTimes(1);
    releaseClose();

    await disconnecting;
    await expect(reconnecting).resolves.toBe(second);
    expect(first.closeCount).toBe(1);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("invalidates an in-flight connect on disconnect without recording a network failure", async () => {
    const session = new FakeMcpSession();
    const persistFailure = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runtime = createConnectionRuntime({
      resolveConnection: () => connection,
      persistFailure,
      factory: async () => { await gate; return session; },
    });
    const connecting = runtime.connect(connection.id);
    const disconnecting = runtime.disconnect(connection.id);
    release();

    await expect(connecting).rejects.toThrow(/connect/i);
    await disconnecting;
    expect(session.closeCount).toBe(1);
    expect(runtime.status(connection.id)).toBe("disconnected");
    expect(persistFailure).not.toHaveBeenCalled();
  });

  it("propagates an invalidated session close failure through disconnect and clears state", async () => {
    const session = new FakeMcpSession();
    session.close = async () => { throw new Error("close socket failed"); };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const persistFailure = vi.fn();
    const runtime = createConnectionRuntime({
      resolveConnection: () => connection,
      persistFailure,
      factory: async () => { await gate; return session; },
    });
    const connecting = runtime.connect(connection.id);
    const disconnecting = runtime.disconnect(connection.id);
    release();

    await expect(connecting).rejects.toThrow(/disconnect/i);
    await expect(disconnecting).rejects.toThrow(/disconnect/i);
    expect(runtime.get(connection.id)).toBeUndefined();
    expect(runtime.status(connection.id)).toBe("disconnected");
    expect(persistFailure).not.toHaveBeenCalled();
  });

  it("isolates observers for concurrent calls on a shared session", async () => {
    const session = new FakeMcpSession();
    session.call = async ({ name, observe }) => {
      await new Promise((resolve) => setTimeout(resolve, name === "slow" ? 8 : 1));
      observe?.({ kind: "rpc-in", at: "2026-08-17T00:00:00.000Z", message: { name } });
      return { content: [{ type: "text", text: name }] };
    };
    const runtime = createConnectionRuntime({
      resolveConnection: () => ({ ...connection, timeoutMs: 100 }),
      factory: async () => session,
    });
    await runtime.connect(connection.id);
    const slow: WireObservation[] = [];
    const fast: WireObservation[] = [];

    await Promise.all([
      runtime.callTool(connection.id, { name: "slow", arguments: {}, observe: (event) => slow.push(event) }),
      runtime.callTool(connection.id, { name: "fast", arguments: {}, observe: (event) => fast.push(event) }),
    ]);

    expect(slow).toEqual([expect.objectContaining({ message: { name: "slow" } })]);
    expect(fast).toEqual([expect.objectContaining({ message: { name: "fast" } })]);
  });

  it("distinguishes timeout from caller cancellation without closing or retrying", async () => {
    const session = new FakeMcpSession();
    session.call = ({ signal }) => new Promise((_, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const runtime = createConnectionRuntime({
      resolveConnection: () => connection,
      factory: async () => session,
    });
    await runtime.connect(connection.id);

    await expect(runtime.callTool(connection.id, { name: "wait", arguments: {} }))
      .rejects.toBeInstanceOf(CallTimeoutError);
    const controller = new AbortController();
    const cancelled = runtime.callTool(connection.id, {
      name: "cancel", arguments: {}, signal: controller.signal,
    });
    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(CallCancelledError);
    expect(session.calls).toHaveLength(2);
    expect(session.closeCount).toBe(0);
    expect(runtime.get(connection.id)).toBe(session);
  });
});

describe("createStreamableMcpSessionFactory", () => {
  it("sends tools/call exactly once through the low-level request path", async () => {
    const callTool = vi.fn(async () => { throw new Error("HEADER_MISMATCH would retry"); });
    const request = vi.fn(async (
      _request: unknown,
      _resultSchema: unknown,
      _options?: unknown,
    ) => ({ content: [{ type: "text" as const, text: "ok" }] }));
    const factory = createStreamableMcpSessionFactory({
      createClient: () => ({
        connect: async () => undefined,
        getServerVersion: () => undefined,
        listTools: async () => ({ tools: [] }),
        callTool,
        request,
        close: async () => undefined,
      }),
      createTransport: () => ({
        start: async () => undefined,
        send: async () => undefined,
        close: async () => undefined,
      }),
    });
    const session = await factory(connection, () => undefined);

    await expect(session.callTool({ name: "once", arguments: { value: 1 } }))
      .resolves.toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toEqual({
      method: "tools/call",
      params: { name: "once", arguments: { value: 1 } },
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("does not refresh or resend tools/call after HEADER_MISMATCH", async () => {
    const listTools = vi.fn(async () => ({ tools: [] }));
    const request = vi.fn(async () => {
      throw new ProtocolError(-32020, "HEADER_MISMATCH");
    });
    const factory = createStreamableMcpSessionFactory({
      createClient: () => ({
        connect: async () => undefined,
        getServerVersion: () => undefined,
        listTools,
        callTool: async () => ({ content: [] }),
        request,
        close: async () => undefined,
      }),
      createTransport: () => ({
        start: async () => undefined,
        send: async () => undefined,
        close: async () => undefined,
      }),
    });
    const session = await factory(connection, () => undefined);

    await expect(session.callTool({ name: "once", arguments: { value: 1 } }))
      .rejects.toMatchObject({ code: -32020 });
    expect(request).toHaveBeenCalledOnce();
    expect(listTools).not.toHaveBeenCalled();
  });

  it("closes a partially initialized client when connect fails", async () => {
    const close = vi.fn(async () => undefined);
    const factory = createStreamableMcpSessionFactory({
      createClient: () => ({
        connect: async () => { throw new Error("initialize failed"); },
        getServerVersion: () => undefined,
        listTools: async () => ({ tools: [] }),
        callTool: async () => ({ content: [] }),
        request: async () => ({ content: [] }),
        close,
      }),
      createTransport: () => ({
        start: async () => undefined,
        send: async () => undefined,
        close: async () => undefined,
      }),
    });

    await expect(factory(connection, () => undefined)).rejects.toThrow("initialize failed");
    expect(close).toHaveBeenCalledOnce();
  });

  it("routes observed fetch events through the active async call context", async () => {
    let observedFetch!: (url: string | URL, init?: RequestInit) => Promise<Response>;
    const connectionEvents: WireObservation[] = [];
    const factory = createStreamableMcpSessionFactory({
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as { id: string };
        await new Promise((resolve) => setTimeout(resolve, request.id === "slow" ? 8 : 1));
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }), {
          headers: { "content-type": "application/json" },
        });
      },
      createTransport: (_url, fetch) => {
        observedFetch = fetch;
        return { start: async () => undefined, send: async () => undefined, close: async () => undefined };
      },
      createClient: () => ({
        connect: async () => undefined,
        getServerVersion: () => ({ name: "fake", version: "1" }),
        listTools: async () => ({ tools: [] }),
        callTool: async ({ name }) => {
          await observedFetch("http://127.0.0.1/mcp", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: name, method: "tools/call" }),
          });
          return { content: [] };
        },
        request: async ({ params }) => {
          const name = params.name;
          await observedFetch("http://127.0.0.1/mcp", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: name, method: "tools/call" }),
          });
          return { content: [] };
        },
        close: async () => undefined,
      }),
    });
    const session = await factory({ ...connection, timeoutMs: 100 }, (event) => connectionEvents.push(event));
    const slow: WireObservation[] = [];
    const fast: WireObservation[] = [];

    await Promise.all([
      session.callTool({ name: "slow", arguments: {}, observe: (event) => slow.push(event) }),
      session.callTool({ name: "fast", arguments: {}, observe: (event) => fast.push(event) }),
    ]);

    expect(connectionEvents).toEqual([]);
    expect(JSON.stringify(slow)).toContain('"id":"slow"');
    expect(JSON.stringify(slow)).not.toContain('"id":"fast"');
    expect(JSON.stringify(fast)).toContain('"id":"fast"');
    expect(JSON.stringify(fast)).not.toContain('"id":"slow"');
  });
});
