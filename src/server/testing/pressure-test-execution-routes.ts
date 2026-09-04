import { Hono, type Context } from "hono";
import { startPressureTestExecutionRequestSchema } from "../../shared/testing/pressure-test.js";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import { TestCaseNotFoundError } from "./test-case-service.js";
import {
  InvalidPressureTestExecutionError,
  PressureTestAlreadyRunningError,
  PressureTestDestructiveConfirmationRequiredError,
  PressureTestExecutionConflictError,
  PressureTestExecutionNotFoundError,
  PressureTestTargetNotAvailableError,
  type PressureTestExecutionService,
} from "./pressure-test-execution-service.js";
import { PressureTestNotFoundError } from "./pressure-test-service.js";

const errors = {
  invalid: { error: { code: "PRESSURE_TEST_EXECUTION_INVALID", message: "Pressure test execution request is invalid" } },
  notFound: { error: { code: "PRESSURE_TEST_EXECUTION_NOT_FOUND", message: "Pressure test execution not found" } },
  conflict: { error: { code: "PRESSURE_TEST_EXECUTION_CONFLICT", message: "Idempotency key was already used for a different pressure test revision" } },
  active: { error: { code: "PRESSURE_TEST_ALREADY_RUNNING", message: "A pressure test is already running in this project" } },
  target: { error: { code: "TEST_TARGET_NOT_AVAILABLE", message: "Pressure test target is not available" } },
  destructive: { error: { code: "DESTRUCTIVE_CONFIRMATION_REQUIRED", message: "Destructive Tool confirmation is required" } },
  projectNotFound: { error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } },
  invalidStorage: { error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } },
} as const;

function mapError(context: Context, error: unknown) {
  if (error instanceof InvalidPressureTestExecutionError) return context.json(errors.invalid, 400);
  if (error instanceof PressureTestExecutionNotFoundError || error instanceof PressureTestNotFoundError ||
      error instanceof TestCaseNotFoundError) return context.json(errors.notFound, 404);
  if (error instanceof PressureTestExecutionConflictError) return context.json(errors.conflict, 409);
  if (error instanceof PressureTestAlreadyRunningError) return context.json(errors.active, 409);
  if (error instanceof PressureTestTargetNotAvailableError) return context.json(errors.target, 404);
  if (error instanceof PressureTestDestructiveConfirmationRequiredError) return context.json(errors.destructive, 409);
  if (error instanceof ProjectNotFoundError) return context.json(errors.projectNotFound, 404);
  if (error instanceof InvalidProjectStorageError) return context.json(errors.invalidStorage, 409);
  throw error;
}

export function createPressureTestExecutionRoutes(executions: PressureTestExecutionService): Hono {
  const routes = new Hono();
  routes.get("/:projectId/pressure-test-executions", (context) => {
    const rawLimit = context.req.query("limit");
    try {
      return context.json(executions.list(context.req.param("projectId"), {
        ...(context.req.query("pressureTestId") === undefined ? {} : { pressureTestId: context.req.query("pressureTestId") }),
        ...(context.req.query("cursor") === undefined ? {} : { cursor: context.req.query("cursor") }),
        ...(rawLimit === undefined ? {} : { limit: Number(rawLimit) }),
      }));
    } catch (error) { return mapError(context, error); }
  });
  routes.post("/:projectId/pressure-tests/:pressureTestId/executions", async (context) => {
    const idempotencyKey = context.req.header("Idempotency-Key") ?? "";
    if (idempotencyKey.length < 1 || idempotencyKey.length > 200) return context.json(errors.invalid, 400);
    let body: unknown;
    try { body = await context.req.json(); } catch { body = {}; }
    const parsed = startPressureTestExecutionRequestSchema.safeParse(body);
    if (!parsed.success) return context.json(errors.invalid, 400);
    try {
      return context.json({ execution: executions.start({
        projectId: context.req.param("projectId"),
        pressureTestId: context.req.param("pressureTestId"),
        idempotencyKey,
        request: parsed.data,
      }) }, 202);
    } catch (error) { return mapError(context, error); }
  });
  routes.get("/:projectId/pressure-test-executions/:executionId", (context) => {
    try {
      return context.json({ execution: executions.get(
        context.req.param("projectId"), context.req.param("executionId"),
      ) });
    } catch (error) { return mapError(context, error); }
  });
  routes.get("/:projectId/pressure-test-executions/:executionId/samples", (context) => {
    const rawLimit = context.req.query("limit");
    try {
      return context.json(executions.samples(
        context.req.param("projectId"), context.req.param("executionId"), {
          ...(context.req.query("cursor") === undefined ? {} : { cursor: context.req.query("cursor") }),
          ...(rawLimit === undefined ? {} : { limit: Number(rawLimit) }),
        },
      ));
    } catch (error) { return mapError(context, error); }
  });
  routes.post("/:projectId/pressure-test-executions/:executionId/cancel", (context) => {
    try {
      return executions.cancel(context.req.param("projectId"), context.req.param("executionId"))
        ? context.json({ cancelled: true })
        : context.json({ error: { code: "PRESSURE_TEST_EXECUTION_NOT_ACTIVE", message: "Pressure test execution is not active" } }, 409);
    } catch (error) { return mapError(context, error); }
  });
  return routes;
}
