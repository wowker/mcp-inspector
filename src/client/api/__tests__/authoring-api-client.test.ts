import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api-client.js";

const projectId = "00000000-0000-4000-8000-000000000811";
const draftId = "00000000-0000-4000-8000-000000000812";
const now = "2026-09-10T00:00:00.000Z";

describe("Authoring workspace API decoding", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("decodes installation settings with the runtime endpoint", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ settings: {
      enabled: true, configured: true, tokenHint: "author…", tokenCreatedAt: now,
      tokenRotatedAt: null, updatedAt: now,
    }, endpoint: "http://127.0.0.1:8500/mcp/authoring" }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(createApiClient("session").getAuthoringSettings()).resolves.toMatchObject({
      settings: { enabled: true }, endpoint: "http://127.0.0.1:8500/mcp/authoring",
    });
  });

  it("rejects a foreign-project Draft before it reaches the UI", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [{ id: draftId,
      projectId: "00000000-0000-4000-8000-000000000899", revision: 1, state: "ACTIVE", goal: "goal",
      testCaseCount: 0, suiteCount: 0, createdAt: now, updatedAt: now }], nextCursor: null }),
    { status: 200, headers: { "content-type": "application/json" } }));

    await expect(createApiClient("session").listAuthoringDrafts(projectId))
      .rejects.toThrow("Invalid Authoring Draft response");
  });

  it("sends the exact expected revision when replacing a Draft", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: {
      draftId, revision: 2, definitionDigest: "a".repeat(64),
    } }), { status: 200, headers: { "content-type": "application/json" } }));
    const definition = { version: 1 as const, testCases: [], suites: [], sourceAssets: [], evidence: [] };

    await createApiClient("session").replaceAuthoringDraft(projectId, draftId, {
      expectedRevision: 1, goal: "goal", definition, idempotencyKey: "save-one",
    });

    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${projectId}/authoring/drafts/${draftId}`,
      expect.objectContaining({ method: "PUT", body: JSON.stringify({
        expectedRevision: 1, goal: "goal", definition, idempotencyKey: "save-one",
      }) }));
  });
});
