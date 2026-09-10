import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { authoringListInputSchema } from "../../shared/authoring/catalog.js";
import {
  authoringCallToolInputSchema,
  authoringGetToolCallInputSchema,
  authoringListToolCallsInputSchema,
} from "../../shared/authoring/calls.js";
import {
  AUTHORING_ASSET_TYPES,
  AUTHORING_LIMITS,
  AUTHORING_PROTOCOL_VERSION,
  type AuthoringCapabilities,
  type AuthoringErrorCategory,
  type AuthoringFailure,
  type AuthoringSuccess,
} from "../../shared/authoring/protocol.js";
import { ConnectionNotFoundError } from "../connections/connection-service.js";
import { ProjectNotFoundError } from "../projects/project-service.js";
import { ToolNotFoundError } from "../tools/tool-service.js";
import {
  AuthoringCatalogAccessDeniedError,
  InvalidAuthoringCursorError,
  type AuthoringCatalogService,
} from "./authoring-catalog-service.js";
import { AuthoringConnectionNotFoundError } from "./authoring-policy-service.js";
import {
  AuthoringCallConcurrencyError,
  AuthoringCallGlobalLimitError,
  AuthoringCallIdempotencyConflictError,
  AuthoringCallNotFoundError,
  AuthoringCallOutcomeUnknownError,
  AuthoringCallRateLimitError,
  AuthoringCleanupContextError,
  AuthoringDraftContextError,
  AuthoringPolicyDeniedError,
  AuthoringToolArgumentsError,
  AuthoringToolSchemaChangedError,
  type AuthoringCallService,
} from "./authoring-call-service.js";
import { InvalidAuthoringCallCursorError } from "./authoring-call-repository.js";

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
  catalog?: AuthoringCatalogService;
  calls?: AuthoringCallService;
}): McpServer {
  const server = new McpServer({ name: "mcp-inspector-authoring", version: options.appVersion });
  const meta = () => ({ requestId: randomUUID(), protocolVersion: AUTHORING_PROTOCOL_VERSION });
  const success = <T>(data: T) => {
    const envelope: AuthoringSuccess<T> = { ok: true, data, meta: { ...meta(), warnings: [] } };
    if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > AUTHORING_LIMITS.maxStructuredResponseBytes) {
      return failure("REQUEST_LIMIT_EXCEEDED", "VALIDATION", "Authoring response exceeds the size limit", false);
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(envelope) }], structuredContent: envelope };
  };
  const failure = (code: string, category: AuthoringErrorCategory, message: string, retryable: boolean) => {
    const envelope: AuthoringFailure = { ok: false, error: { code, category, message, retryable }, meta: meta() };
    return {
      content: [{ type: "text" as const, text: `${code}: ${message}` }],
      structuredContent: envelope,
      isError: true,
    };
  };
  const catalogCall = async <T>(action: () => T) => {
    try {
      return success(action());
    } catch (error) {
      if (error instanceof InvalidAuthoringCursorError) {
        return failure("INVALID_INPUT", "VALIDATION", "Cursor is invalid for this request", false);
      }
      if (error instanceof AuthoringCatalogAccessDeniedError) {
        return failure("AUTHORING_POLICY_DENIED", "AUTHORIZATION", "Connection policy does not allow this catalog request", false);
      }
      if (error instanceof ProjectNotFoundError) {
        return failure("PROJECT_NOT_FOUND", "NOT_FOUND", "Project not found", false);
      }
      if (error instanceof ConnectionNotFoundError || error instanceof AuthoringConnectionNotFoundError) {
        return failure("CONNECTION_NOT_FOUND", "NOT_FOUND", "Connection not found", false);
      }
      if (error instanceof ToolNotFoundError) {
        return failure("TOOL_NOT_FOUND", "NOT_FOUND", "Tool not found", false);
      }
      return failure("INTERNAL_ERROR", "INTERNAL", "Authoring catalog request failed", false);
    }
  };
  const callAction = async <T>(action: () => T | Promise<T>) => {
    try {
      return success(await action());
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof InvalidAuthoringCallCursorError) {
        return failure("INVALID_INPUT", "VALIDATION", "Authoring call request is invalid", false);
      }
      if (error instanceof AuthoringPolicyDeniedError) {
        return failure("AUTHORING_POLICY_DENIED", "AUTHORIZATION", error.message, false);
      }
      if (error instanceof AuthoringToolSchemaChangedError) {
        return failure("TOOL_SCHEMA_CHANGED", "CONFLICT", error.message, false);
      }
      if (error instanceof AuthoringToolArgumentsError) {
        return failure("INVALID_ARGUMENTS", "VALIDATION", error.message, false);
      }
      if (error instanceof AuthoringCallIdempotencyConflictError) {
        return failure("IDEMPOTENCY_CONFLICT", "CONFLICT", error.message, false);
      }
      if (error instanceof AuthoringCallRateLimitError || error instanceof AuthoringCallConcurrencyError ||
          error instanceof AuthoringCallGlobalLimitError) {
        return failure("CALL_LIMIT_REACHED", "RATE_LIMIT", error.message, true);
      }
      if (error instanceof AuthoringCallOutcomeUnknownError) {
        return failure("CALL_OUTCOME_UNKNOWN", "CONFLICT", error.message, false);
      }
      if (error instanceof AuthoringDraftContextError || error instanceof AuthoringCleanupContextError) {
        return failure("INVALID_CONTEXT", "VALIDATION", error.message, false);
      }
      if (error instanceof AuthoringCallNotFoundError) {
        return failure("CALL_NOT_FOUND", "NOT_FOUND", error.message, false);
      }
      if (error instanceof ProjectNotFoundError) {
        return failure("PROJECT_NOT_FOUND", "NOT_FOUND", "Project not found", false);
      }
      if (error instanceof ConnectionNotFoundError || error instanceof AuthoringConnectionNotFoundError) {
        return failure("CONNECTION_NOT_FOUND", "NOT_FOUND", "Connection not found", false);
      }
      if (error instanceof ToolNotFoundError) {
        return failure("TOOL_NOT_FOUND", "NOT_FOUND", "Tool not found", false);
      }
      return failure("INTERNAL_ERROR", "INTERNAL", "Authoring call request failed", false);
    }
  };
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
    return success(data);
  });

  if (options.catalog !== undefined) {
    const projectIdSchema = z.string().uuid();
    const connectionIdSchema = z.string().uuid();
    server.registerTool("inspector_list_projects", {
      description: "Lists Inspector projects with stable IDs and bounded pagination.",
      inputSchema: authoringListInputSchema,
    }, async (input) => catalogCall(() => options.catalog!.listProjects(input)));
    server.registerTool("inspector_list_connections", {
      description: "Lists policy-visible MCP Server connections in one exact project.",
      inputSchema: authoringListInputSchema.extend({ projectId: projectIdSchema }),
    }, async ({ projectId, ...input }) => catalogCall(() => options.catalog!.listConnections(projectId, input)));
    server.registerTool("inspector_list_tools", {
      description: "Lists policy-authorized downstream Tools and their current Schema hashes.",
      inputSchema: authoringListInputSchema.extend({ projectId: projectIdSchema, connectionId: connectionIdSchema }),
    }, async ({ projectId, connectionId, ...input }) =>
      catalogCall(() => options.catalog!.listTools(projectId, connectionId, input)));
    server.registerTool("inspector_describe_tool", {
      description: "Returns a bounded, untrusted snapshot of one authorized downstream Tool definition.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        connectionId: connectionIdSchema,
        toolName: z.string().trim().min(1).max(256),
      }).strict(),
    }, async ({ projectId, connectionId, toolName }) =>
      catalogCall(() => options.catalog!.describeTool(projectId, connectionId, toolName)));
  }
  if (options.calls !== undefined) {
    server.registerTool("inspector_call_tool", {
      description: "Calls one authorized downstream Tool and records both Authoring call and Run identities.",
      inputSchema: authoringCallToolInputSchema,
    }, async (input, context) => callAction(async () => {
      const { id, ...detail } = await options.calls!.call(input, context.signal);
      return { callId: id, ...detail };
    }));
    server.registerTool("inspector_list_tool_calls", {
      description: "Lists sanitized Authoring call summaries in one exact project.",
      inputSchema: authoringListToolCallsInputSchema,
    }, async ({ projectId, ...input }) => callAction(() => options.calls!.list(projectId, input)));
    server.registerTool("inspector_get_tool_call", {
      description: "Returns sanitized detail for one traceable Authoring call.",
      inputSchema: authoringGetToolCallInputSchema,
    }, async ({ projectId, callId }) => callAction(() => {
      const { id, ...detail } = options.calls!.get(projectId, callId);
      return { callId: id, ...detail };
    }));
  }
  return server;
}

export function createAuthoringMcpServer(options: {
  appVersion: string;
  endpoint: string | (() => string);
  maxSessions?: number;
  maxRequestBytes?: number;
  catalog?: AuthoringCatalogService;
  calls?: AuthoringCallService;
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
        catalog: options.catalog,
        calls: options.calls,
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
