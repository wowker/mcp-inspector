import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api-client.js";

const projectId = "00000000-0000-4000-8000-000000000651";
const connectionId = "00000000-0000-4000-8000-000000000652";

describe("environment API client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the correct scope URLs and strictly decodes redacted secrets", async () => {
    const secret = {
      id: "00000000-0000-4000-8000-000000000653", projectId, connectionId,
      name: "api_key", secret: true,
      createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z",
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ variables: [secret] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    const client = createApiClient("session");
    await expect(client.listEnvironmentVariables(projectId, connectionId)).resolves.toEqual([secret]);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining(`/connections/${connectionId}/variables`), expect.anything());

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ variable: secret }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await client.setEnvironmentVariable(projectId, connectionId, "api_key", { value: "new", secret: true });
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("/variables/api_key"), expect.objectContaining({ method: "PUT" }));
  });

  it("rejects a secret response that discloses its value", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ variables: [{
      id: "00000000-0000-4000-8000-000000000653", projectId, connectionId: null,
      name: "api_key", secret: true, value: "leak",
      createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z",
    }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(createApiClient("session").listEnvironmentVariables(projectId, null))
      .rejects.toThrow("Invalid environment response");
  });

  it("decodes profile activation previews and rejects disclosed profile secrets", async () => {
    const profileId = "00000000-0000-4000-8000-000000000654";
    const profile = {
      id: profileId, projectId, name: "staging", description: "", parentProfileId: null,
      revision: 1, createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z",
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ profiles: [profile] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    const client = createApiClient("session");
    await expect(client.listEnvironmentProfiles(projectId)).resolves.toEqual([profile]);

    const safePreview = {
      profileId, chain: [profile], references: [], variables: [{
        name: "TOKEN", scope: "server", secret: true, source: "profile", sourceProfileId: profileId,
      }],
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ profileId, preview: safePreview }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await expect(client.setConnectionEnvironmentProfile(projectId, connectionId, profileId))
      .resolves.toEqual({ profileId, preview: safePreview });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      preview: { ...safePreview, variables: [{ ...safePreview.variables[0], value: "leak" }] },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(client.previewConnectionEnvironmentProfile(projectId, connectionId, profileId))
      .rejects.toThrow("Invalid environment profile response");
  });
});
