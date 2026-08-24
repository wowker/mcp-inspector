import { Hono } from "hono";
import { createConnectionService, type ConnectionService } from "./connections/connection-service.js";
import { createConnectionRoutes } from "./connections/routes.js";
import type { ProjectService } from "./projects/project-service.js";
import { createProjectRoutes } from "./projects/routes.js";
import { sessionAuth } from "./security/session-auth.js";
import { createToolRoutes } from "./tools/routes.js";
import { createToolService, type ToolService } from "./tools/tool-service.js";

export interface AppDependencies {
  sessionToken: string;
  allowedOrigin: string;
  version: string;
  projects?: ProjectService;
  connections?: ConnectionService;
  tools?: ToolService;
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
    const connections = deps.connections ?? createConnectionService(deps.projects);
    app.route("/api/projects", createProjectRoutes(deps.projects));
    app.route("/api/projects", createConnectionRoutes(connections));
    app.route("/api/projects", createToolRoutes(
      deps.tools ?? createToolService(deps.projects, connections),
    ));
  }

  return app;
}
