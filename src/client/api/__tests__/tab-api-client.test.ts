import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api-client.js";

const projectId = "00000000-0000-4000-8000-000000000701";
const connectionId = "00000000-0000-4000-8000-000000000702";
const tabId = "00000000-0000-4000-8000-000000000703";
const tab = { id: tabId, projectId, connectionId, toolName: "sum", title: "sum", position: 0,
  pinned: false, inputMode: "form", arguments: { a: 1 }, rawText: '{"a":1}',
  viewState: { editorScrollTop: 0, resultScrollTop: 0, splitRatio: 0.5,
    requestExpanded: true, responseExpanded: true }, lastRunId: null };

describe("Tab API client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["foreign project", { ...tab, projectId: "00000000-0000-4000-8000-000000000799" }],
    ["bad connection", { ...tab, connectionId: "bad" }],
    ["empty Tool", { ...tab, toolName: "" }],
    ["whitespace Tool", { ...tab, toolName: "   " }],
    ["long Tool", { ...tab, toolName: "x".repeat(513) }],
    ["empty title", { ...tab, title: " " }],
    ["long title", { ...tab, title: "x".repeat(181) }],
    ["fraction position", { ...tab, position: 0.5 }],
    ["bad pin", { ...tab, pinned: 1 }],
    ["bad mode", { ...tab, inputMode: "text" }],
    ["array arguments", { ...tab, arguments: [] }],
    ["long Raw", { ...tab, rawText: "x".repeat(2_000_001) }],
    ["negative scroll", { ...tab, viewState: { ...tab.viewState, editorScrollTop: -1 } }],
    ["large split", { ...tab, viewState: { ...tab.viewState, splitRatio: 0.81 } }],
    ["bad request expansion", { ...tab, viewState: { ...tab.viewState, requestExpanded: "yes" } }],
    ["bad last Run", { ...tab, lastRunId: "bad" }],
  ])("rejects list response with %s", async (_label, invalid) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tabs: [invalid] }), { status: 200,
      headers: { "Content-Type": "application/json" } }));
    await expect(createApiClient("session").listTabs(projectId, connectionId)).rejects.toThrow("Invalid Tab response");
  });

  it("rejects duplicate, unordered, and malformed envelope responses while accepting legacy sparse positions", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tabs: [tab, tab] }), { status: 200 }));
    await expect(createApiClient("session").listTabs(projectId, connectionId)).rejects.toThrow("Invalid Tab response");
    const later = { ...tab, id: "00000000-0000-4000-8000-000000000704", position: 1 };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tabs: [later, tab] }), { status: 200 }));
    await expect(createApiClient("session").listTabs(projectId, connectionId)).rejects.toThrow("Invalid Tab response");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tabs: [{ ...tab, position: 4 }] }), { status: 200 }));
    await expect(createApiClient("session").listTabs(projectId, connectionId)).resolves.toEqual([{ ...tab, position: 4 }]);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tab: { ...tab, title: "" } }), { status: 200 }));
    await expect(createApiClient("session").openTab(projectId, connectionId, "sum")).rejects.toThrow("Invalid Tab response");
  });

  it("uses authenticated encoded resources for Tab mutations", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tab }), { status: 200,
      headers: { "Content-Type": "application/json" } }));
    await createApiClient("session").updateTab(projectId, tabId, { pinned: true });
    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${projectId}/tabs/${tabId}`,
      expect.objectContaining({ method: "PATCH", headers: expect.not.objectContaining({ "X-MCP-Inspector-Session": expect.anything() }),
        body: JSON.stringify({ pinned: true }) }));
  });

  it("decodes every Tab API method and envelope", async () => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
      headers: { "Content-Type": "application/json" } });
    fetchMock
      .mockResolvedValueOnce(json({ tabs: [tab] }))
      .mockResolvedValueOnce(json({ tab }, 201))
      .mockResolvedValueOnce(json({ tab }))
      .mockResolvedValueOnce(json({ tab }))
      .mockResolvedValueOnce(json({ tab }, 201))
      .mockResolvedValueOnce(json({ tabs: [tab] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ tabs: [tab] }))
      .mockResolvedValueOnce(json({ tabs: [tab] }));
    const api = createApiClient("session");
    await expect(api.listTabs(projectId, connectionId)).resolves.toEqual([tab]);
    await expect(api.openTab(projectId, connectionId, "sum")).resolves.toEqual(tab);
    await expect(api.replaceTabTool(projectId, tabId, connectionId, "sum")).resolves.toEqual(tab);
    await expect(api.updateTab(projectId, tabId, { rawText: "{}" })).resolves.toEqual(tab);
    await expect(api.duplicateTab(projectId, tabId)).resolves.toEqual(tab);
    await expect(api.reorderTabs(projectId, connectionId, [tabId])).resolves.toEqual([tab]);
    await expect(api.closeTab(projectId, tabId)).resolves.toBeUndefined();
    await expect(api.closeOtherTabs(projectId, connectionId, tabId)).resolves.toEqual([tab]);
    await expect(api.closeTabsRight(projectId, connectionId, tabId)).resolves.toEqual([tab]);
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });
});
