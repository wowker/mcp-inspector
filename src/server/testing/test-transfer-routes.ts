import { Hono } from "hono";
import { InvalidProjectStorageError, ProjectNotFoundError } from "../projects/project-service.js";
import type { TestTransferService } from "./test-transfer-service.js";
import { InvalidTestTransferError } from "./test-transfer-service.js";

const invalid = { error: { code: "TEST_TRANSFER_INVALID", message: "Automated test import is invalid" } } as const;
const projectNotFound = { error: { code: "PROJECT_NOT_FOUND", message: "Project not found" } } as const;
const invalidStorage = { error: { code: "INVALID_PROJECT_STORAGE", message: "Project storage metadata is invalid" } } as const;

function mappedError(error: unknown) {
  if (error instanceof InvalidTestTransferError) return { body: invalid, status: 400 as const };
  if (error instanceof ProjectNotFoundError) return { body: projectNotFound, status: 404 as const };
  if (error instanceof InvalidProjectStorageError) return { body: invalidStorage, status: 409 as const };
  throw error;
}

export function createTestTransferRoutes(transfers: TestTransferService): Hono {
  const routes = new Hono();
  routes.get("/:projectId/automated-tests/export", (context) => {
    try { return context.json(transfers.exportProject(context.req.param("projectId"))); }
    catch (error) {
      const mapped = mappedError(error); return context.json(mapped.body, mapped.status);
    }
  });
  routes.post("/:projectId/automated-tests/import", async (context) => {
    let body: unknown;
    try { body = await context.req.json(); } catch { body = undefined; }
    try { return context.json(transfers.importProject(context.req.param("projectId"), body)); }
    catch (error) {
      const mapped = mappedError(error); return context.json(mapped.body, mapped.status);
    }
  });
  return routes;
}
