import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api-client.js";

const projectId = "00000000-0000-4000-8000-000000000901";
const connectionId = "00000000-0000-4000-8000-000000000902";
const itemId = "00000000-0000-4000-8000-000000000903";
const summary = { id: itemId, projectId, connectionId, toolName: "sum", kind: "request", name: "Happy path",
  description: "Regression", sourceRunId: null, createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z" };

describe("Saved item API client", () => {
  const fetchMock = vi.fn(); beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); }); afterEach(() => vi.unstubAllGlobals());
  it("lists summaries and loads or creates full Tool-scoped items", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [summary], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ item: { ...summary, payload: { a: 1 } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ item: { ...summary, payload: { a: 1 } } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = createApiClient("session");
    await expect(api.listSavedItems(projectId, connectionId, "sum")).resolves.toEqual({ items: [summary], nextCursor: null });
    await expect(api.getSavedItem(projectId, connectionId, "sum", itemId)).resolves.toEqual({ ...summary, payload: { a: 1 } });
    await api.createSavedItem(projectId, connectionId, "sum", { kind: "request", name: "Happy path", description: "Regression", payload: { a: 1 }, sourceRunId: null });
    await api.deleteSavedItem(projectId, connectionId, "sum", itemId);
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({ method: "POST",
      body: JSON.stringify({ kind: "request", name: "Happy path", description: "Regression", payload: { a: 1 }, sourceRunId: null }) }));
  });

  it("rejects foreign Tool identities and malformed request payloads", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ ...summary, toolName: "other" }], nextCursor: null }), { status: 200 }));
    await expect(createApiClient("session").listSavedItems(projectId, connectionId, "sum")).rejects.toThrow("Invalid saved item response");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ item: { ...summary, payload: [] } }), { status: 200 }));
    await expect(createApiClient("session").getSavedItem(projectId, connectionId, "sum", itemId)).rejects.toThrow("Invalid saved item response");
  });

  it("passes an opaque cursor and rejects malformed pagination metadata", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: "next_page-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: 42 }), { status: 200 }));
    const api = createApiClient("session");
    await expect(api.listSavedItems(projectId, connectionId, "sum", "first_page-1")).resolves.toEqual({ items: [], nextCursor: "next_page-1" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("?cursor=first_page-1");
    await expect(api.listSavedItems(projectId, connectionId, "sum")).rejects.toThrow("Invalid saved item response");
  });

  it("rejects a create response that changes the requested kind", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ item: { ...summary, kind: "response", payload: { a: 1 } } }), { status: 201 }));
    await expect(createApiClient("session").createSavedItem(projectId, connectionId, "sum", {
      kind: "request", name: "Happy path", description: "Regression", payload: { a: 1 }, sourceRunId: null,
    })).rejects.toThrow("Invalid saved item response");
  });
});
