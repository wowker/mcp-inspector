import { Hono, type Context } from "hono";
import { z } from "zod";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import {
  ReplayConnectionUnavailableError,
  ReplaySourceUnavailableError,
  ReplayToolUnavailableError,
  type ReplayPreflightService,
} from "./replay-preflight-service.js";

const uuid = z.string().uuid();

function errorResponse(context: Context, error: unknown) {
  if (error instanceof ProjectNotFoundError) {
    return context.json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } }, 404);
  }
  if (error instanceof InvalidProjectStorageError) {
    return context.json({ error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } }, 409);
  }
  if (error instanceof ReplaySourceUnavailableError) {
    return context.json({ error: { code: error.code, message: error.message } }, 404);
  }
  if (error instanceof ReplayConnectionUnavailableError || error instanceof ReplayToolUnavailableError) {
    return context.json({ error: { code: error.code, message: error.message } }, 409);
  }
  throw error;
}

export function createReplayPreflightRoutes(service: ReplayPreflightService): Hono {
  const routes = new Hono();
  routes.get("/:projectId/runs/:runId/replay-preflight", (context) => {
    const parsed = z.object({ projectId: uuid, runId: uuid }).safeParse({
      projectId: context.req.param("projectId"),
      runId: context.req.param("runId"),
    });
    if (!parsed.success) {
      return context.json({ error: { code: "INVALID_REPLAY", message: "Replay request is invalid" } }, 400);
    }
    try {
      return context.json({ preflight: service.inspect(parsed.data.projectId, parsed.data.runId) });
    } catch (error) {
      return errorResponse(context, error);
    }
  });
  return routes;
}
