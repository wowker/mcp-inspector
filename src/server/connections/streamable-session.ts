import { AsyncLocalStorage } from "node:async_hooks";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type FetchLike,
  type Tool,
  type Transport,
  specTypeSchemas,
} from "@modelcontextprotocol/client";
import { DialectAwareJsonSchemaValidator } from "./dialect-aware-validator.js";
import { createObservedFetch } from "./observed-fetch.js";
import type {
  McpSession,
  McpSessionFactory,
  WireObservation,
} from "./connection-runtime.js";

type Observer = (event: WireObservation) => void;

interface ClientLike {
  connect(transport: Transport, options?: { timeout?: number }): Promise<void>;
  getServerVersion(): { name: string; version: string } | undefined;
  listTools(input?: { cursor?: string }): Promise<{ tools: Tool[]; nextCursor?: string }>;
  callTool(
    input: { name: string; arguments?: Record<string, unknown> },
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<CallToolResult>;
  request(
    request: { method: "tools/call"; params: { name: string; arguments?: Record<string, unknown> } },
    resultSchema: typeof specTypeSchemas.CallToolResult,
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<CallToolResult>;
  close(): Promise<void>;
}

type TransportLike = Transport & { protocolVersion?: string };

export function createStreamableMcpSessionFactory(options: {
  appVersion?: string;
  fetch?: FetchLike;
  createClient?: () => ClientLike;
  createTransport?: (url: URL, fetch: FetchLike) => TransportLike;
} = {}): McpSessionFactory {
  const observerContext = new AsyncLocalStorage<Observer | undefined>();
  const baseFetch: FetchLike = options.fetch ?? globalThis.fetch;
  const createClient: () => ClientLike = options.createClient ?? (() => new Client(
    { name: "dsers-mcp-inspector", version: options.appVersion ?? "0.1.0" },
    { capabilities: {}, jsonSchemaValidator: new DialectAwareJsonSchemaValidator() },
  ));

  return async (connection, connectionObserver) => {
    const dispatch: Observer = (event) => {
      (observerContext.getStore() ?? connectionObserver)(event);
    };
    const observedFetch = createObservedFetch(baseFetch, dispatch);
    const transport = options.createTransport?.(new URL(connection.url), observedFetch)
      ?? new StreamableHTTPClientTransport(new URL(connection.url), { fetch: observedFetch });
    const client = createClient();
    try {
      await client.connect(transport, { timeout: connection.timeoutMs });
    } catch (error) {
      try { await client.close(); } catch { /* Preserve the original connection failure. */ }
      throw error;
    }
    const protocolVersion = transport.protocolVersion ?? "unknown";
    const server = client.getServerVersion();

    const session: McpSession = {
      protocolVersion,
      serverInfo: server === undefined ? null : { name: server.name, version: server.version },
      async listTools(input) {
        const result = await client.listTools(input);
        return { tools: result.tools, nextCursor: result.nextCursor };
      },
      callTool(input) {
        return observerContext.run(input.observe, () => client.request(
          {
            method: "tools/call",
            params: { name: input.name, arguments: input.arguments },
          },
          specTypeSchemas.CallToolResult,
          { signal: input.signal, timeout: connection.timeoutMs },
        ));
      },
      close() {
        return client.close();
      },
    };
    return session;
  };
}
