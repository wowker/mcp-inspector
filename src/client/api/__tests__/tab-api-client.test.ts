import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api-client.js";

const projectId = "00000000-0000-4000-8000-000000000701";
const connectionId = "00000000-0000-4000-8000-000000000702";
const tabId = "00000000-0000-4000-8000-000000000703";
const tab = { id: tabId, projectId, connectionId, toolName: "sum", title: "sum", position: 0,
  pinned: false, inputMode: "form", arguments: { a: 1 }, rawText: '{"a":1}',
  viewState: { editorScrollTop: 0, resultScrollTop: 0, splitRatio: 0.5 }, lastRunId: null };

describe("Tab API client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["foreign project", { ...tab, projectId: "00000000-0000-4000-8000-000000000799" }],
    ["bad connection", { ...tab, connectionId: "bad" }],
    ["empty Tool", { ...tab, toolName: "" }],
    ["empty title", { ...tab, title: " " }],
    ["long title", { ...tab, title: "x".repeat(181) }],
    ["fraction position", { ...tab, position: 0.5 }],
    ["bad pin", { ...tab, pinned: 1 }],
    ["bad mode", { ...tab, inputMode: "text" }],
    ["array arguments", { ...tab, arguments: [] }],
    ["long Raw", { ...tab, rawText: "x".repeat(2_000_001) }],
    ["negative scroll", { ...tab, viewState: { ...tab.viewState, editorScrollTop: -1 } }],
    ["large split", { ...tab, viewState: { ...tab.viewState, splitRatio: 0.81 } }],
    ["bad last Run", { ...tab, lastRunId: "bad" }],
  ])("rejects list response with %s", async (_label, invalid) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tabs: [invalid] }), { status: 200,
      headers: { "Content-Type": "application/json" } }));
    await expect(createApiClient("session").listTabs(projectId)).rejects.toThrow("Invalid Tab response");
  });

  it("rejects duplicate, sparse, and malformed envelope responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tabs: [tab, tab] }), { status: 200 }));
    await expect(createApiClient("session").listTabs(projectId)).rejects.toThrow("Invalid Tab response");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tabs: [{ ...tab, position: 1 }] }), { status: 200 }));
    await expect(createApiClient("session").listTabs(projectId)).rejects.toThrow("Invalid Tab response");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tab: { ...tab, title: "" } }), { status: 200 }));
    await expect(createApiClient("session").openTab(projectId, connectionId, "sum")).rejects.toThrow("Invalid Tab response");
  });

  it("uses authenticated encoded resources for Tab mutations", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tab }), { status: 200,
      headers: { "Content-Type": "application/json" } }));
    await createApiClient("session").updateTab(projectId, tabId, { pinned: true });
    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${projectId}/tabs/${tabId}`,
      expect.objectContaining({ method: "PATCH", headers: expect.objectContaining({ "X-DSers-Inspector-Session": "session" }),
        body: JSON.stringify({ pinned: true }) }));
  });
});
