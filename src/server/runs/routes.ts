import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { runHistoryFilterSchema, runPinRequestSchema } from "../../shared/run-replay.js";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import { TabNotFoundError } from "../tabs/tab-service.js";
import {
  InvalidRunCursorError, InvalidRunError, RunIdempotencyConflictError, RunNotFoundError,
  RunActiveError, RunReferencedError, RunValidationError, type RunServiceWithEvents,
} from "./run-service.js";
import type { RunEvent } from "./run-types.js";

const uuid = z.string().uuid();
const toolName = z.string().min(1).max(512).refine((value) => value.trim() === value);
const startBody = z.object({ connectionId: uuid, tabId: uuid, idempotencyKey: z.string().min(1).max(200),
  arguments: z.record(z.string(), z.unknown()) }).strict();
const errors = {
  invalid: { error: { code: "INVALID_RUN", message: "Run payload is invalid" } },
  notFound: { error: { code: "RUN_NOT_FOUND", message: "Run not found" } },
  conflict: { error: { code: "RUN_IDEMPOTENCY_CONFLICT", message: "Run idempotency conflict" } },
  cursor: { error: { code: "INVALID_RUN_CURSOR", message: "Run cursor is invalid" } },
} as const;

function errorResponse(context: Context, error: unknown) {
  if (error instanceof ProjectNotFoundError) return context.json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } }, 404);
  if (error instanceof InvalidProjectStorageError) return context.json({ error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } }, 409);
  if (error instanceof TabNotFoundError || error instanceof RunNotFoundError) return context.json(errors.notFound, 404);
  if (error instanceof RunIdempotencyConflictError) return context.json(errors.conflict, 409);
  if (error instanceof RunActiveError) return context.json({ error: { code: "RUN_ACTIVE", message: error.message } }, 409);
  if (error instanceof RunReferencedError) return context.json({ error: { code: "RUN_REFERENCED", message: error.message } }, 409);
  if (error instanceof RunValidationError) return context.json({ error: { code: "INVALID_ARGUMENTS", message: "Run arguments are invalid", issues: error.issues } }, 422);
  if (error instanceof InvalidRunCursorError) return context.json(errors.cursor, 400);
  if (error instanceof InvalidRunError) return context.json(errors.invalid, 400);
  throw error;
}

async function jsonBody(context: Context): Promise<unknown> {
  try { return await context.req.json(); } catch { return undefined; }
}

