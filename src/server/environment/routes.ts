import { Hono, type Context } from "hono";
import { ConnectionNotFoundError } from "../connections/connection-service.js";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import {
  EnvironmentVariableNotFoundError,
  InvalidEnvironmentVariableError,
  type EnvironmentService,
} from "./environment-service.js";

const errors = {
  invalid: { error: { code: "INVALID_ENVIRONMENT_VARIABLE", message: "Environment variable is invalid" } },
  notFound: { error: { code: "ENVIRONMENT_VARIABLE_NOT_FOUND", message: "Environment variable not found" } },
  projectNotFound: { error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } },
  invalidProjectStorage: { error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } },
  connectionNotFound: { error: { code: "CONNECTION_NOT_FOUND", message: "Connection not found" } },
} as const;

function mapError(context: Context, error: unknown) {
  if (error instanceof InvalidEnvironmentVariableError) return context.json(errors.invalid, 400);
  if (error instanceof EnvironmentVariableNotFoundError) return context.json(errors.notFound, 404);
  if (error instanceof ProjectNotFoundError) return context.json(errors.projectNotFound, 404);
  if (error instanceof InvalidProjectStorageError) return context.json(errors.invalidProjectStorage, 409);
  if (error instanceof ConnectionNotFoundError) return context.json(errors.connectionNotFound, 404);
  throw error;
}

export function createEnvironmentRoutes(environment: EnvironmentService): Hono {
  const routes = new Hono();

  function register(listPath: string, itemPath: string, connection: (context: Context) => string | null) {
    routes.get(listPath, (context) => {
      try {
        return context.json({ variables: environment.list(
          context.req.param("projectId")!, connection(context),
        ) });
      } catch (error) { return mapError(context, error); }
    });
    routes.put(itemPath, async (context) => {
      let body: unknown;
      try { body = await context.req.json(); } catch { return context.json(errors.invalid, 400); }
      try {
        return context.json({ variable: environment.set(
          context.req.param("projectId")!, connection(context), context.req.param("name")!, body,
        ) });
      } catch (error) { return mapError(context, error); }
    });
    routes.delete(itemPath, (context) => {
      try {
        environment.delete(
          context.req.param("projectId")!, connection(context), context.req.param("name")!,
        );
        return context.body(null, 204);
      } catch (error) { return mapError(context, error); }
    });
  }

  register("/:projectId/variables", "/:projectId/variables/:name", () => null);
  register(
    "/:projectId/connections/:connectionId/variables",
    "/:projectId/connections/:connectionId/variables/:name",
    (context) => context.req.param("connectionId")!,
  );
  return routes;
}
