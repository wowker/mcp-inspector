import { Hono } from "hono";
import {
  InvalidWorkflowExecutionError,
  WorkflowExecutionConflictError,
  WorkflowExecutionNotFoundError,
  type WorkflowExecutionService,
} from "./workflow-execution-service.js";

export function createWorkflowExecutionRoutes(executions: WorkflowExecutionService): Hono {
  const routes = new Hono();
  routes.post("/:projectId/workflow-executions", async (context) => {
    let body: unknown;
    try { body = await context.req.json(); } catch { return context.json({ error: { code: "INVALID_WORKFLOW_EXECUTION", message: "Workflow execution payload is invalid" } }, 400); }
    try {
      return context.json({ execution: executions.start({
        ...(typeof body === "object" && body !== null ? body : {}),
        projectId: context.req.param("projectId"),
      }) }, 202);
    } catch (error) {
      if (error instanceof InvalidWorkflowExecutionError) return context.json({ error: { code: "INVALID_WORKFLOW_EXECUTION", message: error.message } }, 400);
      if (error instanceof WorkflowExecutionConflictError) return context.json({ error: { code: "WORKFLOW_EXECUTION_CONFLICT", message: error.message } }, 409);
      throw error;
    }
  });
  routes.get("/:projectId/workflow-executions/active", (context) => {
    try {
      return context.json({ execution: executions.activeForTab(
        context.req.param("projectId"), context.req.query("tabId") ?? "",
      ) });
    } catch (error) {
      if (error instanceof WorkflowExecutionNotFoundError) return context.json({ error: { code: "WORKFLOW_EXECUTION_NOT_FOUND", message: error.message } }, 404);
      throw error;
    }
  });
  routes.get("/:projectId/workflow-executions/:executionId", (context) => {
    try { return context.json({ execution: executions.get(context.req.param("projectId"), context.req.param("executionId")) }); }
    catch (error) {
      if (error instanceof WorkflowExecutionNotFoundError) return context.json({ error: { code: "WORKFLOW_EXECUTION_NOT_FOUND", message: error.message } }, 404);
      throw error;
    }
  });
  routes.post("/:projectId/workflow-executions/:executionId/cancel", (context) => {
    try {
      return executions.cancel(context.req.param("projectId"), context.req.param("executionId"))
        ? context.json({ cancelled: true })
        : context.json({ error: { code: "WORKFLOW_NOT_ACTIVE", message: "Workflow execution is not active" } }, 409);
    } catch (error) {
      if (error instanceof WorkflowExecutionNotFoundError) return context.json({ error: { code: "WORKFLOW_EXECUTION_NOT_FOUND", message: error.message } }, 404);
      throw error;
    }
  });
  return routes;
}
