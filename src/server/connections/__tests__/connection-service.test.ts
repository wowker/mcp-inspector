import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService, type ProjectService } from "../../projects/project-service.js";
import { createConnectionService } from "../connection-service.js";

describe("ConnectionService", () => {
  const dataRoots: string[] = [];
  let projects: ProjectService | undefined;

  afterEach(() => {
    projects?.close();
    projects = undefined;
    for (const dataRoot of dataRoots.splice(0)) {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it("persists a disconnected Streamable HTTP connection and rejects non-HTTP URLs", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const project = projects.create("Supplier Tools");
    const service = createConnectionService(projects, {
      createId: () => "00000000-0000-4000-8000-000000000201",
      now: () => new Date("2026-08-17T10:00:00.000Z"),
    });

    const connection = service.create(project.id, {
      name: "Catalog MCP",
      url: "https://mcp.example.test/mcp",
      transport: "streamable-http",
      authMode: "none",
      timeoutMs: 10_000,
    });

    expect(service.list(project.id)).toEqual([connection]);
    expect(connection).toEqual(expect.objectContaining({
      projectId: project.id,
      name: "Catalog MCP",
      status: "disconnected",
    }));
    expect(() => service.create(project.id, {
      name: "Local process",
      url: "file:///tmp/server",
      transport: "streamable-http",
      authMode: "none",
      timeoutMs: 10_000,
    })).toThrow(/http or https/i);
  });

  it("normalizes bounded configuration input and rejects unsupported or secret-bearing values", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const project = projects.create("Supplier Tools");
    const service = createConnectionService(projects, {
      createId: () => "00000000-0000-4000-8000-000000000202",
    });
    const valid = {
      name: " Catalog MCP ",
      url: " https://mcp.example.test:443/tools/list?cursor=a%2Fb ",
      transport: "streamable-http" as const,
      authMode: "none" as const,
      timeoutMs: 600_000,
    };

    expect(service.create(project.id, valid)).toEqual(expect.objectContaining({
      name: "Catalog MCP",
      url: "https://mcp.example.test/tools/list?cursor=a%2Fb",
      timeoutMs: 600_000,
    }));
    expect(() => service.create(project.id, { ...valid, name: " " })).toThrow(/invalid/i);
    expect(() => service.create(project.id, { ...valid, timeoutMs: 99 })).toThrow(/invalid/i);
    expect(() => service.create(project.id, { ...valid, timeoutMs: 100.5 })).toThrow(/invalid/i);
    expect(() => service.create(project.id, {
      ...valid,
      url: "https://user:password@mcp.example.test/mcp",
    })).toThrow(/credentials/i);
    expect(() => service.create(project.id, {
      ...valid,
      transport: "sse" as "streamable-http",
    })).toThrow(/invalid/i);
    expect(() => service.create(project.id, {
      ...valid,
      authMode: "oauth" as "none",
    })).toThrow(/invalid/i);
    expect(() => service.create(project.id, {
      ...valid,
      bearerToken: "must-not-enter-the-model",
    } as typeof valid)).toThrow(/invalid/i);
  });

  it("survives closing and reopening the project store", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const project = projects.create("Supplier Tools");
    const service = createConnectionService(projects, {
      createId: () => "00000000-0000-4000-8000-000000000203",
    });
    const created = service.create(project.id, {
      name: "Catalog MCP",
      url: "https://mcp.example.test/mcp",
      transport: "streamable-http",
      authMode: "none",
      timeoutMs: 10_000,
    });
    projects.close();

    projects = createProjectService({ dataRoot });
    expect(createConnectionService(projects).list(project.id)).toEqual([created]);
  });

  it("deletes only from the owning project and rejects unknown IDs", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const firstProject = projects.create("First");
    const secondProject = projects.create("Second");
    const sharedId = "00000000-0000-4000-8000-000000000204";
    const service = createConnectionService(projects, { createId: () => sharedId });
    const input = {
      name: "Catalog MCP",
      url: "https://mcp.example.test/mcp",
      transport: "streamable-http" as const,
      authMode: "none" as const,
      timeoutMs: 10_000,
    };
    service.create(firstProject.id, input);
    service.create(secondProject.id, input);

    service.delete(firstProject.id, sharedId);
    expect(service.list(firstProject.id)).toEqual([]);
    expect(service.list(secondProject.id)).toHaveLength(1);
    expect(() => service.delete(firstProject.id, sharedId)).toThrow(/not found/i);
    expect(() => service.delete(secondProject.id, "not-a-uuid")).toThrow(/not found/i);
  });

  it("decodes malformed observation JSON defensively", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const project = projects.create("Supplier Tools");
    const id = "00000000-0000-4000-8000-000000000205";
    const service = createConnectionService(projects, { createId: () => id });
    service.create(project.id, {
      name: "Catalog MCP",
      url: "https://mcp.example.test/mcp",
      transport: "streamable-http",
      authMode: "none",
      timeoutMs: 10_000,
    });
    projects.open(project.id).database.prepare(`
      UPDATE connections
      SET last_server_info_json = ?, last_error_json = ?
      WHERE id = ?
    `).run("not-json", JSON.stringify({ code: 42, message: "bad shape" }), id);

    expect(service.list(project.id)[0]).toEqual(expect.objectContaining({
      lastServerInfo: null,
      lastError: null,
    }));
  });
});
