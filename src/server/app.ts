import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { createConnectionService, type ConnectionService } from "./connections/connection-service.js";
import { createConnectionRoutes } from "./connections/routes.js";
import type { ProjectService } from "./projects/project-service.js";
import { createProjectRoutes } from "./projects/routes.js";
import { sessionAuth } from "./security/session-auth.js";
import { createToolRoutes } from "./tools/routes.js";
import { createToolService, type ToolService } from "./tools/tool-service.js";
import { createTabRoutes } from "./tabs/routes.js";
import { createTabService, type TabService } from "./tabs/tab-service.js";
import { createRunRoutes } from "./runs/routes.js";
import { createRunService, type RunServiceWithEvents } from "./runs/run-service.js";

export interface AppDependencies {
  sessionToken: string;
  allowedOrigin: string | (() => string);
  version: string;
  projects?: ProjectService;
  connections?: ConnectionService;
  tools?: ToolService;
  tabs?: TabService;
  runs?: RunServiceWithEvents;
  staticRoot?: string;
}

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function safeStaticPath(root: string, requestPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(requestPath); } catch { return null; }
  if (decoded.includes("\0")) return null;
  const candidate = resolve(root, `.${decoded}`);
  const child = relative(resolve(root), candidate);
  return child === "" || child.startsWith("..") || child.includes("/../") ? null : candidate;
}

function isApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
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
    const tools = deps.tools ?? createToolService(deps.projects, connections);
    app.route("/api/projects", createToolRoutes(tools));
    const tabs = deps.tabs ?? createTabService(deps.projects, connections, { tools });
    app.route("/api/projects", createTabRoutes(tabs));
    app.route("/api/projects", createRunRoutes(
      deps.runs ?? createRunService(deps.projects, connections, tabs),
    ));
  }

  if (deps.staticRoot !== undefined) {
    app.get("*", async (context) => {
      if (isApiPath(context.req.path)) return context.json({ error: "Not found" }, 404);
      const accept = context.req.header("Accept") ?? "";
      const navigation = accept.includes("text/html") && extname(context.req.path) === "";
      const requestedPath = navigation || context.req.path === "/" ? "/index.html" : context.req.path;
      const file = safeStaticPath(deps.staticRoot!, requestedPath);
      if (file === null) return context.text("Not found", 404);
      try {
        const body = await readFile(file);
        return context.body(body, 200, {
          "Content-Type": contentTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "EISDIR") {
          return context.text("Not found", 404);
        }
        throw error;
      }
    });
  }

  app.notFound((context) => isApiPath(context.req.path)
    ? context.json({ error: "Not found" }, 404)
    : context.text("Not found", 404));

  return app;
}
