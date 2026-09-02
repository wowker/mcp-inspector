import { Hono, type Context } from "hono";
import { z } from "zod";
import { replayRequestSchema } from "../../shared/run-replay.js";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import { RunNotFoundError, RunValidationError } from "./run-service.js";
import {
  InvalidReplayError,
  ReplayConfirmationRequiredError,
  ReplayIdempotencyConflictError,
  ReplayStalePreflightError,
  type ReplayExecutionService,
} from "./replay-execution-service.js";
import {
  ReplayConnectionUnavailableError,
  ReplaySourceUnavailableError,
  ReplayToolUnavailableError,
} from "./replay-preflight-service.js";

async function jsonBody(context: Context): Promise<unknown> {
  try { return await context.req.json(); } catch { return undefined; }
}

function errorResponse(context: Context, error: unknown) {
  if (error instanceof ProjectNotFoundError) {
    return context.json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } }, 404);
  }
  if (error instanceof InvalidProjectStorageError) {
    return context.json({ error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } }, 409);
  }
  if (error instanceof ReplaySourceUnavailableError || error instanceof RunNotFoundError) {
    return context.json({ error: { code: "RUN_NOT_FOUND", message: "Source Run or Tool snapshot is unavailable" } }, 404);
  }
  if (error instanceof ReplayConnectionUnavailableError || error instanceof ReplayToolUnavailableError) {
    return context.json({ error: { code: "REPLAY_BLOCKED", message: error.message } }, 409);
  }
  if (error instanceof ReplayStalePreflightError) {
    return context.json({ error: { code: error.code, message: error.message } }, 409);
  }
  if (error instanceof ReplayConfirmationRequiredError) {
    return context.json({ error: { code: error.code, message: error.message } }, 422);
  }
  if (error instanceof ReplayIdempotencyConflictError) {
    return context.json({ error: { code: error.code, message: error.message } }, 409);
  }
  if (error instanceof RunValidationError) {
    return context.json({ error: { code: "REPLAY_BLOCKED", message: "Stored arguments are invalid for the current Tool" } }, 422);
  }
  if (error instanceof InvalidReplayError) {
    return context.json({ error: { code: error.code, message: error.message } }, 400);
  }
  throw error;
}

export function createReplayExecutionRoutes(service: ReplayExecutionService): Hono {
  const routes = new Hono();
  routes.post("/:projectId/runs/:runId/replay", async (context) => {
    const path = z.object({ projectId: z.string().uuid(), runId: z.string().uuid() }).safeParse({
      projectId: context.req.param("projectId"), runId: context.req.param("runId"),
    });
    if (!path.success) {
      return context.json({ error: { code: "INVALID_REPLAY", message: "Replay request is invalid" } }, 400);
    }
    const parsed = replayRequestSchema.safeParse(await jsonBody(context));
    if (!parsed.success) {
      return context.json({ error: { code: "INVALID_REPLAY", message: "Replay request is invalid" } }, 400);
    }
    try {
      const run = service.start(path.data.projectId, path.data.runId, parsed.data);
      return context.json({ run }, 202);
    } catch (error) {
      return errorResponse(context, error);
    }
  });
  return routes;
}
