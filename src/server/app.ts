import { Hono } from "hono";
import { createConnectionService, type ConnectionService } from "./connections/connection-service.js";
import { createConnectionRoutes } from "./connections/routes.js";
import type { ProjectService } from "./projects/project-service.js";
import { createProjectRoutes } from "./projects/routes.js";
import { sessionAuth } from "./security/session-auth.js";

export interface AppDependencies {
  sessionToken: string;
  allowedOrigin: string;
  version: string;
  projects?: ProjectService;
  connections?: ConnectionService;
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

  if (deps.projects !== undefined) {
    app.route("/api/projects", createProjectRoutes(deps.projects));
    app.route(
      "/api/projects",
      createConnectionRoutes(deps.connections ?? createConnectionService(deps.projects)),
    );
  }

  return app;
}
