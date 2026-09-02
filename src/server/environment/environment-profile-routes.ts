import { Hono, type Context } from "hono";
import { z } from "zod";
import { ConnectionNotFoundError } from "../connections/connection-service.js";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import {
  EnvironmentProfileInUseError,
  EnvironmentProfileConnectionActiveError,
  EnvironmentProfileNotFoundError,
  EnvironmentProfileRevisionConflictError,
  InvalidEnvironmentProfileError,
  type EnvironmentProfileService,
} from "./environment-profile-service.js";

const errors = {
  invalid: { error: { code: "INVALID_ENVIRONMENT_PROFILE", message: "Environment profile is invalid" } },
  notFound: { error: { code: "ENVIRONMENT_PROFILE_NOT_FOUND", message: "Environment profile not found" } },
  conflict: { error: { code: "ENVIRONMENT_PROFILE_REVISION_CONFLICT", message: "Environment profile changed" } },
  inUse: { error: { code: "ENVIRONMENT_PROFILE_IN_USE", message: "Environment profile is in use" } },
  connectionActive: { error: { code: "ENVIRONMENT_PROFILE_CONNECTION_ACTIVE", message: "Disconnect the connection before changing its environment profile" } },
  connectionNotFound: { error: { code: "CONNECTION_NOT_FOUND", message: "Connection not found" } },
  projectNotFound: { error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } },
  invalidStorage: { error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } },
} as const;

function mapError(context: Context, error: unknown) {
  if (error instanceof InvalidEnvironmentProfileError) return context.json(errors.invalid, 400);
  if (error instanceof EnvironmentProfileNotFoundError) return context.json(errors.notFound, 404);
  if (error instanceof EnvironmentProfileRevisionConflictError) return context.json(errors.conflict, 409);
  if (error instanceof EnvironmentProfileInUseError) return context.json(errors.inUse, 409);
  if (error instanceof EnvironmentProfileConnectionActiveError) return context.json(errors.connectionActive, 409);
  if (error instanceof ConnectionNotFoundError) return context.json(errors.connectionNotFound, 404);
  if (error instanceof ProjectNotFoundError) return context.json(errors.projectNotFound, 404);
  if (error instanceof InvalidProjectStorageError) return context.json(errors.invalidStorage, 409);
  throw error;
}

async function body(context: Context): Promise<unknown> {
  try { return await context.req.json(); } catch { throw new InvalidEnvironmentProfileError(); }
}

export function createEnvironmentProfileRoutes(profiles: EnvironmentProfileService): Hono {
  const routes = new Hono();

  routes.get("/:projectId/environment-profiles", (context) => {
    try { return context.json({ profiles: profiles.list(context.req.param("projectId")!) }); }
    catch (error) { return mapError(context, error); }
  });
  routes.post("/:projectId/environment-profiles", async (context) => {
    try { return context.json({ profile: profiles.create(context.req.param("projectId")!, await body(context)) }, 201); }
    catch (error) { return mapError(context, error); }
  });
  routes.get("/:projectId/environment-profiles/:profileId", (context) => {
    try { return context.json({ profile: profiles.get(context.req.param("projectId")!, context.req.param("profileId")!) }); }
    catch (error) { return mapError(context, error); }
  });
  routes.put("/:projectId/environment-profiles/:profileId", async (context) => {
    try { return context.json({ profile: profiles.update(context.req.param("projectId")!, context.req.param("profileId")!, await body(context)) }); }
    catch (error) { return mapError(context, error); }
  });
  routes.delete("/:projectId/environment-profiles/:profileId", (context) => {
    try { profiles.delete(context.req.param("projectId")!, context.req.param("profileId")!); return context.body(null, 204); }
    catch (error) { return mapError(context, error); }
  });

  function variables(base: string, connection: (context: Context) => string | null) {
    routes.get(base, (context) => {
      try { return context.json({ variables: profiles.listVariables(context.req.param("projectId")!, context.req.param("profileId")!, connection(context)) }); }
      catch (error) { return mapError(context, error); }
    });
    routes.put(`${base}/:name`, async (context) => {
      try { return context.json({ variable: profiles.setVariable(context.req.param("projectId")!, context.req.param("profileId")!, connection(context), context.req.param("name")!, await body(context)) }); }
      catch (error) { return mapError(context, error); }
    });
    routes.delete(`${base}/:name`, (context) => {
      try { profiles.deleteVariable(context.req.param("projectId")!, context.req.param("profileId")!, connection(context), context.req.param("name")!); return context.body(null, 204); }
      catch (error) { return mapError(context, error); }
    });
  }
  variables("/:projectId/environment-profiles/:profileId/variables", () => null);
  variables("/:projectId/environment-profiles/:profileId/connections/:connectionId/variables", (context) => context.req.param("connectionId")!);

  routes.get("/:projectId/connections/:connectionId/environment-profile", (context) => {
    try {
      const projectId = context.req.param("projectId")!;
      const connectionId = context.req.param("connectionId")!;
      const profileId = profiles.getActiveProfileId(projectId, connectionId);
      return context.json({ profileId, preview: profiles.preview(projectId, connectionId, profileId) });
    } catch (error) { return mapError(context, error); }
  });
  routes.put("/:projectId/connections/:connectionId/environment-profile", async (context) => {
    try {
      const parsed = z.object({ profileId: z.uuid().nullable() }).strict().safeParse(await body(context));
      if (!parsed.success) throw new InvalidEnvironmentProfileError();
      const projectId = context.req.param("projectId")!;
      const connectionId = context.req.param("connectionId")!;
      profiles.setActiveProfileId(projectId, connectionId, parsed.data.profileId);
      return context.json({ profileId: parsed.data.profileId, preview: profiles.preview(projectId, connectionId, parsed.data.profileId) });
    } catch (error) { return mapError(context, error); }
  });
  routes.post("/:projectId/connections/:connectionId/environment-profile/preview", async (context) => {
    try {
      const parsed = z.object({ profileId: z.uuid().nullable() }).strict().safeParse(await body(context));
      if (!parsed.success) throw new InvalidEnvironmentProfileError();
      return context.json({ preview: profiles.preview(
        context.req.param("projectId")!, context.req.param("connectionId")!, parsed.data.profileId,
      ) });
    } catch (error) { return mapError(context, error); }
  });
  return routes;
}
