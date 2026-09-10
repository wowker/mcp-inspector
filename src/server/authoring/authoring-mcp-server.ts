import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  AUTHORING_ASSET_TYPES,
  AUTHORING_LIMITS,
  AUTHORING_PROTOCOL_VERSION,
  type AuthoringCapabilities,
  type AuthoringSuccess,
} from "../../shared/authoring/protocol.js";

interface Session {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}

export interface AuthoringMcpServer {
  readonly maxRequestBytes: number;
  isClosed(): boolean;
  handleRequest(request: Request, parsedBody?: unknown): Promise<Response>;
  close(): Promise<void>;
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function createProtocolServer(options: {
  appVersion: string;
  endpoint: string | (() => string);
  maxSessions: number;
}): McpServer {
  const server = new McpServer({ name: "mcp-inspector-authoring", version: options.appVersion });
  server.registerTool("inspector_get_capabilities", {
    title: "Get Inspector authoring capabilities",
    description: "Returns the stable Authoring MCP protocol version, feature flags, and resource limits.",
    inputSchema: z.object({}).strict(),
  }, async () => {
    const data: AuthoringCapabilities = {
      appVersion: options.appVersion,
      endpoint: typeof options.endpoint === "function" ? options.endpoint() : options.endpoint,
      assetTypes: AUTHORING_ASSET_TYPES,
      permissionModes: ["DISABLED", "READ_ONLY", "CUSTOM", "FULL_ACCESS"],
      features: {
        standaloneToolCalls: true,
        draftToolCalls: true,
        atomicApply: true,
        mandatoryRedaction: true,
      },
      limits: { ...AUTHORING_LIMITS, maxSessions: options.maxSessions },
    };
    const envelope: AuthoringSuccess<AuthoringCapabilities> = {
      ok: true,
      data,
      meta: {
        requestId: randomUUID(),
        protocolVersion: AUTHORING_PROTOCOL_VERSION,
        warnings: [],
      },
    };
    return {
      content: [{ type: "text", text: JSON.stringify(envelope) }],
      structuredContent: envelope,
    };
  });
  return server;
}

export function createAuthoringMcpServer(options: {
  appVersion: string;
  endpoint: string | (() => string);
  maxSessions?: number;
  maxRequestBytes?: number;
}): AuthoringMcpServer {
  const maxSessions = options.maxSessions ?? AUTHORING_LIMITS.maxSessions;
  const maxRequestBytes = options.maxRequestBytes ?? AUTHORING_LIMITS.maxRequestBytes;
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1) throw new Error("maxSessions must be a positive integer");
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1) {
    throw new Error("maxRequestBytes must be a positive integer");
  }

  const sessions = new Map<string, Session>();
  let pendingInitializations = 0;
  let closed = false;

  return {
    maxRequestBytes,
    isClosed: () => closed,
    async handleRequest(request, parsedBody) {
      if (closed) return jsonError(503, "AUTHORING_SHUTTING_DOWN", "Authoring MCP is shutting down");

      const sessionId = request.headers.get("mcp-session-id");
      if (sessionId !== null) {
        const session = sessions.get(sessionId);
        if (session === undefined) {
          return jsonError(404, "AUTHORING_SESSION_NOT_FOUND", "Authoring MCP session was not found");
        }
        return session.transport.handleRequest(request, { parsedBody });
      }

      if (request.method !== "POST" || !isInitializeRequest(parsedBody)) {
        return jsonError(400, "AUTHORING_SESSION_REQUIRED", "A valid Authoring MCP session is required");
      }
      if (sessions.size + pendingInitializations >= maxSessions) {
        return jsonError(429, "AUTHORING_SESSION_LIMIT", "Authoring MCP session limit reached");
      }

      pendingInitializations += 1;
      let initializedSessionId: string | undefined;
      const server = createProtocolServer({
        appVersion: options.appVersion,
        endpoint: options.endpoint,
        maxSessions,
      });
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        enableJsonResponse: true,
        onsessioninitialized(sessionId) {
          initializedSessionId = sessionId;
          sessions.set(sessionId, { server, transport });
        },
        onsessionclosed(sessionId) {
          sessions.delete(sessionId);
        },
      });
      try {
        await server.connect(transport);
        const response = await transport.handleRequest(request, { parsedBody });
        if (initializedSessionId === undefined && !response.ok) await server.close();
        return response;
      } catch {
        if (initializedSessionId !== undefined) sessions.delete(initializedSessionId);
        await server.close().catch(() => undefined);
        return jsonError(500, "AUTHORING_INTERNAL_ERROR", "Authoring MCP request failed");
      } finally {
        pendingInitializations -= 1;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      const active = [...sessions.values()];
      sessions.clear();
      await Promise.allSettled(active.map(({ server }) => server.close()));
    },
  };
}
