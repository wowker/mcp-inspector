import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  ConnectionNotFoundError,
  InvalidConnectionError,
  type ConnectionService,
} from "./connection-service.js";
import {
  InvalidProjectStorageError,
  ProjectNotFoundError,
} from "../projects/project-service.js";
import { McpConnectError, McpDisconnectError } from "./connection-runtime.js";

const createConnectionBodySchema = z.object({
  name: z.string(),
  url: z.string(),
  transport: z.literal("streamable-http"),
  authMode: z.enum(["none", "oauth"]),
  timeoutMs: z.number(),
}).strict();
const updateConnectionBodySchema = z.object({
  name: z.string().optional(),
  url: z.string().optional(),
  authMode: z.enum(["none", "oauth"]).optional(),
  timeoutMs: z.number().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

const errors = {
  invalidConnection: {
    error: { code: "INVALID_CONNECTION", message: "Connection configuration is invalid" },
  },
  connectionNotFound: {
    error: { code: "CONNECTION_NOT_FOUND", message: "Connection not found" },
  },
  projectNotFound: {
    error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
  },
  invalidProjectStorage: {
    error: {
      code: "INVALID_PROJECT_STORAGE",
      message: "Project storage metadata is invalid",
    },
  },
  connectFailed: {
    error: { code: "MCP_CONNECT_FAILED", message: "Unable to connect to MCP server" },
  },
  disconnectFailed: {
    error: { code: "MCP_DISCONNECT_FAILED", message: "Unable to disconnect MCP server" },
  },
} as const;

function projectError(context: Context, error: unknown) {
  if (error instanceof ProjectNotFoundError) {
    return context.json(errors.projectNotFound, 404);
  }
  if (error instanceof InvalidProjectStorageError) {
    return context.json(errors.invalidProjectStorage, 409);
  }
  throw error;
}

export function createConnectionRoutes(connections: ConnectionService): Hono {
  const routes = new Hono();

  routes.get("/:projectId/connections", (context) => {
    try {
      return context.json({ connections: connections.list(context.req.param("projectId")) });
    } catch (error) {
      return projectError(context, error);
    }
  });

  routes.post("/:projectId/connections", async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json(errors.invalidConnection, 400);
    }
    const parsed = createConnectionBodySchema.safeParse(body);
    if (!parsed.success) return context.json(errors.invalidConnection, 400);
    try {
      return context.json({
        connection: connections.create(context.req.param("projectId"), parsed.data),
      }, 201);
    } catch (error) {
      if (error instanceof InvalidConnectionError) {
        return context.json(errors.invalidConnection, 400);
      }
      return projectError(context, error);
    }
  });

  routes.patch("/:projectId/connections/:connectionId", async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json(errors.invalidConnection, 400);
    }
    const parsed = updateConnectionBodySchema.safeParse(body);
    if (!parsed.success) return context.json(errors.invalidConnection, 400);
    try {
      return context.json({ connection: await connections.update(
        context.req.param("projectId"),
        context.req.param("connectionId"),
        parsed.data,
      ) });
    } catch (error) {
      if (error instanceof InvalidConnectionError) {
        return context.json(errors.invalidConnection, 400);
      }
      if (error instanceof ConnectionNotFoundError) {
        return context.json(errors.connectionNotFound, 404);
      }
      if (error instanceof McpDisconnectError) {
        return context.json(errors.disconnectFailed, 502);
      }
      return projectError(context, error);
    }
  });

  routes.delete("/:projectId/connections/:connectionId", async (context) => {
    try {
      await connections.delete(
        context.req.param("projectId"),
        context.req.param("connectionId"),
      );
      return context.body(null, 204);
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        return context.json(errors.connectionNotFound, 404);
      }
      if (error instanceof McpDisconnectError) {
        return context.json(errors.disconnectFailed, 502);
      }
      return projectError(context, error);
    }
  });

  routes.post("/:projectId/connections/:connectionId/connect", async (context) => {
    try {
      return context.json({ connection: await connections.connect(
        context.req.param("projectId"),
        context.req.param("connectionId"),
      ) });
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        return context.json(errors.connectionNotFound, 404);
      }
      if (error instanceof McpConnectError) {
        return context.json(errors.connectFailed, 502);
      }
      return projectError(context, error);
    }
  });

  routes.post("/:projectId/connections/:connectionId/disconnect", async (context) => {
    try {
      return context.json({ connection: await connections.disconnect(
        context.req.param("projectId"),
        context.req.param("connectionId"),
      ) });
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        return context.json(errors.connectionNotFound, 404);
      }
      if (error instanceof InvalidProjectStorageError || error instanceof ProjectNotFoundError) {
        return projectError(context, error);
      }
      if (error instanceof McpDisconnectError) {
        return context.json(errors.disconnectFailed, 502);
      }
      throw error;
    }
  });

  return routes;
}
