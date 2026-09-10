import { Hono } from "hono";
import { replaceAuthoringPolicyInputSchema } from "../../shared/authoring/policy.js";
import {
  AuthoringConnectionNotFoundError,
  AuthoringPolicyRevisionConflictError,
  type AuthoringPolicyService,
} from "./authoring-policy-service.js";

function routeError(error: unknown) {
  if (error instanceof AuthoringConnectionNotFoundError) {
    return { status: 404 as const, body: { error: { code: "AUTHORING_CONNECTION_NOT_FOUND", message: "Authoring connection not found" } } };
  }
  if (error instanceof AuthoringPolicyRevisionConflictError) {
    return { status: 409 as const, body: { error: { code: "AUTHORING_POLICY_REVISION_CONFLICT", message: "Authoring policy changed; reload and try again" } } };
  }
  return null;
}

export function createAuthoringPolicyRoutes(policies: AuthoringPolicyService): Hono {
  const routes = new Hono();
  const path = "/:projectId/connections/:connectionId/authoring-policy";

  routes.get(path, (context) => {
    try {
      return context.json({ policy: policies.get(context.req.param("projectId"), context.req.param("connectionId")) });
    } catch (error) {
      const mapped = routeError(error);
      if (mapped !== null) return context.json(mapped.body, mapped.status);
      throw error;
    }
  });

  routes.put(path, async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: { code: "INVALID_REQUEST", message: "Request body must contain valid JSON" } }, 400);
    }
    const parsed = replaceAuthoringPolicyInputSchema.safeParse(body);
    if (!parsed.success) {
      return context.json({ error: { code: "INVALID_REQUEST", message: "Authoring policy is invalid" } }, 400);
    }
    try {
      return context.json({
        policy: policies.replace(
          context.req.param("projectId"),
          context.req.param("connectionId"),
          parsed.data,
        ),
      });
    } catch (error) {
      const mapped = routeError(error);
      if (mapped !== null) return context.json(mapped.body, mapped.status);
      throw error;
    }
  });

  return routes;
}
