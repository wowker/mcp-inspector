import { describe, expect, it, vi } from "vitest";
import { createSavedItemRoutes } from "../routes.js";
import { SavedItemNotFoundError, type SavedItemService } from "../saved-item-service.js";

const projectId = "00000000-0000-4000-8000-000000000901";
const connectionId = "00000000-0000-4000-8000-000000000902";
const itemId = "00000000-0000-4000-8000-000000000903";
const item = { id: itemId, projectId, connectionId, toolName: "sum", kind: "request" as const,
  name: "Happy path", description: "Regression", payload: { a: 1 }, sourceRunId: null,
  createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z" };

function service(overrides: Partial<SavedItemService> = {}): SavedItemService {
  return { list: vi.fn(() => ({ items: [], nextCursor: null })), get: vi.fn(() => { throw new SavedItemNotFoundError(); }),
    create: vi.fn(() => item), remove: vi.fn(), ...overrides };
}

describe("Saved item routes", () => {
  it("wires Tool-scoped list, detail, create, and delete", async () => {
    const saved = service({ list: vi.fn(() => ({ items: [{ ...item, payload: undefined }], nextCursor: null })), get: vi.fn(() => item) });
    const app = createSavedItemRoutes(saved); const base = `/${projectId}/connections/${connectionId}/tools/sum/saved-items`;
    expect((await app.request(base)).status).toBe(200);
    expect((await app.request(`${base}/${itemId}`)).status).toBe(200);
    expect((await app.request(base, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "request", name: "Happy path", description: "Regression", payload: { a: 1 }, sourceRunId: null }) })).status).toBe(201);
    expect((await app.request(`${base}/${itemId}`, { method: "DELETE" })).status).toBe(204);
    expect(saved.list).toHaveBeenCalledWith(projectId, connectionId, "sum", undefined);
  });

  it("rejects malformed payloads and maps missing items", async () => {
    const saved = service(); const app = createSavedItemRoutes(saved); const base = `/${projectId}/connections/${connectionId}/tools/sum/saved-items`;
    expect((await app.request(base, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "request", name: "x", description: "", payload: {}, extra: true }) })).status).toBe(400);
    const missing = await app.request(`${base}/${itemId}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: "SAVED_ITEM_NOT_FOUND", message: "Saved item not found" } });
  });
});
