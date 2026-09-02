import { Hono, type Context } from "hono";
import { z } from "zod";
import { replaceComparisonRulesSchema } from "../../shared/run-comparison.js";
import { InvalidComparisonRulesError } from "./comparison-rule-service.js";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import { InvalidRunComparisonError, type RunComparisonService } from "./run-comparison-service.js";

const errors = {
  invalid: { error: { code: "RUN_COMPARISON_INVALID", message: "Run comparison request is invalid" } },
  projectNotFound: { error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } },
  invalidStorage: { error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } },
} as const;

function mapError(context: Context, error: unknown) {
  if (error instanceof InvalidRunComparisonError) return context.json(errors.invalid, 400);
  if (error instanceof InvalidComparisonRulesError) return context.json(errors.invalid, 400);
  if (error instanceof ProjectNotFoundError) return context.json(errors.projectNotFound, 404);
  if (error instanceof InvalidProjectStorageError) return context.json(errors.invalidStorage, 409);
  throw error;
}

export function createRunComparisonRoutes(service: RunComparisonService): Hono {
  const routes = new Hono();
  routes.get("/:projectId/runs/:runId/comparison", (context) => {
    const parsed = z.object({ projectId: z.string().uuid(), runId: z.string().uuid() }).safeParse({
      projectId: context.req.param("projectId"), runId: context.req.param("runId"),
    });
    if (!parsed.success) return context.json(errors.invalid, 400);
    try { return context.json({ comparison: service.compare(parsed.data.projectId, parsed.data.runId) }); }
    catch (error) { return mapError(context, error); }
  });
  routes.post("/:projectId/runs/:runId/comparison/preview", async (context) => {
    const parsedIdentity = z.object({ projectId: z.string().uuid(), runId: z.string().uuid() }).safeParse({
      projectId: context.req.param("projectId"), runId: context.req.param("runId"),
    });
    let body: unknown;
    try { body = await context.req.json(); } catch { return context.json(errors.invalid, 400); }
    const parsed = replaceComparisonRulesSchema.safeParse(body);
    if (!parsedIdentity.success || !parsed.success) return context.json(errors.invalid, 400);
    try { return context.json({ comparison: service.compare(
      parsedIdentity.data.projectId, parsedIdentity.data.runId, parsed.data,
    ) }); } catch (error) { return mapError(context, error); }
  });
  return routes;
}
