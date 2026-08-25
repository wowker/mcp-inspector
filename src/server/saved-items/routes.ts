import { Hono, type Context } from "hono";
import { z } from "zod";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import { InvalidSavedItemError, SavedItemNotFoundError, SavedItemToolNotFoundError,
  type SavedItemService } from "./saved-item-service.js";

const createBody = z.object({ kind: z.enum(["request", "response"]), name: z.string(), description: z.string(),
  payload: z.unknown(), sourceRunId: z.string().uuid().nullable() }).strict();
const invalid = { error: { code: "INVALID_SAVED_ITEM", message: "Saved item payload is invalid" } } as const;

async function body(context: Context): Promise<unknown> {
  try { return await context.req.json(); } catch { return undefined; }
}
function errorResponse(context: Context, error: unknown) {
  if (error instanceof ProjectNotFoundError) return context.json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } }, 404);
  if (error instanceof InvalidProjectStorageError) return context.json({ error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } }, 409);
  if (error instanceof SavedItemToolNotFoundError) return context.json({ error: { code: "TOOL_NOT_FOUND", message: "Tool not found" } }, 404);
  if (error instanceof SavedItemNotFoundError) return context.json({ error: { code: "SAVED_ITEM_NOT_FOUND", message: "Saved item not found" } }, 404);
  if (error instanceof InvalidSavedItemError) return context.json(invalid, 400);
  throw error;
}

export function createSavedItemRoutes(saved: SavedItemService): Hono {
  const routes = new Hono();
  const base = "/:projectId/connections/:connectionId/tools/:toolName/saved-items";
  routes.get(base, (c) => { try { return c.json(saved.list(c.req.param("projectId"), c.req.param("connectionId"), c.req.param("toolName"), c.req.query("cursor"))); }
    catch (error) { return errorResponse(c, error); } });
  routes.get(`${base}/:itemId`, (c) => { try {
    const item = saved.get(c.req.param("projectId"), c.req.param("itemId"));
    if (item.connectionId !== c.req.param("connectionId") || item.toolName !== c.req.param("toolName")) throw new SavedItemNotFoundError();
    return c.json({ item });
  } catch (error) { return errorResponse(c, error); } });
  routes.post(base, async (c) => {
    const parsed = createBody.safeParse(await body(c)); if (!parsed.success) return c.json(invalid, 400);
    try { return c.json({ item: saved.create({ projectId: c.req.param("projectId"), connectionId: c.req.param("connectionId"),
      toolName: c.req.param("toolName"), ...parsed.data }) }, 201); }
    catch (error) { return errorResponse(c, error); }
  });
  routes.delete(`${base}/:itemId`, (c) => { try {
    const item = saved.get(c.req.param("projectId"), c.req.param("itemId"));
    if (item.connectionId !== c.req.param("connectionId") || item.toolName !== c.req.param("toolName")) throw new SavedItemNotFoundError();
    saved.remove(c.req.param("projectId"), c.req.param("itemId")); return c.body(null, 204);
  } catch (error) { return errorResponse(c, error); } });
  return routes;
}
