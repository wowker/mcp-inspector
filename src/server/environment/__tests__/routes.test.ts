import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";

describe("environment routes", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it("keeps project and Server variables scoped and redacts secrets", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-environment-routes-"));
    roots.push(dataRoot);
    const projects = createProjectService({ dataRoot });
    const projectId = projects.create("Environment").id;
    const connectionId = "00000000-0000-4000-8000-000000000641";
    const connections = createConnectionService(projects, { createId: () => connectionId });
    connections.create(projectId, {
      name: "Environment", url: "https://example.test/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 10_000,
    });
    const app = createApp({ sessionToken: "session", allowedOrigin: "http://127.0.0.1:5173", version: "1", projects, connections });
    const headers = { Origin: "http://127.0.0.1:5173", "X-MCP-Inspector-Session": "session" };
    const projectUrl = `/api/projects/${projectId}/variables/region`;
    const serverUrl = `/api/projects/${projectId}/connections/${connectionId}/variables/api_key`;
    try {
      expect((await app.request(projectUrl, { method: "PUT", headers,
        body: JSON.stringify({ value: "us", secret: false }) })).status).toBe(200);
      expect((await app.request(serverUrl, { method: "PUT", headers,
        body: JSON.stringify({ value: "do-not-return", secret: true }) })).status).toBe(200);
      const projectList = await (await app.request(`/api/projects/${projectId}/variables`, { headers })).json();
      const serverList = await (await app.request(`/api/projects/${projectId}/connections/${connectionId}/variables`, { headers })).json();
      expect(projectList).toEqual({ variables: [expect.objectContaining({ name: "region", value: "us", secret: false })] });
      expect(serverList).toEqual({ variables: [expect.objectContaining({ name: "api_key", secret: true })] });
      expect(JSON.stringify(serverList)).not.toContain("do-not-return");
      expect((await app.request(serverUrl, { method: "DELETE", headers })).status).toBe(204);
      expect((await app.request(serverUrl, { method: "DELETE", headers })).status).toBe(404);
    } finally { projects.close(); }
  });

  it("manages profiles, activates them per connection and never returns secret preview values", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-environment-profile-routes-"));
    roots.push(dataRoot);
    const projects = createProjectService({ dataRoot });
    const projectId = projects.create("Profile routes").id;
    const connectionId = "00000000-0000-4000-8000-000000000642";
    const connections = createConnectionService(projects, { createId: () => connectionId });
    connections.create(projectId, {
      name: "Profile routes", url: "https://example.test/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 10_000,
    });
    const app = createApp({ sessionToken: "session", allowedOrigin: "http://127.0.0.1:5173", version: "1", projects, connections });
    const headers = { Origin: "http://127.0.0.1:5173", "X-MCP-Inspector-Session": "session", "Content-Type": "application/json" };
    try {
      const created = await app.request(`/api/projects/${projectId}/environment-profiles`, {
        method: "POST", headers,
        body: JSON.stringify({ name: "staging", description: "", parentProfileId: null }),
      });
      expect(created.status).toBe(201);
      const profile = (await created.json() as { profile: { id: string } }).profile;
      expect((await app.request(
        `/api/projects/${projectId}/environment-profiles/${profile.id}/variables/REGION`,
        { method: "PUT", headers, body: JSON.stringify({ mode: "value", value: "staging", secret: false }) },
      )).status).toBe(200);
      expect((await app.request(
        `/api/projects/${projectId}/environment-profiles/${profile.id}/connections/${connectionId}/variables/TOKEN`,
        { method: "PUT", headers, body: JSON.stringify({ mode: "value", value: "never-return", secret: true }) },
      )).status).toBe(200);

      const activated = await app.request(
        `/api/projects/${projectId}/connections/${connectionId}/environment-profile`,
        { method: "PUT", headers, body: JSON.stringify({ profileId: profile.id }) },
      );
      expect(activated.status).toBe(200);
      const payload = await activated.json() as { profileId: string; preview: unknown };
      expect(payload.profileId).toBe(profile.id);
      expect(JSON.stringify(payload)).not.toContain("never-return");
      expect(payload.preview).toEqual(expect.objectContaining({
        profileId: profile.id,
        variables: expect.arrayContaining([
          expect.objectContaining({ name: "REGION", value: "staging" }),
          expect.objectContaining({ name: "TOKEN", secret: true }),
        ]),
      }));
      expect((await app.request(
        `/api/projects/${projectId}/environment-profiles/${profile.id}`,
        { method: "DELETE", headers },
      )).status).toBe(409);
    } finally { projects.close(); }
  });
});
