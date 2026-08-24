import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { createProjectService, type ProjectService } from "../../projects/project-service.js";
import { createConnectionService } from "../connection-service.js";

describe("connection routes", () => {
  let dataRoot: string;
  let projects: ProjectService;

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-connection-routes-"));
    projects = createProjectService({ dataRoot });
  });

  afterEach(() => {
    projects.close();
    rmSync(dataRoot, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  const headers = {
    Origin: "http://127.0.0.1:5173",
    "X-DSers-Inspector-Session": "test-session",
    "Content-Type": "application/json",
  };

  function app() {
    return createApp({
      sessionToken: "test-session",
      allowedOrigin: "http://127.0.0.1:5173",
      version: "0.1.0",
      projects,
      connections: createConnectionService(projects, {
        createId: () => "00000000-0000-4000-8000-000000000301",
      }),
    });
  }

  it("creates and lists a disconnected configuration without network access", async () => {
    const project = projects.create("Supplier Tools");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const createdResponse = await app().request(`/api/projects/${project.id}/connections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: " Catalog MCP ",
        url: "https://mcp.example.test/mcp?region=eu",
        transport: "streamable-http",
        authMode: "none",
        timeoutMs: 10_000,
      }),
    });

    expect(createdResponse.status).toBe(201);
    expect(await createdResponse.json()).toEqual({
      connection: expect.objectContaining({
        name: "Catalog MCP",
        status: "disconnected",
        url: "https://mcp.example.test/mcp?region=eu",
      }),
    });
    const listResponse = await app().request(`/api/projects/${project.id}/connections`, { headers });
    expect(await listResponse.json()).toEqual({
      connections: [expect.objectContaining({ status: "disconnected" })],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("inherits API authentication and returns stable validation errors", async () => {
    const project = projects.create("Supplier Tools");
    expect((await app().request(`/api/projects/${project.id}/connections`)).status).toBe(401);

    const invalid = await app().request(`/api/projects/${project.id}/connections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Catalog MCP",
        url: "file:///tmp/server",
        transport: "streamable-http",
        authMode: "none",
        timeoutMs: 10_000,
      }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: { code: "INVALID_CONNECTION", message: "Connection configuration is invalid" },
    });

    const withSecret = await app().request(`/api/projects/${project.id}/connections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Catalog MCP",
        url: "https://mcp.example.test/mcp",
        transport: "streamable-http",
        authMode: "none",
        timeoutMs: 10_000,
        authorization: "Bearer secret",
      }),
    });
    expect(withSecret.status).toBe(400);
  });

  it("returns not found for unknown projects and project-scoped connection IDs", async () => {
    const firstProject = projects.create("First");
    const secondProject = projects.create("Second");
    const connectionId = "00000000-0000-4000-8000-000000000301";
    await app().request(`/api/projects/${firstProject.id}/connections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Catalog MCP",
        url: "https://mcp.example.test/mcp",
        transport: "streamable-http",
        authMode: "none",
        timeoutMs: 10_000,
      }),
    });

    const crossProject = await app().request(
      `/api/projects/${secondProject.id}/connections/${connectionId}`,
      { method: "DELETE", headers },
    );
    expect(crossProject.status).toBe(404);
    expect(await crossProject.json()).toEqual({
      error: { code: "CONNECTION_NOT_FOUND", message: "Connection not found" },
    });

    const missingProject = await app().request(
      "/api/projects/00000000-0000-4000-8000-000000000099/connections",
      { headers },
    );
    expect(missingProject.status).toBe(404);
    expect(await missingProject.json()).toEqual({
      error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
    });
  });

  it("deletes a connection only after an explicit DELETE request", async () => {
    const project = projects.create("Supplier Tools");
    await app().request(`/api/projects/${project.id}/connections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Catalog MCP",
        url: "https://mcp.example.test/mcp",
        transport: "streamable-http",
        authMode: "none",
        timeoutMs: 10_000,
      }),
    });
    const deleted = await app().request(
      `/api/projects/${project.id}/connections/00000000-0000-4000-8000-000000000301`,
      { method: "DELETE", headers },
    );
    expect(deleted.status).toBe(204);
    await expect((await app().request(`/api/projects/${project.id}/connections`, { headers })).json())
      .resolves.toEqual({ connections: [] });
  });

  it("preserves the stable project-storage error when database ownership is corrupted", async () => {
    const project = projects.create("Supplier Tools");
    projects.open(project.id).database
      .prepare("UPDATE projects SET id = ? WHERE id = ?")
      .run("00000000-0000-4000-8000-000000000399", project.id);

    const response = await app().request(`/api/projects/${project.id}/connections`, { headers });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_PROJECT_STORAGE",
        message: "Project storage metadata is invalid",
      },
    });
  });
});
