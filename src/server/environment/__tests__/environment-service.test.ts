import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { InvalidEnvironmentVariableError, createEnvironmentService } from "../environment-service.js";

describe("EnvironmentService", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-environment-"));
    roots.push(dataRoot);
    const projects = createProjectService({ dataRoot });
    const projectId = projects.create("Environment").id;
    const connectionId = "00000000-0000-4000-8000-000000000631";
    const connections = createConnectionService(projects, { createId: () => connectionId });
    connections.create(projectId, {
      name: "Environment", url: "https://example.test/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 10_000,
    });
    let id = 632;
    const service = createEnvironmentService(projects, connections, {
      createId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, "0")}`,
      now: () => new Date("2026-08-27T00:00:00.000Z"),
    });
    return { projects, projectId, connectionId, service };
  }

  it("isolates project and Server scopes and never returns secret values", () => {
    const { projects, projectId, connectionId, service } = fixture();
    try {
      expect(service.set(projectId, null, "region", { value: "global", secret: false }))
        .toMatchObject({ connectionId: null, name: "region", secret: false, value: "global" });
      expect(service.set(projectId, connectionId, "region", { value: "server", secret: false }))
        .toMatchObject({ connectionId, name: "region", value: "server" });
      const secret = service.set(projectId, connectionId, "api_key", { value: "secret-value", secret: true });
      expect(secret).toEqual(expect.objectContaining({ connectionId, name: "api_key", secret: true }));
      expect(secret).not.toHaveProperty("value");
      expect(JSON.stringify(service.list(projectId, connectionId))).not.toContain("secret-value");
      expect(service.resolve(projectId, connectionId)).toEqual({
        project: { region: "global" },
        server: { api_key: "secret-value", region: "server" },
        secretNames: ["api_key"],
      });
    } finally { projects.close(); }
  });

  it("validates a staged batch before committing it atomically", () => {
    const { projects, projectId, connectionId, service } = fixture();
    try {
      expect(() => service.commit(projectId, connectionId, [
        { scope: "project", name: "first", value: 1, secret: false },
        { scope: "server", name: " ", value: 2, secret: false },
      ])).toThrow(InvalidEnvironmentVariableError);
      expect(service.list(projectId, null)).toEqual([]);
      service.commit(projectId, connectionId, [
        { scope: "project", name: "first", value: 1, secret: false },
        { scope: "server", name: "second", value: { ok: true }, secret: true },
      ]);
      expect(service.resolve(projectId, connectionId)).toMatchObject({
        project: { first: 1 }, server: { second: { ok: true } }, secretNames: ["second"],
      });
      service.delete(projectId, null, "first");
      expect(service.list(projectId, null)).toEqual([]);
    } finally { projects.close(); }
  });
});
