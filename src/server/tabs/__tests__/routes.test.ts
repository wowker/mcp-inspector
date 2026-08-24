import { describe, expect, it, vi } from "vitest";
import { createTabRoutes } from "../routes.js";
import { TabNotFoundError, type TabService } from "../tab-service.js";

const projectId = "00000000-0000-4000-8000-000000000601";
const connectionId = "00000000-0000-4000-8000-000000000602";
const tabId = "00000000-0000-4000-8000-000000000603";

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
});
