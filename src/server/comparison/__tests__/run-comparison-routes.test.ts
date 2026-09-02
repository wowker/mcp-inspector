import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createRunComparisonRoutes } from "../run-comparison-routes.js";

describe("run comparison routes", () => {
  it("wraps the explicit comparison state and rejects malformed identities", async () => {
    const compare = vi.fn().mockReturnValue({ comparable: false });
    const app = new Hono().route("/api/projects", createRunComparisonRoutes({ compare }));
    const projectId = "00000000-0000-4000-8000-000000001551";
    const runId = "00000000-0000-4000-8000-000000001552";
    const response = await app.request(`/api/projects/${projectId}/runs/${runId}/comparison`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ comparison: { comparable: false } });
    expect(compare).toHaveBeenCalledWith(projectId, runId);
    const invalid = await app.request(`/api/projects/${projectId}/runs/not-a-run/comparison`);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: {
      code: "RUN_COMPARISON_INVALID", message: "Run comparison request is invalid",
    } });
  });
});
