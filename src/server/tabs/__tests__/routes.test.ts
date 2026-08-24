import { describe, expect, it, vi } from "vitest";
import { createTabRoutes } from "../routes.js";
import { TabNotFoundError, type TabService } from "../tab-service.js";

const projectId = "00000000-0000-4000-8000-000000000601";
const connectionId = "00000000-0000-4000-8000-000000000602";
const tabId = "00000000-0000-4000-8000-000000000603";
const record = { id: tabId, projectId, connectionId, toolName: "sum", title: "sum", position: 0,
  pinned: false, inputMode: "form" as const, arguments: {}, rawText: "{}",
  viewState: { editorScrollTop: 0, resultScrollTop: 0, splitRatio: 0.5 }, lastRunId: null };

function service(overrides: Partial<TabService> = {}): TabService {
  return { list: vi.fn(() => []), get: vi.fn(() => { throw new TabNotFoundError(); }),
    open: vi.fn(), replaceTool: vi.fn(), update: vi.fn(), duplicate: vi.fn(), reorder: vi.fn(() => []),
    close: vi.fn(), closeOthers: vi.fn(), closeRight: vi.fn(), ...overrides };
}

describe("Tab routes", () => {
  it("rejects malformed and non-strict open payloads", async () => {
    const tabs = service(); const app = createTabRoutes(tabs);
    const malformed = await app.request(`/${projectId}/tabs`, { method: "POST", body: "{" });
    const extra = await app.request(`/${projectId}/tabs`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId, toolName: "sum", extra: true }) });
    expect(malformed.status).toBe(400); expect(extra.status).toBe(400); expect(tabs.open).not.toHaveBeenCalled();
  });

  it("maps missing project-scoped Tabs without leaking details", async () => {
    const app = createTabRoutes(service());
    const response = await app.request(`/${projectId}/tabs/${tabId}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "TAB_NOT_FOUND", message: "Tab not found" } });
  });

  it("passes a complete reorder intent and returns a dense list envelope", async () => {
    const reorder = vi.fn(() => []); const app = createTabRoutes(service({ reorder }));
    const response = await app.request(`/${projectId}/tabs/reorder`, { method: "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabIds: [tabId] }) });
    expect(response.status).toBe(200); expect(reorder).toHaveBeenCalledWith(projectId, [tabId]);
    expect(await response.json()).toEqual({ tabs: [] });
  });

  it("wires project-scoped CRUD and bulk actions", async () => {
    const tabs = service({ list: vi.fn(() => [record]), get: vi.fn(() => record), open: vi.fn(() => record),
      update: vi.fn(() => record), replaceTool: vi.fn(() => record), duplicate: vi.fn(() => record),
      close: vi.fn(), closeOthers: vi.fn(), closeRight: vi.fn() });
    const app = createTabRoutes(tabs); const json = { "Content-Type": "application/json" };
    expect((await app.request(`/${projectId}/tabs`)).status).toBe(200);
    expect((await app.request(`/${projectId}/tabs/${tabId}`)).status).toBe(200);
    expect((await app.request(`/${projectId}/tabs`, { method: "POST", headers: json,
      body: JSON.stringify({ connectionId, toolName: "sum" }) })).status).toBe(201);
    expect((await app.request(`/${projectId}/tabs/${tabId}`, { method: "PATCH", headers: json,
      body: JSON.stringify({ pinned: true }) })).status).toBe(200);
    expect((await app.request(`/${projectId}/tabs/${tabId}/tool`, { method: "PUT", headers: json,
      body: JSON.stringify({ connectionId, toolName: "sum" }) })).status).toBe(200);
    expect((await app.request(`/${projectId}/tabs/${tabId}/duplicate`, { method: "POST" })).status).toBe(201);
    expect((await app.request(`/${projectId}/tabs/${tabId}`, { method: "DELETE" })).status).toBe(204);
    expect((await app.request(`/${projectId}/tabs/${tabId}/close-others`, { method: "POST" })).status).toBe(200);
    expect((await app.request(`/${projectId}/tabs/${tabId}/close-right`, { method: "POST" })).status).toBe(200);
    expect(tabs.close).toHaveBeenCalledWith(projectId, tabId);
  });
});
