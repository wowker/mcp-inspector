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

const createConnectionBodySchema = z.object({
  name: z.string(),
  url: z.string(),
  transport: z.literal("streamable-http"),
  authMode: z.literal("none"),
  timeoutMs: z.number(),
}).strict();

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

  routes.delete("/:projectId/connections/:connectionId", (context) => {
    try {
      connections.delete(
        context.req.param("projectId"),
        context.req.param("connectionId"),
      );
      return context.body(null, 204);
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        return context.json(errors.connectionNotFound, 404);
      }
      return projectError(context, error);
    }
  });

  return routes;
}
