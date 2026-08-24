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

interface BodyCapture {
  bytes: Uint8Array;
  capturedBytes: number;
  truncated: boolean;
}

interface TextMetadata {
  text: string;
  capturedBytes: number;
  truncated: boolean;
}

function textMetadata(capture: BodyCapture): TextMetadata {
  const decoder = new TextDecoder();
  return {
    text: capture.truncated
      ? decoder.decode(capture.bytes, { stream: true })
      : decoder.decode(capture.bytes),
    capturedBytes: capture.capturedBytes,
    truncated: capture.truncated,
  };
}

async function readBodyBounded(
  body: ReadableStream<Uint8Array> | null,
  onChunk?: (chunk: Uint8Array, final: boolean) => void,
): Promise<BodyCapture> {
  if (body === null) return { bytes: new Uint8Array(), capturedBytes: 0, truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let capturedBytes = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        onChunk?.(new Uint8Array(), true);
        break;
      }
      const remaining = OBSERVATION_TEXT_LIMIT - capturedBytes;
      if (value.byteLength > remaining) {
        const captured = value.subarray(0, remaining);
        if (captured.byteLength > 0) {
          chunks.push(captured);
          capturedBytes += captured.byteLength;
          onChunk?.(captured, false);
        }
        truncated = true;
        onChunk?.(new Uint8Array(), true);
        void reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
      capturedBytes += value.byteLength;
      onChunk?.(value, false);
      if (capturedBytes === OBSERVATION_TEXT_LIMIT) {
        truncated = true;
        void reader.cancel().catch(() => undefined);
        onChunk?.(new Uint8Array(), true);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(capturedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, capturedBytes, truncated };
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
      const capture = await readBodyBounded(request.clone().body);
      const metadata = textMetadata(capture);
      body = capture.truncated ? metadata : parseJson(metadata.text) ?? metadata;
    } catch {
      body = { text: "[unavailable]", capturedBytes: 0, truncated: false };
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
): Promise<TextMetadata> {
  const body = response.clone().body;
  const decoder = new TextDecoder();
  const parser = createSseParser(observer, now);
  const capture = await readBodyBounded(body, (chunk, final) => {
    parser.push(decoder.decode(chunk, { stream: !final }), final);
  });
  return textMetadata(capture);
}

async function observeResponseBody(
  response: Response,
  contentType: string,
  observer: Observer,
  now: () => Date,
): Promise<{ body: unknown; rpc?: unknown }> {
  try {
    const capture = await readBodyBounded(response.clone().body);
    const metadata = textMetadata(capture);
    const parsed = contentType.includes("application/json") && !capture.truncated
      ? parseJson(metadata.text)
      : undefined;
    if (parsed !== undefined) {
      return { body: parsed, rpc: parsed };
    }
    return { body: metadata };
  } catch {
    return { body: { text: "[unavailable]", capturedBytes: 0, truncated: false } };
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
    void observeRequest(request, observer, now().toISOString()).catch(() => undefined);
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
      void observeSseResponse(response, observer, now)
        .then((body) => emit(observer, { ...responseEvent, body }))
        .catch(() => emit(observer, {
          ...responseEvent,
          body: { text: "[unavailable]", capturedBytes: 0, truncated: false },
        }));
      return response;
    }
    void observeResponseBody(response, contentType, observer, now)
      .then((observedBody) => {
        emit(observer, { ...responseEvent, body: observedBody.body });
        if (observedBody.rpc !== undefined) {
          emit(observer, { kind: "rpc-in", at: now().toISOString(), message: observedBody.rpc });
        }
      })
      .catch(() => undefined);
    return response;
  };
}
