import { Hono, type Context } from "hono";
import { startTestSuiteExecutionRequestSchema } from "../../shared/testing/test-suite-execution.js";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import { DestructiveConfirmationRequiredError, TestExecutionTargetError } from "./test-execution-service.js";
import {
  InvalidTestSuiteExecutionError,
  TestSuiteExecutionConflictError,
  TestSuiteExecutionNotFoundError,
  type TestSuiteExecutionService,
} from "./test-suite-execution-service.js";
import { TestSuiteNotFoundError } from "./test-suite-service.js";

const errors = {
  invalid: { error: { code: "TEST_SUITE_EXECUTION_INVALID", message: "Test suite execution request is invalid" } },
  notFound: { error: { code: "TEST_SUITE_EXECUTION_NOT_FOUND", message: "Test suite execution not found" } },
  conflict: { error: { code: "TEST_SUITE_EXECUTION_CONFLICT", message: "Idempotency key was already used for a different suite revision" } },
  target: { error: { code: "TEST_TARGET_NOT_AVAILABLE", message: "Test execution target is not available" } },
  destructive: { error: { code: "DESTRUCTIVE_CONFIRMATION_REQUIRED", message: "Destructive Tool confirmation is required" } },
  projectNotFound: { error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } },
  invalidStorage: { error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } },
} as const;

function mapError(context: Context, error: unknown) {
  if (error instanceof InvalidTestSuiteExecutionError) return context.json(errors.invalid, 400);
  if (error instanceof TestSuiteExecutionNotFoundError || error instanceof TestSuiteNotFoundError) return context.json(errors.notFound, 404);
  if (error instanceof TestSuiteExecutionConflictError) return context.json(errors.conflict, 409);
  if (error instanceof TestExecutionTargetError) return context.json(errors.target, 404);
  if (error instanceof DestructiveConfirmationRequiredError) return context.json(errors.destructive, 409);
  if (error instanceof ProjectNotFoundError) return context.json(errors.projectNotFound, 404);
  if (error instanceof InvalidProjectStorageError) return context.json(errors.invalidStorage, 409);
  throw error;
}

export function createTestSuiteExecutionRoutes(executions: TestSuiteExecutionService): Hono {
  const routes = new Hono();
  routes.post("/:projectId/test-suites/:suiteId/executions", async (context) => {
    const idempotencyKey = context.req.header("Idempotency-Key") ?? "";
    if (idempotencyKey.length < 1 || idempotencyKey.length > 200) return context.json(errors.invalid, 400);
    let body: unknown;
    try { body = await context.req.json(); } catch { body = {}; }
    const parsed = startTestSuiteExecutionRequestSchema.safeParse(body);
    if (!parsed.success) return context.json(errors.invalid, 400);
    try {
      return context.json({ execution: executions.start({
        projectId: context.req.param("projectId"), suiteId: context.req.param("suiteId"),
        idempotencyKey, request: parsed.data,
      }) }, 202);
    } catch (error) { return mapError(context, error); }
  });
  routes.get("/:projectId/test-suite-executions/:executionId", (context) => {
    try { return context.json({ execution: executions.get(context.req.param("projectId"), context.req.param("executionId")) }); }
    catch (error) { return mapError(context, error); }
  });
  routes.post("/:projectId/test-suite-executions/:executionId/cancel", (context) => {
    try {
      return executions.cancel(context.req.param("projectId"), context.req.param("executionId"))
        ? context.json({ cancelled: true })
        : context.json({ error: { code: "TEST_SUITE_EXECUTION_NOT_ACTIVE", message: "Test suite execution is not active" } }, 409);
    } catch (error) { return mapError(context, error); }
  });
  return routes;
}
