import { AsyncLocalStorage } from "node:async_hooks";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type FetchLike,
  type Tool,
  type Transport,
  specTypeSchemas,
  type StandardSchemaV1,
} from "@modelcontextprotocol/client";
import { z } from "zod";
import { toolDefinitionSchema } from "../../shared/tool-definition.js";
import { DialectAwareJsonSchemaValidator } from "./dialect-aware-validator.js";
import { createObservedFetch } from "./observed-fetch.js";
import type { OAuthFlowCoordinator } from "./oauth-flow.js";
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
    request: { method: string; params?: Record<string, unknown> },
    resultSchema: StandardSchemaV1,
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<unknown>;
  close(): Promise<void>;
}

const toolListPageSchema = z.object({
  tools: z.array(toolDefinitionSchema),
  nextCursor: z.string().optional(),
}).loose();

type TransportLike = Transport & { protocolVersion?: string };

export function createStreamableMcpSessionFactory(options: {
  appVersion?: string;
  fetch?: FetchLike;
  createClient?: () => ClientLike;
  createTransport?: (url: URL, fetch: FetchLike) => TransportLike;
  oauth?: OAuthFlowCoordinator;
} = {}): McpSessionFactory {
  const observerContext = new AsyncLocalStorage<Observer | undefined>();
  const baseFetch: FetchLike = options.fetch ?? globalThis.fetch;
  const createClient: () => ClientLike = options.createClient ?? (() => new Client(
    { name: "mcp-inspector", version: options.appVersion ?? "0.1.0" },
    { capabilities: {}, jsonSchemaValidator: new DialectAwareJsonSchemaValidator() },
  ));

  return async (connection, connectionObserver) => {
    const dispatch: Observer = (event) => {
      (observerContext.getStore() ?? connectionObserver)(event);
    };
    const observedFetch = createObservedFetch(baseFetch, dispatch, {
      redactSensitiveInfo: connection.redactSensitiveInfo,
    });
    let oauthTransport: StreamableHTTPClientTransport | undefined;
    const authProvider = connection.authMode === "oauth" && options.oauth !== undefined
      ? options.oauth.provider(connection.id, () => {
        if (oauthTransport === undefined) throw new Error("OAuth transport is unavailable");
        return oauthTransport;
      })
      : undefined;
    const transport = options.createTransport?.(new URL(connection.url), observedFetch)
      ?? (oauthTransport = new StreamableHTTPClientTransport(new URL(connection.url), {
        fetch: observedFetch,
        authProvider,
        requestInit: { headers: connection.headers },
      }));
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
        const result = await client.request(
          { method: "tools/list", params: input ?? {} },
          toolListPageSchema,
          { timeout: connection.timeoutMs },
        ) as z.output<typeof toolListPageSchema>;
        return { tools: result.tools as Tool[], nextCursor: result.nextCursor };
      },
      callTool(input) {
        return observerContext.run(input.observe, async () => await client.request(
          {
            method: "tools/call",
            params: { name: input.name, arguments: input.arguments },
          },
          specTypeSchemas.CallToolResult,
          { signal: input.signal, timeout: connection.timeoutMs },
        ) as CallToolResult);
      },
      close() {
        return client.close();
      },
    };
    return session;
  };
}
