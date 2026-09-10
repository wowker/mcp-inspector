import { describe, expect, it, vi } from "vitest";
import type { AuthoringCallService } from "../authoring-call-service.js";
import type { AuthoringDraftService } from "../authoring-draft-service.js";
import type { AuthoringDraftValidator } from "../authoring-draft-validator.js";
import { createAuthoringWorkspaceRoutes } from "../authoring-workspace-routes.js";

const projectId = "00000000-0000-4000-8000-000000000901";
const draftId = "00000000-0000-4000-8000-000000000902";
const callId = "00000000-0000-4000-8000-000000000903";

describe("Authoring workspace browser routes", () => {
  it("binds list and detail operations to project and resource path identities", async () => {
    const drafts = {
      list: vi.fn().mockReturnValue({ items: [], nextCursor: null }),
      get: vi.fn().mockReturnValue({ id: draftId, projectId }),
    } as unknown as AuthoringDraftService;
    const calls = {
      list: vi.fn().mockReturnValue({ items: [], nextCursor: null }),
      get: vi.fn().mockReturnValue({ id: callId, projectId }),
    } as unknown as AuthoringCallService;
    const app = createAuthoringWorkspaceRoutes({ calls, drafts, validator: {} as AuthoringDraftValidator });

    expect((await app.request(`/${projectId}/authoring/drafts?state=ACTIVE&limit=25`)).status).toBe(200);
    expect(vi.mocked(drafts.list)).toHaveBeenCalledWith(projectId, { state: "ACTIVE", limit: 25 });
    expect((await app.request(`/${projectId}/authoring/drafts/${draftId}`)).status).toBe(200);
    expect(vi.mocked(drafts.get)).toHaveBeenCalledWith(projectId, draftId);
    expect((await app.request(`/${projectId}/authoring/calls?toolName=sum`)).status).toBe(200);
    expect(vi.mocked(calls.list)).toHaveBeenCalledWith(projectId, { toolName: "sum" });
    expect((await app.request(`/${projectId}/authoring/calls/${callId}`)).status).toBe(200);
    expect(vi.mocked(calls.get)).toHaveBeenCalledWith(projectId, callId);
  });

  it("uses path identities for mutations and returns a stable invalid-request error", async () => {
    const drafts = { replace: vi.fn().mockReturnValue({ draftId, revision: 2, definitionDigest: "a".repeat(64) }) } as unknown as AuthoringDraftService;
    const validator = { validate: vi.fn().mockReturnValue({ id: callId, projectId, draftId, draftRevision: 1 }) } as unknown as AuthoringDraftValidator;
    const app = createAuthoringWorkspaceRoutes({ calls: {} as AuthoringCallService, drafts, validator });
    const definition = { version: 1, testCases: [], suites: [], sourceAssets: [], evidence: [] };

    const response = await app.request(`/${projectId}/authoring/drafts/${draftId}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "00000000-0000-4000-8000-000000000999", draftId: callId,
        expectedRevision: 1, goal: "goal", definition, idempotencyKey: "workspace-save" }),
    });
    expect(response.status).toBe(200);
    expect(vi.mocked(drafts.replace)).toHaveBeenCalledWith(expect.objectContaining({ projectId, draftId }));

    const invalid = await app.request(`/${projectId}/authoring/drafts/${draftId}/validate`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: { code: "INVALID_AUTHORING_REQUEST", message: "Authoring request is invalid" } });
  });
});
