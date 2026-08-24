import { Hono } from "hono";
import { z } from "zod";
import {
  ProjectNotFoundError,
  projectNameSchema,
  type ProjectService,
} from "./project-service.js";

const createProjectBodySchema = z.object({ name: projectNameSchema }).strict();

const invalidProject = {
  error: {
    code: "INVALID_PROJECT",
    message: "Project name must be 1 to 120 characters",
  },
} as const;

const projectNotFound = {
  error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
} as const;

export function createProjectRoutes(projects: ProjectService): Hono {
  const routes = new Hono();

  routes.get("/", (context) => context.json({ projects: projects.list() }));

  routes.post("/", async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json(invalidProject, 400);
    }
    const parsed = createProjectBodySchema.safeParse(body);
    if (!parsed.success) return context.json(invalidProject, 400);
    return context.json({ project: projects.create(parsed.data.name) }, 201);
  });

  routes.post("/:projectId/open", (context) => {
    const projectId = context.req.param("projectId");
    try {
      projects.open(projectId);
      const project = projects.list().find(({ id }) => id === projectId);
      if (project === undefined) throw new ProjectNotFoundError();
      return context.json({ project });
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        return context.json(projectNotFound, 404);
      }
      throw error;
    }
  });

  return routes;
}
