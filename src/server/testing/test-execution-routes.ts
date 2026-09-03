import { Hono, type Context } from "hono";
import { startTestExecutionRequestSchema } from "../../shared/testing/test-execution.js";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import {
  DestructiveConfirmationRequiredError,
  InvalidTestExecutionError,
  TestExecutionConflictError,
  TestExecutionNotFoundError,
  TestExecutionTargetError,
  type TestExecutionService,
} from "./test-execution-service.js";
import { TestCaseNotFoundError } from "./test-case-service.js";

const errors = {
  invalid: { error: { code: "TEST_EXECUTION_INVALID", message: "Test execution request is invalid" } },
  notFound: { error: { code: "TEST_EXECUTION_NOT_FOUND", message: "Test execution not found" } },
  conflict: { error: { code: "TEST_EXECUTION_CONFLICT", message: "Idempotency key was already used for a different test revision" } },
  target: { error: { code: "TEST_TARGET_NOT_AVAILABLE", message: "Test execution target is not available" } },
  destructive: { error: { code: "DESTRUCTIVE_CONFIRMATION_REQUIRED", message: "Destructive Tool confirmation is required" } },
  projectNotFound: { error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } },
  invalidStorage: { error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } },
} as const;

function mapError(context: Context, error: unknown) {
  if (error instanceof InvalidTestExecutionError) return context.json(errors.invalid, 400);
  if (error instanceof TestExecutionNotFoundError || error instanceof TestCaseNotFoundError) return context.json(errors.notFound, 404);
  if (error instanceof TestExecutionConflictError) return context.json(errors.conflict, 409);
  if (error instanceof TestExecutionTargetError) return context.json(errors.target, 404);
  if (error instanceof DestructiveConfirmationRequiredError) return context.json(errors.destructive, 409);
  if (error instanceof ProjectNotFoundError) return context.json(errors.projectNotFound, 404);
  if (error instanceof InvalidProjectStorageError) return context.json(errors.invalidStorage, 409);
  throw error;
}

export function createTestExecutionRoutes(executions: TestExecutionService): Hono {
  const routes = new Hono();

  routes.get("/:projectId/test-executions", (context) => {
    const rawLimit = context.req.query("limit");
    try {
      return context.json(executions.list(context.req.param("projectId"), {
        ...(context.req.query("testCaseId") === undefined ? {} : { testCaseId: context.req.query("testCaseId") }),
        ...(context.req.query("cursor") === undefined ? {} : { cursor: context.req.query("cursor") }),
        ...(rawLimit === undefined ? {} : { limit: Number(rawLimit) }),
      }));
    } catch (error) { return mapError(context, error); }
  });

  routes.post("/:projectId/test-cases/:testCaseId/executions", async (context) => {
    const idempotencyKey = context.req.header("Idempotency-Key") ?? "";
    if (idempotencyKey.length < 1 || idempotencyKey.length > 200) return context.json(errors.invalid, 400);
    let body: unknown;
    try { body = await context.req.json(); } catch { body = {}; }
    const parsed = startTestExecutionRequestSchema.safeParse(body);
    if (!parsed.success) return context.json(errors.invalid, 400);
    try {
      return context.json({ execution: executions.start({
        projectId: context.req.param("projectId"), testCaseId: context.req.param("testCaseId"),
        idempotencyKey, ...parsed.data,
      }) }, 202);
    } catch (error) { return mapError(context, error); }
  });

  routes.get("/:projectId/test-executions/:executionId", (context) => {
    try { return context.json({ execution: executions.get(context.req.param("projectId"), context.req.param("executionId")) }); }
    catch (error) { return mapError(context, error); }
  });

  routes.post("/:projectId/test-executions/:executionId/baseline", async (context) => {
    let body: unknown;
    try { body = await context.req.json(); } catch { body = {}; }
    try {
      return context.json(executions.updateBaseline(
        context.req.param("projectId"), context.req.param("executionId"), body,
      ));
    } catch (error) { return mapError(context, error); }
  });

  routes.post("/:projectId/test-executions/:executionId/cancel", (context) => {
    try {
      return executions.cancel(context.req.param("projectId"), context.req.param("executionId"))
        ? context.json({ cancelled: true })
        : context.json({ error: { code: "TEST_EXECUTION_NOT_ACTIVE", message: "Test execution is not active" } }, 409);
    } catch (error) { return mapError(context, error); }
  });

  return routes;
}
