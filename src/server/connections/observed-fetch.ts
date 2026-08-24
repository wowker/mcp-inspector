import type { FetchLike } from "@modelcontextprotocol/client";
import type { WireObservation } from "./connection-runtime.js";

export const OBSERVATION_TEXT_LIMIT = 64 * 1024;
const sensitiveHeaders = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
]);

type Observer = (event: WireObservation) => void;

function emit(observer: Observer, event: WireObservation): void {
  try { observer(event); } catch { /* Observability must not alter transport behavior. */ }
}

function headersObject(headers: Headers): Record<string, string> {
  return Object.fromEntries(Array.from(headers.entries(), ([name, value]) => [
    name,
    sensitiveHeaders.has(name.toLowerCase()) ? "[REDACTED]" : value,
  ]));
}

function boundedText(text: string): { text: string; truncated: boolean } {
  return text.length <= OBSERVATION_TEXT_LIMIT
    ? { text, truncated: false }
    : { text: `${text.slice(0, OBSERVATION_TEXT_LIMIT)}…`, truncated: true };
}

function parseJson(text: string): unknown | undefined {
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

async function observeRequest(
  request: Request,
  observer: Observer,
  at: string,
): Promise<void> {
  let body: unknown = null;
  if (request.body !== null) {
    try {
      const text = await request.clone().text();
      body = text.length <= OBSERVATION_TEXT_LIMIT
        ? parseJson(text) ?? boundedText(text)
        : boundedText(text);
    } catch {
      body = { text: "[unavailable]", truncated: false };
    }
  }
  emit(observer, {
    kind: "http-request",
    at,
    method: request.method,
    url: request.url,
    headers: headersObject(request.headers),
    body,
  });
  if (request.headers.get("content-type")?.toLowerCase().includes("application/json") === true) {
    const message = typeof body === "object" && body !== null && "text" in body ? undefined : body;
    if (message !== undefined) emit(observer, { kind: "rpc-out", at, message });
  }
}

function createSseParser(observer: Observer, now: () => Date) {
  let buffer = "";
  let data: string[] = [];
  const dispatch = () => {
    if (data.length === 0) return;
    const message = parseJson(data.join("\n"));
    if (message !== undefined) {
      emit(observer, { kind: "rpc-in", at: now().toISOString(), message });
    }
    data = [];
  };

  const acceptLine = (line: string) => {
    if (line === "") dispatch();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  };

  return {
    push(text: string, final = false) {
      buffer += text;
      while (true) {
        const match = /[\r\n]/.exec(buffer);
        if (match === null) break;
        const index = match.index;
        if (!final && buffer[index] === "\r" && index === buffer.length - 1) break;
        acceptLine(buffer.slice(0, index));
        const delimiterLength = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
        buffer = buffer.slice(index + delimiterLength);
      }
      if (final && buffer.length > 0) {
        acceptLine(buffer);
        buffer = "";
      }
    },
  };
}

async function observeSseResponse(
  response: Response,
  observer: Observer,
  now: () => Date,
): Promise<void> {
  const body = response.clone().body;
  if (body === null) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser(observer, now);
  let remaining = OBSERVATION_TEXT_LIMIT;
  try {
    while (remaining > 0) {
      const { done, value } = await reader.read();
      if (done) {
        parser.push(decoder.decode(), true);
        return;
      }
      const captured = value.byteLength <= remaining ? value : value.subarray(0, remaining);
      remaining -= captured.byteLength;
      parser.push(decoder.decode(captured, { stream: true }));
    }
    await reader.cancel();
  } finally {
    reader.releaseLock();
  }
}

async function observeResponseBody(
  response: Response,
  contentType: string,
  observer: Observer,
  now: () => Date,
): Promise<{ body: unknown; rpc?: unknown }> {
  try {
    const text = await response.clone().text();
    const parsed = contentType.includes("application/json") && text.length <= OBSERVATION_TEXT_LIMIT
      ? parseJson(text)
      : undefined;
    if (parsed !== undefined) {
      return { body: parsed, rpc: parsed };
    }
    return { body: boundedText(text) };
  } catch {
    return { body: { text: "[unavailable]", truncated: false } };
  }
}

export function createObservedFetch(
  baseFetch: FetchLike,
  observer: Observer,
  options: { now?: () => Date } = {},
): FetchLike {
  const now = options.now ?? (() => new Date());
  return async (input, init) => {
    const request = new Request(input, init);
    await observeRequest(request, observer, now().toISOString());
    const response = await baseFetch(input, init);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const responseEvent = {
      kind: "http-response" as const,
      at: now().toISOString(),
      status: response.status,
      headers: headersObject(response.headers),
      body: null as unknown,
    };
    if (contentType.includes("text/event-stream")) {
      responseEvent.body = { stream: true };
      emit(observer, responseEvent);
      void observeSseResponse(response, observer, now).catch(() => undefined);
      return response;
    }
    const observedBody = await observeResponseBody(response, contentType, observer, now);
    responseEvent.body = observedBody.body;
    emit(observer, responseEvent);
    if (observedBody.rpc !== undefined) {
      emit(observer, { kind: "rpc-in", at: now().toISOString(), message: observedBody.rpc });
    }
    return response;
  };
}
