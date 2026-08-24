import { Hono } from "hono";
import { sessionAuth } from "./security/session-auth.js";

export interface AppDependencies {
  sessionToken: string;
  allowedOrigin: string;
  version: string;
}

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.use(
    "/api/*",
    sessionAuth({
      allowedOrigin: deps.allowedOrigin,
      sessionToken: deps.sessionToken,
    }),
  );

  app.get("/api/health", (context) =>
    context.json({ ok: true, version: deps.version }),
  );

  return app;
}
