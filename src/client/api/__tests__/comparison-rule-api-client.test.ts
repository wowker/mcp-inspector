import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api-client.js";

const projectId = "00000000-0000-4000-8000-000000001521";
const rule = {
  id: "00000000-0000-4000-8000-000000001522",
  projectId,
  expression: '$["requestId"]',
  position: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

describe("comparison rule API client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("loads and atomically replaces the complete ordered rule set", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ rules: [rule] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ rules: [rule] }), { status: 200 }));
    const api = createApiClient("session");
    await expect(api.listComparisonRules(projectId)).resolves.toEqual({ rules: [rule] });
    await expect(api.replaceComparisonRules(projectId, ["$.requestId"])).resolves.toEqual({ rules: [rule] });
    expect(fetchMock.mock.calls[1]).toEqual([
      `/api/projects/${projectId}/comparison-rules`,
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ expressions: ["$.requestId"] }) }),
    ]);
  });

  it("rejects foreign, duplicate-position, or malformed responses", async () => {
    const api = createApiClient("session");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ rules: [
      { ...rule, projectId: "00000000-0000-4000-8000-000000001599" },
    ] }), { status: 200 }));
    await expect(api.listComparisonRules(projectId)).rejects.toThrow("Invalid comparison rules response");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ rules: [{ ...rule, position: 1 }] }), { status: 200 }));
    await expect(api.listComparisonRules(projectId)).rejects.toThrow("Invalid comparison rules response");
  });

  it("loads a comparison and previews transient rules without persisting them", async () => {
    const comparison = {
      projectId, replayRunId: "00000000-0000-4000-8000-000000001523",
      sourceRunId: null, comparable: false, unavailableReason: "NOT_DIRECT_REPLAY",
      source: null, replay: null, ruleExpressions: [], diff: null,
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ comparison }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ comparison: {
        ...comparison, ruleExpressions: ['$["requestId"]'],
      } }), { status: 200 }));
    const api = createApiClient("session");
    await expect(api.getRunComparison(projectId, comparison.replayRunId)).resolves.toEqual(comparison);
    await expect(api.getRunComparison(projectId, comparison.replayRunId, ["$.requestId"]))
      .resolves.toEqual({ ...comparison, ruleExpressions: ['$["requestId"]'] });
    expect(fetchMock.mock.calls[1]).toEqual([
      `/api/projects/${projectId}/runs/${comparison.replayRunId}/comparison/preview`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ expressions: ["$.requestId"] }) }),
    ]);
  });
});
