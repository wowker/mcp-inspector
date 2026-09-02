import { Hono, type Context } from "hono";
import {
  createTestCaseRequestSchema,
  updateTestCaseRequestSchema,
} from "../../shared/testing/test-case.js";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import {
  InvalidTestCaseError,
  TestCaseNotFoundError,
  TestCaseRevisionConflictError,
  TestTargetNotAvailableError,
  type TestCaseService,
} from "./test-case-service.js";
import { TestCasePreviewSourceNotFoundError, type TestCasePreviewService } from "./test-case-preview-service.js";
import { z } from "zod";
import { createTestSuiteRequestSchema, updateTestSuiteRequestSchema } from "../../shared/testing/test-suite.js";
import {
  InvalidTestSuiteError,
  TestSuiteMemberNotFoundError,
  TestSuiteNotFoundError,
  TestSuiteRevisionConflictError,
  type TestSuiteService,
} from "./test-suite-service.js";

const errors = {
  invalid: { error: { code: "TEST_CASE_INVALID", message: "Test case definition is invalid" } },
  notFound: { error: { code: "TEST_CASE_NOT_FOUND", message: "Test case not found" } },
  conflict: { error: { code: "TEST_CASE_REVISION_CONFLICT", message: "Test case revision conflict" } },
  target: { error: { code: "TEST_TARGET_NOT_AVAILABLE", message: "Test case target is not available in this project" } },
  projectNotFound: { error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } },
  invalidStorage: { error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } },
  sourceNotFound: { error: { code: "TEST_CASE_SOURCE_NOT_FOUND", message: "Test case preview source not found" } },
} as const;

async function jsonBody(context: Context): Promise<unknown> {
  try { return await context.req.json(); }
  catch { return undefined; }
}

function mapError(context: Context, error: unknown) {
  if (error instanceof InvalidTestCaseError) return context.json(errors.invalid, 400);
  if (error instanceof TestCaseNotFoundError) return context.json(errors.notFound, 404);
  if (error instanceof TestCaseRevisionConflictError) return context.json(errors.conflict, 409);
  if (error instanceof TestTargetNotAvailableError) return context.json(errors.target, 404);
  if (error instanceof ProjectNotFoundError) return context.json(errors.projectNotFound, 404);
  if (error instanceof InvalidProjectStorageError) return context.json(errors.invalidStorage, 409);
  if (error instanceof TestCasePreviewSourceNotFoundError) return context.json(errors.sourceNotFound, 404);
  throw error;
}

export function createTestCaseRoutes(testCases: TestCaseService, previews?: TestCasePreviewService): Hono {
  const routes = new Hono();
  const base = "/:projectId/test-cases";

  routes.get(base, (context) => {
    const limitText = context.req.query("limit");
    const limit = limitText === undefined ? undefined : Number(limitText);
    if (limitText !== undefined && (!Number.isInteger(limit) || limit! < 1 || limit! > 100)) {
      return context.json(errors.invalid, 400);
    }
    try {
      return context.json(testCases.list(context.req.param("projectId"), {
        ...(context.req.query("kind") === undefined ? {} : { kind: context.req.query("kind") as "tool" | "scenario" }),
        ...(context.req.query("connectionId") === undefined ? {} : { connectionId: context.req.query("connectionId") }),
        ...(context.req.query("tag") === undefined ? {} : { tag: context.req.query("tag") }),
        ...(context.req.query("query") === undefined ? {} : { query: context.req.query("query") }),
        ...(context.req.query("cursor") === undefined ? {} : { cursor: context.req.query("cursor") }),
        ...(limit === undefined ? {} : { limit }),
      }));
    } catch (error) { return mapError(context, error); }
  });

  routes.post(base, async (context) => {
    const parsed = createTestCaseRequestSchema.safeParse(await jsonBody(context));
    if (!parsed.success) return context.json(errors.invalid, 400);
    try {
      return context.json({ testCase: testCases.create(context.req.param("projectId"), parsed.data) }, 201);
    } catch (error) { return mapError(context, error); }
  });

  const sourceRequest = z.object({ id: z.uuid() }).strict();
  routes.post(`${base}/from-run`, async (context) => {
    const parsed = sourceRequest.safeParse(await jsonBody(context));
    if (!parsed.success || previews === undefined) return context.json(errors.invalid, 400);
    try { return context.json({ preview: previews.fromRun(context.req.param("projectId"), parsed.data.id) }); }
    catch (error) { return mapError(context, error); }
  });

  routes.post(`${base}/from-saved-item`, async (context) => {
    const parsed = sourceRequest.safeParse(await jsonBody(context));
    if (!parsed.success || previews === undefined) return context.json(errors.invalid, 400);
    try { return context.json({ preview: previews.fromSavedItem(context.req.param("projectId"), parsed.data.id) }); }
    catch (error) { return mapError(context, error); }
  });

  routes.get(`${base}/:testCaseId`, (context) => {
    try {
      return context.json({ testCase: testCases.get(
        context.req.param("projectId"), context.req.param("testCaseId"),
      ) });
    } catch (error) { return mapError(context, error); }
  });

  routes.patch(`${base}/:testCaseId`, async (context) => {
    const parsed = updateTestCaseRequestSchema.safeParse(await jsonBody(context));
    if (!parsed.success) return context.json(errors.invalid, 400);
    try {
      return context.json({ testCase: testCases.update(
        context.req.param("projectId"), context.req.param("testCaseId"), parsed.data,
      ) });
    } catch (error) { return mapError(context, error); }
  });

  routes.delete(`${base}/:testCaseId`, (context) => {
    try {
      testCases.remove(context.req.param("projectId"), context.req.param("testCaseId"));
      return context.body(null, 204);
    } catch (error) { return mapError(context, error); }
  });

  return routes;
}

