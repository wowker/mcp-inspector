import { describe, expect, it, vi } from "vitest";
import { createObservedFetch, OBSERVATION_TEXT_LIMIT } from "../observed-fetch.js";
import type { WireObservation } from "../connection-runtime.js";

async function settleParser(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await settleParser();
  }
  throw new Error("Timed out waiting for observation");
}

describe("createObservedFetch", () => {
  it("observes JSON request and response without consuming originals and redacts secrets", async () => {
    const events: WireObservation[] = [];
    const baseFetch = vi.fn(async (request: string | URL, init?: RequestInit) => {
      expect(events.map((event) => event.kind)).toEqual(["http-request", "rpc-out"]);
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

    expect(events).toHaveLength(4);
    const requestEvent = events.find((event) => event.kind === "http-request");
    const responseEvent = events.find((event) => event.kind === "http-response");
    const requestExchange = requestEvent !== undefined && "exchangeId" in requestEvent ? requestEvent.exchangeId : undefined;
    const responseExchange = responseEvent !== undefined && "exchangeId" in responseEvent ? responseEvent.exchangeId : undefined;
    expect(requestExchange).toBeDefined();
    expect(responseExchange).toBe(requestExchange);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
    expect(events).toEqual([
      expect.objectContaining({ kind: "http-request", headers: expect.objectContaining({ authorization: "[REDACTED]", cookie: "[REDACTED]" }) }),
      expect.objectContaining({ kind: "rpc-out", message: { jsonrpc: "2.0", id: 1, method: "tools/list" } }),
      expect.objectContaining({ kind: "http-response", headers: expect.objectContaining({ "set-cookie": "[REDACTED]" }) }),
      expect.objectContaining({ kind: "rpc-in", message: { jsonrpc: "2.0", id: 1, result: { tools: [] } } }),
    ]);
  });

  it("captures original sensitive headers only when redaction is explicitly disabled", async () => {
    const events: WireObservation[] = [];
    const observed = createObservedFetch(
      async () => new Response("ok", { headers: { "set-cookie": "session=response-secret" } }),
      (event) => events.push(event),
      { redactSensitiveInfo: false },
    );

    await observed("http://127.0.0.1/mcp?access_token=request-secret&cursor=next", {
      headers: { Authorization: "Bearer request-secret", Cookie: "session=request-secret" },
    });

    expect(events).toEqual([
      expect.objectContaining({ kind: "http-request", url: "http://127.0.0.1/mcp?cursor=next", headers: expect.objectContaining({
        authorization: "Bearer request-secret", cookie: "session=request-secret",
      }) }),
      expect.objectContaining({ kind: "http-response", headers: expect.objectContaining({
        "set-cookie": "session=response-secret",
      }) }),
    ]);
    expect(JSON.stringify(events)).not.toContain("request-secret&cursor");
  });

  it("removes credential aliases while preserving ordinary routing query values", async () => {
    const events: WireObservation[] = [];
    const observed = createObservedFetch(async () => new Response("ok"), (event) => events.push(event));

    await observed("http://127.0.0.1/mcp?auth=a&key=b&sig=c&access_key=d&tenant=e&cursor=next");

    expect(events[0]).toEqual(expect.objectContaining({
      kind: "http-request",
      url: "http://127.0.0.1/mcp?tenant=e&cursor=next",
    }));
    expect(JSON.stringify(events)).not.toMatch(/(?:auth=a|key=b|sig=c|access_key=d)/);
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

  it("emits the SSE response before parsing a frame from a stream that stays open", async () => {
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
    const responseIndex = events.findIndex((event) => event.kind === "http-response");
    expect(responseIndex).toBeGreaterThanOrEqual(0);
    expect(events[responseIndex]).toEqual(expect.objectContaining({
      body: { stream: true, captureLimitBytes: OBSERVATION_TEXT_LIMIT },
    }));
    await waitFor(() => events.some((event) => event.kind === "rpc-in"));
    const rpcIndex = events.findIndex((event) => event.kind === "rpc-in");
    expect(responseIndex).toBeLessThan(rpcIndex);
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
    await waitFor(() => events.some((event) => event.kind === "http-response"));

    expect(events.find((event) => event.kind === "http-response")).toEqual(expect.objectContaining({
      body: {
        text: "x".repeat(OBSERVATION_TEXT_LIMIT),
        capturedBytes: OBSERVATION_TEXT_LIMIT,
        truncated: true,
      },
    }));
  });

  it("caps request and response metadata by UTF-8 bytes", async () => {
    const events: WireObservation[] = [];
    const text = "界".repeat(Math.ceil(OBSERVATION_TEXT_LIMIT / 3) + 20);
    const observed = createObservedFetch(
      async (input, init) => {
        expect(await new Request(input, init).text()).toBe(text);
        return new Response(text, { headers: { "content-type": "text/plain" } });
      },
      (event) => events.push(event),
    );

    const response = await observed("http://127.0.0.1/mcp", { method: "POST", body: text });
    expect(await response.text()).toBe(text);
    await waitFor(() => events.filter((event) =>
      event.kind === "http-request" || event.kind === "http-response").length === 2);

    for (const event of events.filter((candidate) =>
      candidate.kind === "http-request" || candidate.kind === "http-response")) {
      expect(event.body).toEqual(expect.objectContaining({
        capturedBytes: OBSERVATION_TEXT_LIMIT,
        truncated: true,
      }));
      const body = event.body as { text: string };
      expect(new TextEncoder().encode(body.text).byteLength).toBeLessThanOrEqual(OBSERVATION_TEXT_LIMIT);
    }
  });

  it("captures a non-closing request at the byte cap before fetching without locking its original", async () => {
    const events: WireObservation[] = [];
    const chunk = new Uint8Array(OBSERVATION_TEXT_LIMIT + 20).fill(120);
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(chunk); } });
    const baseFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(events.find((event) => event.kind === "http-request")).toEqual(expect.objectContaining({
        body: expect.objectContaining({ capturedBytes: OBSERVATION_TEXT_LIMIT, truncated: true }),
      }));
      const request = new Request(input, init);
      const original = await request.body?.getReader().read();
      expect(original?.value?.byteLength).toBe(chunk.byteLength);
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    });
    const observed = createObservedFetch(baseFetch, (event) => events.push(event));

    await observed("http://127.0.0.1/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);

    expect(baseFetch).toHaveBeenCalledOnce();
  });

  it("returns an unclosed SSE response immediately with one stream marker", async () => {
    const events: WireObservation[] = [];
    const prefix = new TextEncoder().encode("data: {\"jsonrpc\":\"2.0\",\"method\":\"early\"}\n\n");
    const padding = new Uint8Array(OBSERVATION_TEXT_LIMIT + 20).fill(120);
    const chunk = new Uint8Array(prefix.byteLength + padding.byteLength);
    chunk.set(prefix);
    chunk.set(padding, prefix.byteLength);
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(chunk); } });
    const observed = createObservedFetch(
      async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
      (event) => events.push(event),
    );

    const response = await observed("http://127.0.0.1/mcp");
    const original = await response.body?.getReader().read();
    expect(original?.value?.byteLength).toBe(chunk.byteLength);
    expect(events.find((event) => event.kind === "http-response")).toEqual(expect.objectContaining({
      body: { stream: true, captureLimitBytes: OBSERVATION_TEXT_LIMIT },
    }));
    await waitFor(() => events.some((event) => event.kind === "rpc-in"));

    expect(events.some((event) => event.kind === "rpc-in" && "message" in event &&
      JSON.stringify(event.message).includes("early"))).toBe(true);
    expect(events.filter((event) => event.kind === "http-response")).toHaveLength(1);
  });

  it("returns a non-closing plain response after capturing the byte cap", async () => {
    const events: WireObservation[] = [];
    const chunk = new Uint8Array(OBSERVATION_TEXT_LIMIT + 20).fill(120);
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(chunk); } });
    const observed = createObservedFetch(async () => new Response(body, {
      headers: { "content-type": "text/plain" },
    }), (event) => events.push(event));

    const response = await observed("http://127.0.0.1/mcp");

    expect(events.find((event) => event.kind === "http-response")).toEqual(expect.objectContaining({
      body: expect.objectContaining({ capturedBytes: OBSERVATION_TEXT_LIMIT, truncated: true }),
    }));
    const original = await response.body?.getReader().read();
    expect(original?.value?.byteLength).toBe(chunk.byteLength);
  });

  it("emits unavailable response metadata before returning when cloning fails", async () => {
    const events: WireObservation[] = [];
    const consumed = new Response("used", { headers: { "content-type": "application/json" } });
    await consumed.text();
    const observed = createObservedFetch(async () => consumed, (event) => events.push(event));

    const returned = await observed("http://127.0.0.1/mcp");

    expect(returned).toBe(consumed);
    expect(events.find((event) => event.kind === "http-response")).toEqual(expect.objectContaining({
      body: { text: "[unavailable]", capturedBytes: 0, truncated: false },
    }));
  });
});
