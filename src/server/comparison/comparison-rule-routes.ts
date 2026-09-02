import { Hono, type Context } from "hono";
import { replaceComparisonRulesSchema } from "../../shared/run-comparison.js";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import { InvalidComparisonRulesError, type ComparisonRuleService } from "./comparison-rule-service.js";

const errors = {
  invalid: { error: { code: "COMPARISON_RULES_INVALID", message: "Comparison ignore rules are invalid" } },
  projectNotFound: { error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } },
  invalidStorage: { error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } },
} as const;

function mapError(context: Context, error: unknown) {
  if (error instanceof InvalidComparisonRulesError) return context.json(errors.invalid, 400);
  if (error instanceof ProjectNotFoundError) return context.json(errors.projectNotFound, 404);
  if (error instanceof InvalidProjectStorageError) return context.json(errors.invalidStorage, 409);
  throw error;
}

export function createComparisonRuleRoutes(service: ComparisonRuleService): Hono {
  const routes = new Hono();
  const path = "/:projectId/comparison-rules";
  routes.get(path, (context) => {
    try { return context.json(service.list(context.req.param("projectId"))); }
    catch (error) { return mapError(context, error); }
  });
  routes.put(path, async (context) => {
    let body: unknown;
    try { body = await context.req.json(); } catch { return context.json(errors.invalid, 400); }
    const parsed = replaceComparisonRulesSchema.safeParse(body);
    if (!parsed.success) return context.json(errors.invalid, 400);
    try { return context.json(service.replace(context.req.param("projectId"), parsed.data)); }
    catch (error) { return mapError(context, error); }
  });
  return routes;
}
