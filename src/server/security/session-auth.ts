import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export const SESSION_HEADER = "X-MCP-Inspector-Session";
export const SESSION_COOKIE = "mcp_inspector_session";

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  const encoded = cookieHeader?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  if (encoded === undefined) return undefined;
  try { return decodeURIComponent(encoded); } catch { return undefined; }
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api`;
}

function tokensMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);

  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function sessionAuth(options: {
  allowedOrigin: string | (() => string);
  sessionToken: string;
}): MiddlewareHandler {
  return async (context, next) => {
    const origin = context.req.header("Origin");
    const allowedOrigin = typeof options.allowedOrigin === "function"
      ? options.allowedOrigin()
      : options.allowedOrigin;
    if (origin !== undefined && origin !== allowedOrigin) {
      return context.json({ error: "Forbidden origin" }, 403);
    }

    const token = readCookie(context.req.header("Cookie"), SESSION_COOKIE)
      ?? context.req.header(SESSION_HEADER);
    if (token === undefined || !tokensMatch(token, options.sessionToken)) {
      return context.json({ error: "Unauthorized" }, 401);
    }

    await next();
  };
}
