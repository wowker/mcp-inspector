import { Hono, type Context } from "hono";
import { ConnectionNotFoundError } from "../connections/connection-service.js";
import { McpNotConnectedError } from "../connections/connection-runtime.js";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import {
  InvalidToolCatalogError,
  ToolNotFoundError,
  ToolRefreshError,
  type ToolService,
} from "./tool-service.js";

const errors = {
  projectNotFound: { error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } },
  invalidProjectStorage: {
    error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" },
  },
  connectionNotFound: { error: { code: "CONNECTION_NOT_FOUND", message: "Connection not found" } },
  toolNotFound: { error: { code: "TOOL_NOT_FOUND", message: "Tool not found" } },
  notConnected: { error: { code: "MCP_NOT_CONNECTED", message: "MCP connection is not active" } },
  invalidCatalog: { error: { code: "MCP_TOOL_CATALOG_INVALID", message: "MCP Tool catalog is invalid" } },
  refreshFailed: { error: { code: "MCP_TOOL_REFRESH_FAILED", message: "Unable to refresh MCP Tool catalog" } },
} as const;

function resourceError(context: Context, error: unknown) {
  if (error instanceof ProjectNotFoundError) return context.json(errors.projectNotFound, 404);
  if (error instanceof InvalidProjectStorageError) return context.json(errors.invalidProjectStorage, 409);
  if (error instanceof ConnectionNotFoundError) return context.json(errors.connectionNotFound, 404);
  if (error instanceof ToolNotFoundError) return context.json(errors.toolNotFound, 404);
  throw error;
}

export function createToolRoutes(tools: ToolService): Hono {
  const routes = new Hono();

  routes.post("/:projectId/connections/:connectionId/tools/refresh", async (context) => {
    try {
      return context.json({ tools: await tools.refresh(
        context.req.param("projectId"), context.req.param("connectionId"),
      ) });
    } catch (error) {
      if (error instanceof McpNotConnectedError) return context.json(errors.notConnected, 409);
      if (error instanceof InvalidToolCatalogError) return context.json(errors.invalidCatalog, 502);
      if (error instanceof ToolRefreshError) return context.json(errors.refreshFailed, 502);
      return resourceError(context, error);
    }
  });

  routes.get("/:projectId/connections/:connectionId/tools", (context) => {
    try {
      return context.json({ tools: tools.list(
        context.req.param("projectId"), context.req.param("connectionId"),
      ) });
    } catch (error) {
      return resourceError(context, error);
    }
  });

  routes.get("/:projectId/connections/:connectionId/tools/:toolName", (context) => {
    try {
      return context.json({ detail: tools.get(
        context.req.param("projectId"),
        context.req.param("connectionId"),
        context.req.param("toolName"),
      ) });
    } catch (error) {
      return resourceError(context, error);
    }
  });

  return routes;
}
