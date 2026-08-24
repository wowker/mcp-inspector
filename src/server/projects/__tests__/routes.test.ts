import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createProjectService, type ProjectService } from "../project-service.js";

describe("project routes", () => {
  let dataRoot: string;
  let projects: ProjectService;

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-routes-"));
    projects = createProjectService({ dataRoot });
  });

  afterEach(() => {
    projects.close();
    rmSync(dataRoot, { recursive: true, force: true });
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
    });
  }

  it("inherits API authentication", async () => {
    expect((await app().request("/api/projects")).status).toBe(401);
  });

  it("creates, lists, and opens a project", async () => {
    const createdResponse = await app().request("/api/projects", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: " Supplier Tools " }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { project: { id: string; name: string } };
    expect(created.project.name).toBe("Supplier Tools");

    const openedResponse = await app().request(`/api/projects/${created.project.id}/open`, {
      method: "POST",
      headers,
    });
    expect(openedResponse.status).toBe(200);
    expect((await openedResponse.json()) as unknown).toEqual({
      project: expect.objectContaining({ id: created.project.id, lastOpenedAt: expect.any(String) }),
    });

    const listResponse = await app().request("/api/projects", { headers });
    expect((await listResponse.json()) as unknown).toEqual({
      projects: [expect.objectContaining({ id: created.project.id })],
    });
  });

  it("returns stable validation and not-found errors", async () => {
    const invalid = await app().request("/api/projects", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: " " }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: { code: "INVALID_PROJECT", message: "Project name must be 1 to 120 characters" },
    });

    const arbitraryPath = await app().request("/api/projects", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Supplier Tools", databasePath: "/tmp/evil" }),
    });
    expect(arbitraryPath.status).toBe(400);

    const missing = await app().request(
      "/api/projects/00000000-0000-4000-8000-000000000000/open",
      { method: "POST", headers },
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
    });
  });

  it("returns a stable error without leaking a tampered database path", async () => {
    const created = projects.create("Supplier Tools");
    const registry = new Database(join(dataRoot, "registry.sqlite"));
    registry.prepare("UPDATE project_registry SET database_path = ? WHERE id = ?").run(
      "/sensitive/outside.sqlite",
      created.id,
    );
    registry.close();

    const response = await app().request(`/api/projects/${created.id}/open`, {
      method: "POST",
      headers,
    });
    const rawResponse = response.clone();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_PROJECT_STORAGE",
        message: "Project storage metadata is invalid",
      },
    });
    expect(await rawResponse.text()).not.toContain("/sensitive/outside.sqlite");
  });
});
