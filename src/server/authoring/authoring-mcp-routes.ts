import { Hono } from "hono";
import type { AuthoringAuthService } from "./authoring-auth-service.js";
import type { AuthoringMcpServer } from "./authoring-mcp-server.js";
import { authoringControlAudit, type AuthoringAuditWriter } from "./authoring-audit.js";

function jsonError(status: 400 | 401 | 403 | 413 | 415 | 503, code: string, message: string): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=UTF-8",
    "X-Content-Type-Options": "nosniff",
  });
  if (status === 401) headers.set("WWW-Authenticate", "Bearer");
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers });
}

function configuredOrigin(value: string | (() => string)): string {
  return typeof value === "function" ? value() : value;
}

function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
  return match?.[1] ?? null;
}

export function createAuthoringMcpRoutes(options: {
  auth: AuthoringAuthService;
  server: AuthoringMcpServer;
  allowedOrigins: ReadonlyArray<string | (() => string)>;
  audit?: AuthoringAuditWriter;
}): Hono {
  const routes = new Hono();

  routes.all("/", async (context) => {
    const status = options.auth.getStatus();
    if (!status.enabled) {
      return jsonError(403, "AUTHORING_DISABLED", "Authoring MCP is disabled");
    }
    const token = bearerToken(context.req.header("Authorization"));
    if (token === null || !await options.auth.verify(token)) {
      options.audit?.(authoringControlAudit("AUTHENTICATION_REJECTED", "REJECTED",
        { errorCode: "AUTHORING_UNAUTHORIZED" }));
      return jsonError(401, "AUTHORING_UNAUTHORIZED", "Authoring Token is invalid");
    }
    const origin = context.req.header("Origin");
    if (origin !== undefined && !options.allowedOrigins.some((allowed) => origin === configuredOrigin(allowed))) {
      options.audit?.(authoringControlAudit("ORIGIN_REJECTED", "REJECTED",
        { errorCode: "AUTHORING_ORIGIN_REJECTED" }));
      return jsonError(403, "AUTHORING_ORIGIN_REJECTED", "Request origin is not allowed");
    }
    if (options.server.isClosed()) {
      return jsonError(503, "AUTHORING_SHUTTING_DOWN", "Authoring MCP is shutting down");
    }

    let parsedBody: unknown;
    let request = context.req.raw;
    if (request.method === "POST") {
      const mediaType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (mediaType !== "application/json") {
        return jsonError(415, "AUTHORING_UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
      }
      const declaredLength = Number(request.headers.get("Content-Length"));
      if (Number.isFinite(declaredLength) && declaredLength > options.server.maxRequestBytes) {
        return jsonError(413, "AUTHORING_REQUEST_TOO_LARGE", "Authoring MCP request exceeds the size limit");
      }
      const body = await request.arrayBuffer();
      if (body.byteLength > options.server.maxRequestBytes) {
        return jsonError(413, "AUTHORING_REQUEST_TOO_LARGE", "Authoring MCP request exceeds the size limit");
      }
      try {
        parsedBody = JSON.parse(new TextDecoder().decode(body));
      } catch {
        return jsonError(400, "AUTHORING_INVALID_JSON", "Request body must contain valid JSON");
      }
      request = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
      });
    }

    const response = await options.server.handleRequest(request, parsedBody);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.delete("Access-Control-Allow-Origin");
    return response;
  });

  return routes;
}
