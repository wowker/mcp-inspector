import { Hono, type Context } from "hono";
import {
  createSavedTestSuiteReportRequestSchema,
  updateSavedTestSuiteReportRequestSchema,
} from "../../shared/testing/test-suite-report.js";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import {
  InvalidSavedTestSuiteReportError,
  SavedTestSuiteReportConflictError,
  SavedTestSuiteReportExecutionNotTerminalError,
  SavedTestSuiteReportIdempotencyConflictError,
  SavedTestSuiteReportNotFoundError,
  SavedTestSuiteReportRevisionConflictError,
  type SavedTestSuiteReportService,
} from "./saved-test-suite-report-service.js";

const errors = {
  invalid: { error: { code: "TEST_SUITE_REPORT_INVALID", message: "Test suite report request is invalid" } },
  notFound: { error: { code: "TEST_SUITE_REPORT_NOT_FOUND", message: "Test suite report not found" } },
  versionConflict: { error: { code: "REPORT_VERSION_CONFLICT", message: "A report with this version label already exists" } },
  idempotencyConflict: { error: { code: "REPORT_IDEMPOTENCY_CONFLICT", message: "Idempotency key was reused for a different report" } },
  revisionConflict: { error: { code: "REPORT_REVISION_CONFLICT", message: "Test suite report revision conflict" } },
  notTerminal: { error: { code: "REPORT_EXECUTION_NOT_TERMINAL", message: "Only a completed suite execution can be saved" } },
  projectNotFound: { error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } },
  invalidStorage: { error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } },
} as const;

function mapError(context: Context, error: unknown) {
  if (error instanceof InvalidSavedTestSuiteReportError) return context.json(errors.invalid, 400);
  if (error instanceof SavedTestSuiteReportNotFoundError) return context.json(errors.notFound, 404);
  if (error instanceof SavedTestSuiteReportConflictError) return context.json(errors.versionConflict, 409);
  if (error instanceof SavedTestSuiteReportIdempotencyConflictError) return context.json(errors.idempotencyConflict, 409);
  if (error instanceof SavedTestSuiteReportRevisionConflictError) return context.json(errors.revisionConflict, 409);
  if (error instanceof SavedTestSuiteReportExecutionNotTerminalError) return context.json(errors.notTerminal, 409);
  if (error instanceof ProjectNotFoundError) return context.json(errors.projectNotFound, 404);
  if (error instanceof InvalidProjectStorageError) return context.json(errors.invalidStorage, 409);
  throw error;
}

export function createSavedTestSuiteReportRoutes(reports: SavedTestSuiteReportService): Hono {
  const routes = new Hono();

  routes.get("/:projectId/test-suite-reports", (context) => {
    const rawLimit = context.req.query("limit");
    try {
      return context.json(reports.list(context.req.param("projectId"), {
        ...(context.req.query("suiteId") === undefined ? {} : { suiteId: context.req.query("suiteId") }),
        ...(context.req.query("cursor") === undefined ? {} : { cursor: context.req.query("cursor") }),
        ...(rawLimit === undefined ? {} : { limit: Number(rawLimit) }),
      }));
    } catch (error) { return mapError(context, error); }
  });

  routes.post("/:projectId/test-suite-reports", async (context) => {
    const idempotencyKey = context.req.header("Idempotency-Key") ?? "";
    if (idempotencyKey.length < 1 || idempotencyKey.length > 200) return context.json(errors.invalid, 400);
    let body: unknown;
    try { body = await context.req.json(); } catch { body = {}; }
    const parsed = createSavedTestSuiteReportRequestSchema.safeParse(body);
    if (!parsed.success) return context.json(errors.invalid, 400);
    try {
      return context.json({ report: reports.create(context.req.param("projectId"), idempotencyKey, parsed.data) }, 201);
    } catch (error) { return mapError(context, error); }
  });

  routes.get("/:projectId/test-suite-reports/:reportId", (context) => {
    try {
      return context.json({ report: reports.get(context.req.param("projectId"), context.req.param("reportId")) });
    } catch (error) { return mapError(context, error); }
  });

  routes.patch("/:projectId/test-suite-reports/:reportId", async (context) => {
    let body: unknown;
    try { body = await context.req.json(); } catch { body = {}; }
    const parsed = updateSavedTestSuiteReportRequestSchema.safeParse(body);
    if (!parsed.success) return context.json(errors.invalid, 400);
    try {
      return context.json({ report: reports.update(
        context.req.param("projectId"), context.req.param("reportId"), parsed.data,
      ) });
    } catch (error) { return mapError(context, error); }
  });

  routes.delete("/:projectId/test-suite-reports/:reportId", (context) => {
    try {
      reports.remove(context.req.param("projectId"), context.req.param("reportId"));
      return context.body(null, 204);
    } catch (error) { return mapError(context, error); }
  });

  return routes;
}
