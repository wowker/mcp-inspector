import { Hono } from "hono";
import { ScriptExecutionError } from "./script-runner.js";
import { InvalidWorkflowDebugError, type WorkflowDebugService } from "./workflow-debug-service.js";

export function createWorkflowDebugRoutes(debug: WorkflowDebugService): Hono {
  const routes = new Hono();
  routes.post("/:projectId/connections/:connectionId/tools/:toolName/workflow/debug", async (context) => {
    let body: unknown;
    try { body = await context.req.json(); }
    catch { return context.json({ error: { code: "INVALID_WORKFLOW_DEBUG", message: "Workflow debug payload is invalid" } }, 400); }
    try {
      return context.json({ result: await debug.run(
        context.req.param("projectId"), context.req.param("connectionId"), context.req.param("toolName"), body,
        context.req.raw.signal,
      ) });
    } catch (error) {
      if (error instanceof InvalidWorkflowDebugError) return context.json({ error: { code: "INVALID_WORKFLOW_DEBUG", message: error.message } }, 400);
      if (error instanceof ScriptExecutionError) return context.json({ error: { code: error.code, message: error.message,
        phase: error.phase, line: error.line, column: error.column } }, 422);
      throw error;
    }
  });
  return routes;
}
