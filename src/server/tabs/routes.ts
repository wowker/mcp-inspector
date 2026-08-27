import { Hono, type Context } from "hono";
import { z } from "zod";
import { ConnectionNotFoundError } from "../connections/connection-service.js";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import { ToolNotFoundError } from "../tools/tool-service.js";
import { InvalidTabError, TabNotFoundError, type TabService } from "./tab-service.js";

const uuid = z.string().uuid();
const openBody = z.object({ connectionId: uuid, toolName: z.string().max(512).refine((value) => value.trim().length > 0) }).strict();
const replaceBody = openBody;
const viewState = z.object({ editorScrollTop: z.number().finite().min(0), resultScrollTop: z.number().finite().min(0),
  splitRatio: z.number().finite().min(0.2).max(0.8) }).strict();
const patchBody = z.object({ title: z.string().min(1).max(180).optional(), pinned: z.boolean().optional(),
  inputMode: z.enum(["form", "raw"]).optional(), arguments: z.record(z.string(), z.unknown()).optional(),
  rawText: z.string().max(2_000_000).optional(), viewState: viewState.optional(),
  lastRunId: uuid.nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0);
const listQuery = z.object({ connectionId: uuid }).strict();
const reorderBody = z.object({ connectionId: uuid, tabIds: z.array(uuid).max(1_000) }).strict();
const invalid = { error: { code: "INVALID_TAB", message: "Tab payload is invalid" } } as const;

function errorResponse(context: Context, error: unknown) {
  if (error instanceof ProjectNotFoundError) return context.json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } }, 404);
  if (error instanceof InvalidProjectStorageError) return context.json({ error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } }, 409);
  if (error instanceof ConnectionNotFoundError) return context.json({ error: { code: "CONNECTION_NOT_FOUND", message: "Connection not found" } }, 404);
  if (error instanceof ToolNotFoundError) return context.json({ error: { code: "TOOL_NOT_FOUND", message: "Tool not found" } }, 404);
  if (error instanceof TabNotFoundError) return context.json({ error: { code: "TAB_NOT_FOUND", message: "Tab not found" } }, 404);
  if (error instanceof InvalidTabError) return context.json(invalid, 400);
  throw error;
}

async function body(context: Context): Promise<unknown> {
  try { return await context.req.json(); } catch { return undefined; }
}

export function createTabRoutes(tabs: TabService): Hono {
  const routes = new Hono();
  routes.get("/:projectId/tabs", (c) => {
    const parsed = listQuery.safeParse({ connectionId: c.req.query("connectionId") });
    if (!parsed.success) return c.json(invalid, 400);
    try { return c.json({ tabs: tabs.list(c.req.param("projectId"), parsed.data.connectionId) }); } catch (e) { return errorResponse(c, e); }
  });
  routes.get("/:projectId/tabs/:tabId", (c) => { try {
    const tab = tabs.get(c.req.param("projectId"), c.req.param("tabId"));
    return c.json({ tab });
  } catch (e) { return errorResponse(c, e); } });
  routes.post("/:projectId/tabs", async (c) => {
    const parsed = openBody.safeParse(await body(c)); if (!parsed.success) return c.json(invalid, 400);
    try { return c.json({ tab: tabs.open({ projectId: c.req.param("projectId"), ...parsed.data }) }, 201); }
    catch (e) { return errorResponse(c, e); }
  });
  routes.patch("/:projectId/tabs/:tabId", async (c) => {
    const parsed = patchBody.safeParse(await body(c)); if (!parsed.success) return c.json(invalid, 400);
    try { return c.json({ tab: tabs.update(c.req.param("tabId"), c.req.param("projectId"), parsed.data) }); }
    catch (e) { return errorResponse(c, e); }
  });
  routes.put("/:projectId/tabs/:tabId/tool", async (c) => {
    const parsed = replaceBody.safeParse(await body(c)); if (!parsed.success) return c.json(invalid, 400);
    try { return c.json({ tab: tabs.replaceTool(c.req.param("projectId"), c.req.param("tabId"), parsed.data.connectionId, parsed.data.toolName) }); }
    catch (e) { return errorResponse(c, e); }
  });
  routes.post("/:projectId/tabs/:tabId/duplicate", (c) => { try { return c.json({ tab: tabs.duplicate(c.req.param("projectId"), c.req.param("tabId")) }, 201); } catch (e) { return errorResponse(c, e); } });
  routes.put("/:projectId/tabs/reorder", async (c) => {
    const parsed = reorderBody.safeParse(await body(c)); if (!parsed.success) return c.json(invalid, 400);
    try { return c.json({ tabs: tabs.reorder(c.req.param("projectId"), parsed.data.connectionId, parsed.data.tabIds) }); } catch (e) { return errorResponse(c, e); }
  });
  routes.delete("/:projectId/tabs/:tabId", (c) => { try { tabs.close(c.req.param("projectId"), c.req.param("tabId")); return c.body(null, 204); } catch (e) { return errorResponse(c, e); } });
  for (const [suffix, action] of [["close-others", tabs.closeOthers], ["close-right", tabs.closeRight]] as const) {
    routes.post(`/:projectId/tabs/:tabId/${suffix}`, (c) => { try { return c.json({ tabs: action(c.req.param("projectId"), c.req.param("tabId")) }); } catch (e) { return errorResponse(c, e); } });
  }
  return routes;
}
