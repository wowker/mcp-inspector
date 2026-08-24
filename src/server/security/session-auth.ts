import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export const SESSION_HEADER = "X-DSers-Inspector-Session";

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

    const token = context.req.header(SESSION_HEADER);
    if (token === undefined || !tokensMatch(token, options.sessionToken)) {
      return context.json({ error: "Unauthorized" }, 401);
    }

    await next();
  };
}
