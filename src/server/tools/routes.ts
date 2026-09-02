import { Hono, type Context } from "hono";
import { ConnectionNotFoundError } from "../connections/connection-service.js";
import { McpNotConnectedError } from "../connections/connection-runtime.js";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import {
  InvalidToolCatalogError,
  ToolNotFoundError,
  ToolNotRemovedError,
  InvalidToolFolderError,
  ToolFolderConflictError,
  ToolFolderNotFoundError,
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
  toolNotRemoved: { error: { code: "TOOL_NOT_REMOVED", message: "Only removed Tools can be deleted" } },
  notConnected: { error: { code: "MCP_NOT_CONNECTED", message: "MCP connection is not active" } },
  invalidCatalog: { error: { code: "MCP_TOOL_CATALOG_INVALID", message: "MCP Tool catalog is invalid" } },
  refreshFailed: { error: { code: "MCP_TOOL_REFRESH_FAILED", message: "Unable to refresh MCP Tool catalog" } },
  invalidFolder: { error: { code: "TOOL_FOLDER_INVALID", message: "Tool folder name is invalid" } },
  folderConflict: { error: { code: "TOOL_FOLDER_CONFLICT", message: "Tool folder already exists" } },
  folderNotFound: { error: { code: "TOOL_FOLDER_NOT_FOUND", message: "Tool folder not found" } },
  invalidFavorite: { error: { code: "TOOL_FAVORITE_INVALID", message: "Favorite must be a boolean" } },
} as const;

function resourceError(context: Context, error: unknown) {
  if (error instanceof ProjectNotFoundError) return context.json(errors.projectNotFound, 404);
  if (error instanceof InvalidProjectStorageError) return context.json(errors.invalidProjectStorage, 409);
  if (error instanceof ConnectionNotFoundError) return context.json(errors.connectionNotFound, 404);
  if (error instanceof ToolNotFoundError) return context.json(errors.toolNotFound, 404);
  if (error instanceof ToolFolderNotFoundError) return context.json(errors.folderNotFound, 404);
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

  routes.get("/:projectId/connections/:connectionId/tool-folders", (context) => {
    try {
      return context.json({ folders: tools.listFolders(
        context.req.param("projectId"), context.req.param("connectionId"),
      ) });
    } catch (error) {
      return resourceError(context, error);
    }
  });

  routes.post("/:projectId/connections/:connectionId/tool-folders", async (context) => {
    let body: unknown;
    try { body = await context.req.json(); } catch { return context.json(errors.invalidFolder, 400); }
    const name = typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as { name?: unknown }).name : undefined;
    try {
      return context.json({ folder: tools.createFolder(
        context.req.param("projectId"), context.req.param("connectionId"), name,
      ) }, 201);
    } catch (error) {
      if (error instanceof InvalidToolFolderError) return context.json(errors.invalidFolder, 400);
      if (error instanceof ToolFolderConflictError) return context.json(errors.folderConflict, 409);
      return resourceError(context, error);
    }
  });

  routes.patch("/:projectId/connections/:connectionId/tool-folders/:folderId", async (context) => {
    let body: unknown;
    try { body = await context.req.json(); } catch { return context.json(errors.invalidFolder, 400); }
    const name = typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as { name?: unknown }).name : undefined;
    try {
      return context.json({ folder: tools.renameFolder(
        context.req.param("projectId"), context.req.param("connectionId"),
        context.req.param("folderId"), name,
      ) });
    } catch (error) {
      if (error instanceof InvalidToolFolderError) return context.json(errors.invalidFolder, 400);
      if (error instanceof ToolFolderConflictError) return context.json(errors.folderConflict, 409);
      return resourceError(context, error);
    }
  });

  routes.delete("/:projectId/connections/:connectionId/tool-folders/:folderId", (context) => {
    try {
      tools.deleteFolder(
        context.req.param("projectId"), context.req.param("connectionId"), context.req.param("folderId"),
      );
      return context.body(null, 204);
    } catch (error) {
      return resourceError(context, error);
    }
  });

  routes.put("/:projectId/connections/:connectionId/tools/:toolName/folder", async (context) => {
    let body: unknown;
    try { body = await context.req.json(); } catch { return context.json(errors.folderNotFound, 400); }
    const folderId = typeof body === "object" && body !== null && !Array.isArray(body) && "folderId" in body
      ? (body as { folderId: unknown }).folderId : undefined;
    try {
      return context.json({ tool: tools.moveToFolder(
        context.req.param("projectId"), context.req.param("connectionId"),
        context.req.param("toolName"), folderId,
      ) });
    } catch (error) {
      if (error instanceof ToolFolderNotFoundError) return context.json(errors.folderNotFound, 404);
      return resourceError(context, error);
    }
  });

  routes.put("/:projectId/connections/:connectionId/tools/:toolName/favorite", async (context) => {
    let body: unknown;
    try { body = await context.req.json(); } catch { return context.json(errors.invalidFavorite, 400); }
    const favorite = typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as { favorite?: unknown }).favorite : undefined;
    if (typeof favorite !== "boolean") return context.json(errors.invalidFavorite, 400);
    try {
      return context.json({ tool: tools.setFavorite(
        context.req.param("projectId"), context.req.param("connectionId"),
        context.req.param("toolName"), favorite,
      ) });
    } catch (error) { return resourceError(context, error); }
  });

  routes.post("/:projectId/connections/:connectionId/tools/:toolName/recent-use", (context) => {
    try {
      return context.json({ tool: tools.markUsed(
        context.req.param("projectId"), context.req.param("connectionId"), context.req.param("toolName"),
      ) });
    } catch (error) { return resourceError(context, error); }
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

  routes.delete("/:projectId/connections/:connectionId/tools/:toolName", (context) => {
    try {
      tools.deleteRemoved(
        context.req.param("projectId"),
        context.req.param("connectionId"),
        context.req.param("toolName"),
      );
      return context.body(null, 204);
    } catch (error) {
      if (error instanceof ToolNotRemovedError) return context.json(errors.toolNotRemoved, 409);
      return resourceError(context, error);
    }
  });

  return routes;
}
