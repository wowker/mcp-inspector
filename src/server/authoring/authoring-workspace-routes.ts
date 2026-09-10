import { Hono, type Context } from "hono";
import { z } from "zod";
import { authoringCallStatusSchema } from "../../shared/authoring/calls.js";
import { replaceDraftInputSchema } from "../../shared/authoring/draft.js";
import { validateDraftInputSchema } from "../../shared/authoring/validation.js";
import { ProjectNotFoundError } from "../projects/project-service.js";
import { AuthoringCallNotFoundError, type AuthoringCallService } from "./authoring-call-service.js";
import { InvalidAuthoringCallCursorError } from "./authoring-call-repository.js";
import {
  AuthoringDraftIdempotencyConflictError,
  AuthoringDraftInvalidError,
  AuthoringDraftNotFoundError,
  AuthoringDraftRevisionConflictError,
  type AuthoringDraftService,
} from "./authoring-draft-service.js";
import { InvalidAuthoringDraftCursorError } from "./authoring-draft-repository.js";
import { AuthoringDraftValidationStaleError, type AuthoringDraftValidator } from "./authoring-draft-validator.js";

const listDraftsQuery = z.object({
  cursor: z.string().min(1).max(4_096).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  state: z.enum(["ACTIVE", "APPLIED", "DISCARDED"]).optional(),
}).strict();
const listCallsQuery = z.object({
  cursor: z.string().min(1).max(4_096).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  connectionId: z.string().uuid().optional(),
  toolName: z.string().trim().min(1).max(256).optional(),
  status: authoringCallStatusSchema.optional(),
  contextKind: z.enum(["STANDALONE", "DRAFT"]).optional(),
}).strict();

function errorResponse(context: Context, error: unknown) {
  if (error instanceof ProjectNotFoundError) return context.json({ error: { code: "PROJECT_NOT_FOUND", message: error.message } }, 404);
  if (error instanceof AuthoringDraftNotFoundError || error instanceof AuthoringCallNotFoundError) {
    return context.json({ error: { code: "AUTHORING_RESOURCE_NOT_FOUND", message: error.message } }, 404);
  }
  if (error instanceof AuthoringDraftRevisionConflictError || error instanceof AuthoringDraftValidationStaleError) {
    return context.json({ error: { code: "DRAFT_REVISION_CONFLICT", message: error.message } }, 409);
  }
  if (error instanceof AuthoringDraftIdempotencyConflictError) {
    return context.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: error.message } }, 409);
  }
  if (error instanceof InvalidAuthoringDraftCursorError || error instanceof InvalidAuthoringCallCursorError ||
      error instanceof AuthoringDraftInvalidError || error instanceof z.ZodError) {
    return context.json({ error: { code: "INVALID_AUTHORING_REQUEST", message: "Authoring request is invalid" } }, 400);
  }
  throw error;
}

async function body(context: Context): Promise<unknown> {
  try { return await context.req.json(); } catch { return undefined; }
}

export function createAuthoringWorkspaceRoutes(options: {
  calls: AuthoringCallService;
  drafts: AuthoringDraftService;
  validator: AuthoringDraftValidator;
}): Hono {
  const routes = new Hono();
  routes.get("/:projectId/authoring/drafts", (context) => {
    const parsed = listDraftsQuery.safeParse(context.req.query());
    if (!parsed.success) return errorResponse(context, parsed.error);
    try { return context.json(options.drafts.list(context.req.param("projectId"), parsed.data)); }
    catch (error) { return errorResponse(context, error); }
  });
  routes.get("/:projectId/authoring/drafts/:draftId", (context) => {
    try { return context.json({ draft: options.drafts.get(context.req.param("projectId"), context.req.param("draftId")) }); }
    catch (error) { return errorResponse(context, error); }
  });
  routes.put("/:projectId/authoring/drafts/:draftId", async (context) => {
    const value = await body(context);
    const parsed = replaceDraftInputSchema.safeParse({
      ...(typeof value === "object" && value !== null ? value : {}),
      projectId: context.req.param("projectId"), draftId: context.req.param("draftId"),
    });
    if (!parsed.success) return errorResponse(context, parsed.error);
    try { return context.json({ result: options.drafts.replace(parsed.data) }); }
    catch (error) { return errorResponse(context, error); }
  });
  routes.post("/:projectId/authoring/drafts/:draftId/validate", async (context) => {
    const value = await body(context);
    const parsed = validateDraftInputSchema.safeParse({
      ...(typeof value === "object" && value !== null ? value : {}),
      projectId: context.req.param("projectId"), draftId: context.req.param("draftId"),
    });
    if (!parsed.success) return errorResponse(context, parsed.error);
    try { return context.json({ validation: options.validator.validate(parsed.data) }); }
    catch (error) { return errorResponse(context, error); }
  });
  routes.get("/:projectId/authoring/calls", (context) => {
    const parsed = listCallsQuery.safeParse(context.req.query());
    if (!parsed.success) return errorResponse(context, parsed.error);
    try { return context.json(options.calls.list(context.req.param("projectId"), parsed.data)); }
    catch (error) { return errorResponse(context, error); }
  });
  routes.get("/:projectId/authoring/calls/:callId", (context) => {
    try { return context.json({ call: options.calls.get(context.req.param("projectId"), context.req.param("callId")) }); }
    catch (error) { return errorResponse(context, error); }
  });
  return routes;
}
