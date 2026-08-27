import { Hono, type Context } from "hono";
import { ConnectionNotFoundError } from "../connections/connection-service.js";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import { ToolNotFoundError } from "../tools/tool-service.js";
import {
  InvalidWorkflowError,
  WorkflowRevisionConflictError,
  type WorkflowService,
} from "./workflow-service.js";

const errors = {
  invalid: { error: { code: "INVALID_WORKFLOW", message: "Tool workflow configuration is invalid" } },
  conflict: { error: { code: "WORKFLOW_REVISION_CONFLICT", message: "Tool workflow revision is stale" } },
  projectNotFound: { error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } },
  invalidProjectStorage: { error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } },
  connectionNotFound: { error: { code: "CONNECTION_NOT_FOUND", message: "Connection not found" } },
  toolNotFound: { error: { code: "TOOL_NOT_FOUND", message: "Tool not found" } },
} as const;

function resourceError(context: Context, error: unknown) {
  if (error instanceof ProjectNotFoundError) return context.json(errors.projectNotFound, 404);
  if (error instanceof InvalidProjectStorageError) return context.json(errors.invalidProjectStorage, 409);
  if (error instanceof ConnectionNotFoundError) return context.json(errors.connectionNotFound, 404);
  if (error instanceof ToolNotFoundError) return context.json(errors.toolNotFound, 404);
  throw error;
}

export function createWorkflowRoutes(workflows: WorkflowService): Hono {
  const routes = new Hono();
  const path = "/:projectId/connections/:connectionId/tools/:toolName/workflow";

  routes.get(path, (context) => {
    try {
      return context.json({ workflow: workflows.get(
        context.req.param("projectId"),
        context.req.param("connectionId"),
        context.req.param("toolName"),
      ) });
    } catch (error) {
      return resourceError(context, error);
    }
  });

  routes.put(path, async (context) => {
    let body: unknown;
    try { body = await context.req.json(); } catch { return context.json(errors.invalid, 400); }
    try {
      return context.json({ workflow: workflows.update(
        context.req.param("projectId"),
        context.req.param("connectionId"),
        context.req.param("toolName"),
        body,
      ) });
    } catch (error) {
      if (error instanceof InvalidWorkflowError) return context.json(errors.invalid, 400);
      if (error instanceof WorkflowRevisionConflictError) return context.json(errors.conflict, 409);
      return resourceError(context, error);
    }
  });

  routes.post(`${path}/validate`, async (context) => {
    let body: unknown;
    try { body = await context.req.json(); } catch { return context.json(errors.invalid, 400); }
    try {
      return context.json({ validation: await workflows.validate(
        context.req.param("projectId"),
        context.req.param("connectionId"),
        context.req.param("toolName"),
        body,
      ) });
    } catch (error) {
      if (error instanceof InvalidWorkflowError) return context.json(errors.invalid, 400);
      return resourceError(context, error);
    }
  });

  return routes;
}