function afterValue(raw: string | undefined): number | null {
  if (raw === undefined) return 0;
  if (!/^(0|[1-9]\d*)$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export function createRunRoutes(runs: RunServiceWithEvents): Hono {
  const routes = new Hono();
  routes.post("/:projectId/runs", async (c) => {
    const parsed = startBody.safeParse(await jsonBody(c)); if (!parsed.success) return c.json(errors.invalid, 400);
    try { return c.json({ run: runs.start({ projectId: c.req.param("projectId"), ...parsed.data }) }, 202); }
    catch (error) { return errorResponse(c, error); }
  });
  routes.post("/:projectId/runs/:runId/cancel", (c) => {
    try {
      const changed = runs.cancel(c.req.param("projectId"), c.req.param("runId"));
      return changed ? c.json({ accepted: true }, 202) : c.json({ error: { code: "RUN_TERMINAL", message: "Run is already terminal" } }, 409);
    } catch (error) { return errorResponse(c, error); }
  });
  routes.get("/:projectId/runs", (c) => {
    const tabId = c.req.query("tabId");
    const connectionId = c.req.query("connectionId");
    const requestedToolName = c.req.query("toolName");
    const rawPinned = c.req.query("pinned");
    const rawLimit = c.req.query("limit");
    const parsed = runHistoryFilterSchema.safeParse({
      ...(tabId === undefined ? {} : { tabId }),
      ...(connectionId === undefined ? {} : { connectionId }),
      ...(requestedToolName === undefined ? {} : { toolName: requestedToolName }),
      ...(c.req.query("status") === undefined ? {} : { status: c.req.query("status") }),
      ...(c.req.query("origin") === undefined ? {} : { origin: c.req.query("origin") }),
      ...(rawPinned === undefined ? {} : { pinned: rawPinned === "true" ? true : rawPinned === "false" ? false : rawPinned }),
      ...(c.req.query("createdFrom") === undefined ? {} : { createdFrom: c.req.query("createdFrom") }),
      ...(c.req.query("createdTo") === undefined ? {} : { createdTo: c.req.query("createdTo") }),
      ...(rawLimit === undefined || !/^\d+$/.test(rawLimit) ? (rawLimit === undefined ? {} : { limit: rawLimit }) : { limit: Number(rawLimit) }),
    });
    if (!parsed.success) return c.json(errors.invalid, 400);
    try { return c.json(runs.list(c.req.param("projectId"), c.req.query("cursor"), parsed.data)); }
    catch (error) { return errorResponse(c, error); }
  });
  routes.delete("/:projectId/runs", (c) => {
    const parsed = z.object({ tabId: uuid, connectionId: uuid, toolName }).strict().safeParse({
      tabId: c.req.query("tabId"), connectionId: c.req.query("connectionId"), toolName: c.req.query("toolName"),
    });
    if (!parsed.success) return c.json(errors.invalid, 400);
    try { return c.json(runs.clearHistory(c.req.param("projectId"), parsed.data)); }
    catch (error) { return errorResponse(c, error); }
  });
  routes.delete("/:projectId/runs/:runId", (c) => {
    try { runs.delete(c.req.param("projectId"), c.req.param("runId")); return c.body(null, 204); }
    catch (error) { return errorResponse(c, error); }
  });
  routes.patch("/:projectId/runs/:runId/pin", async (c) => {
    const parsed = runPinRequestSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return c.json(errors.invalid, 400);
    try { return c.json({ run: runs.setPinned(c.req.param("projectId"), c.req.param("runId"), parsed.data.pinned) }); }
    catch (error) { return errorResponse(c, error); }
  });
  routes.get("/:projectId/runs/:runId/status", (c) => {
    try { return c.json({ run: runs.getSummary(c.req.param("projectId"), c.req.param("runId")) }); }
    catch (error) { return errorResponse(c, error); }
  });
  routes.get("/:projectId/runs/:runId", (c) => {
    try { return c.json({ run: runs.get(c.req.param("projectId"), c.req.param("runId")) }); }
    catch (error) { return errorResponse(c, error); }
  });
  routes.get("/:projectId/runs/:runId/events", (c) => {
    const after = afterValue(c.req.query("after"));
    if (after === null) return c.json({ error: { code: "INVALID_EVENT_CURSOR", message: "Event cursor is invalid" } }, 400);
    const projectId = c.req.param("projectId"); const runId = c.req.param("runId");
    try { runs.assertExists(projectId, runId); } catch (error) { return errorResponse(c, error); }
    return streamSSE(c, async (stream) => {
      const pending = new Map<number, RunEvent>();
      let delivered = after; let wake: (() => void) | undefined; let overflow = false;
      const signal = () => { wake?.(); wake = undefined; };
      const accept = (event: RunEvent) => {
        if (event.sequence <= delivered || pending.has(event.sequence)) return;
        if (pending.size >= 256) { overflow = true; signal(); return; }
        pending.set(event.sequence, event); signal();
      };
      const unsubscribe = runs.eventBus.subscribe(runId, accept);
      let aborted = false;
      stream.onAbort(() => { aborted = true; signal(); unsubscribe(); });
      try {
        let replayAfter = after;
        while (!aborted && !overflow) {
          const page = runs.events(projectId, runId, replayAfter, 128);
          for (const item of page) {
            pending.delete(item.sequence);
            if (item.sequence <= delivered) continue;
            await stream.writeSSE({ id: String(item.sequence), event: item.kind, data: JSON.stringify(item) });
            delivered = item.sequence; replayAfter = item.sequence;
          }
          if (page.length < 128) break;
        }
        while (!aborted && !overflow) {
          const next = [...pending.values()].sort((left, right) => left.sequence - right.sequence)[0];
          if (next !== undefined) {
            pending.delete(next.sequence);
            if (next.sequence <= delivered) continue;
            await stream.writeSSE({ id: String(next.sequence), event: next.kind, data: JSON.stringify(next) });
            delivered = next.sequence;
            continue;
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          const awakened = new Promise<"event">((resolve) => { wake = () => resolve("event"); });
          const heartbeat = new Promise<"heartbeat">((resolve) => { timer = setTimeout(() => resolve("heartbeat"), 15_000); });
          const reason = await Promise.race([awakened, heartbeat]);
          if (timer !== undefined) clearTimeout(timer);
          wake = undefined;
          if (reason === "heartbeat" && !aborted) await stream.write(": heartbeat\n\n");
        }
        if (overflow && !stream.aborted) stream.abort();
      } finally { unsubscribe(); }
    });
  });
  return routes;
}