const suiteErrors = {
  invalid: { error: { code: "TEST_SUITE_INVALID", message: "Test suite definition is invalid" } },
  notFound: { error: { code: "TEST_SUITE_NOT_FOUND", message: "Test suite not found" } },
  conflict: { error: { code: "TEST_SUITE_REVISION_CONFLICT", message: "Test suite revision conflict" } },
  member: { error: { code: "TEST_SUITE_MEMBER_NOT_FOUND", message: "Test suite member is not available" } },
  projectNotFound: errors.projectNotFound,
  invalidStorage: errors.invalidStorage,
} as const;

function mapSuiteError(context: Context, error: unknown) {
  if (error instanceof InvalidTestSuiteError) return context.json(suiteErrors.invalid, 400);
  if (error instanceof TestSuiteNotFoundError) return context.json(suiteErrors.notFound, 404);
  if (error instanceof TestSuiteRevisionConflictError) return context.json(suiteErrors.conflict, 409);
  if (error instanceof TestSuiteMemberNotFoundError) return context.json(suiteErrors.member, 404);
  if (error instanceof ProjectNotFoundError) return context.json(suiteErrors.projectNotFound, 404);
  if (error instanceof InvalidProjectStorageError) return context.json(suiteErrors.invalidStorage, 409);
  throw error;
}

export function createTestSuiteRoutes(suites: TestSuiteService): Hono {
  const routes = new Hono();
  const base = "/:projectId/test-suites";
  routes.get(base, (context) => {
    try { return context.json(suites.list(context.req.param("projectId"))); }
    catch (error) { return mapSuiteError(context, error); }
  });
  routes.post(base, async (context) => {
    const parsed = createTestSuiteRequestSchema.safeParse(await jsonBody(context));
    if (!parsed.success) return context.json(suiteErrors.invalid, 400);
    try { return context.json({ testSuite: suites.create(context.req.param("projectId"), parsed.data) }, 201); }
    catch (error) { return mapSuiteError(context, error); }
  });
  routes.get(`${base}/:suiteId`, (context) => {
    try { return context.json({ testSuite: suites.get(context.req.param("projectId"), context.req.param("suiteId")) }); }
    catch (error) { return mapSuiteError(context, error); }
  });
  routes.patch(`${base}/:suiteId`, async (context) => {
    const parsed = updateTestSuiteRequestSchema.safeParse(await jsonBody(context));
    if (!parsed.success) return context.json(suiteErrors.invalid, 400);
    try {
      return context.json({ testSuite: suites.update(
        context.req.param("projectId"), context.req.param("suiteId"), parsed.data,
      ) });
    } catch (error) { return mapSuiteError(context, error); }
  });
  routes.delete(`${base}/:suiteId`, (context) => {
    try {
      suites.remove(context.req.param("projectId"), context.req.param("suiteId"));
      return context.body(null, 204);
    } catch (error) { return mapSuiteError(context, error); }
  });
  return routes;
}
