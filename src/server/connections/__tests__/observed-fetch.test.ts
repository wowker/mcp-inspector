import { describe, expect, it, vi } from "vitest";
import { createObservedFetch, OBSERVATION_TEXT_LIMIT } from "../observed-fetch.js";
import type { WireObservation } from "../connection-runtime.js";

async function settleParser(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createObservedFetch", () => {
  it("observes JSON request and response without consuming originals and redacts secrets", async () => {
    const events: WireObservation[] = [];
    const baseFetch = vi.fn(async (request: string | URL, init?: RequestInit) => {
      const received = new Request(request, init);
      expect(await received.clone().json()).toEqual({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }), {
        headers: {
          "content-type": "application/json",
          "set-cookie": "server-secret=1",
        },
      });
    });
    const observed = createObservedFetch(baseFetch, (event) => events.push(event), {
      now: () => new Date("2026-08-17T00:00:00.000Z"),
    });

    const response = await observed("http://127.0.0.1/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer secret", Cookie: "a=b" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
    expect(events).toEqual([
      expect.objectContaining({ kind: "http-request", headers: expect.objectContaining({ authorization: "[REDACTED]", cookie: "[REDACTED]" }) }),
      expect.objectContaining({ kind: "rpc-out", message: { jsonrpc: "2.0", id: 1, method: "tools/list" } }),
      expect.objectContaining({ kind: "http-response", headers: expect.objectContaining({ "set-cookie": "[REDACTED]" }) }),
      expect.objectContaining({ kind: "rpc-in", message: { jsonrpc: "2.0", id: 1, result: { tools: [] } } }),
    ]);
  });

  it("parses CRLF and multiline SSE frames while ignoring invalid JSON", async () => {
    const events: WireObservation[] = [];
    const stream = "event: message\r\ndata: {\"jsonrpc\":\"2.0\",\r\ndata: \"method\":\"notice\"}\r\n\r\ndata: not-json\r\n\r\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}\r\n\r\n";
    const observed = createObservedFetch(
      async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }),
      (event) => events.push(event),
    );

    const response = await observed("http://127.0.0.1/mcp");
    expect(await response.text()).toBe(stream);
    await settleParser();

    expect(events.filter((event) => event.kind === "rpc-in").map((event) => "message" in event ? event.message : undefined)).toEqual([
      { jsonrpc: "2.0", method: "notice" },
      { jsonrpc: "2.0", id: 2, result: {} },
    ]);
  });

  it("emits a complete SSE event before the original stream closes", async () => {
    const events: WireObservation[] = [];
    let close!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: {\"jsonrpc\":\"2.0\",\"method\":\"live\"}\n\n"));
        close = () => controller.close();
      },
    });
    const observed = createObservedFetch(
      async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
      (event) => events.push(event),
    );

    const response = await observed("http://127.0.0.1/mcp");
    await settleParser();
    expect(events.some((event) => event.kind === "rpc-in" && "message" in event &&
      JSON.stringify(event.message).includes("live"))).toBe(true);
    close();
    await response.body?.cancel();
  });

  it("bounds unparseable metadata deterministically", async () => {
    const events: WireObservation[] = [];
    const observed = createObservedFetch(
      async () => new Response("x".repeat(OBSERVATION_TEXT_LIMIT + 10), { headers: { "content-type": "text/plain" } }),
      (event) => events.push(event),
    );
    await observed("http://127.0.0.1/mcp");

    expect(events.find((event) => event.kind === "http-response")).toEqual(expect.objectContaining({
      body: { text: `${"x".repeat(OBSERVATION_TEXT_LIMIT)}…`, truncated: true },
    }));
  });
});
