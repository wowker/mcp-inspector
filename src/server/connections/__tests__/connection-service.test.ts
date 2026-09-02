import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService, type ProjectService } from "../../projects/project-service.js";
import { createConnectionService } from "../connection-service.js";
import { FakeMcpSession } from "../../../../test-support/fake-mcp-session.js";
import { OAuthAuthorizationCompletedError } from "../connection-runtime.js";

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

  it("returns an OAuth authorization-only attempt as disconnected instead of failed", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const project = projects.create("OAuth authorization only");
    const service = createConnectionService(projects, {
      createId: () => "00000000-0000-4000-8000-000000000222",
      sessionFactory: async () => { throw new OAuthAuthorizationCompletedError(); },
    });
    const connection = service.create(project.id, {
      name: "OAuth MCP", url: "https://mcp.example.test/mcp", transport: "streamable-http",
      authMode: "oauth", timeoutMs: 10_000,
    });

    await expect(service.connect(project.id, connection.id)).resolves.toEqual(expect.objectContaining({
      status: "disconnected",
      lastError: null,
    }));
    expect(service.get(project.id, connection.id).status).toBe("disconnected");
  });

  it("persists a disconnected Streamable HTTP connection and rejects non-HTTP URLs", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
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
      redactSensitiveInfo: true,
    }));
    expect(() => service.create(project.id, {
      name: "Local process",
      url: "file:///tmp/server",
      transport: "streamable-http",
      authMode: "none",
      timeoutMs: 10_000,
    })).toThrow(/http or https/i);
  });

  it("defaults sensitive information redaction on and persists an explicit opt-out", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const project = projects.create("Sensitive trace settings");
    const service = createConnectionService(projects, {
      createId: () => "00000000-0000-4000-8000-000000000221",
    });
    const created = service.create(project.id, {
      name: "Private MCP", url: "https://mcp.example.test/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 10_000,
    });

    expect(created.redactSensitiveInfo).toBe(true);
    await expect(service.update(project.id, created.id, { redactSensitiveInfo: false }))
      .resolves.toEqual(expect.objectContaining({ redactSensitiveInfo: false }));

    projects.close();
    projects = createProjectService({ dataRoot });
    expect(createConnectionService(projects).list(project.id)[0]?.redactSensitiveInfo).toBe(false);
  });

  it("persists validated custom headers, supplies them to the runtime, and replaces them on edit", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const project = projects.create("Header authenticated Tools");
    const resolvedHeaders: Array<Record<string, string>> = [];
    const service = createConnectionService(projects, {
      createId: () => "00000000-0000-4000-8000-000000000220",
      sessionFactory: async (configuration) => {
        resolvedHeaders.push(configuration.headers);
        return new FakeMcpSession();
      },
    });

    const created = service.create(project.id, {
      name: "Private MCP", url: "https://mcp.example.test/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 10_000,
      headers: { Authorization: "Bearer local-secret", "X-Tenant": "supplier-eu" },
    });
    expect(created.headers).toEqual({ Authorization: "Bearer local-secret", "X-Tenant": "supplier-eu" });
    await service.connect(project.id, created.id);
    expect(resolvedHeaders).toEqual([{ Authorization: "Bearer local-secret", "X-Tenant": "supplier-eu" }]);

    const updated = await service.update(project.id, created.id, {
      headers: { "X-API-Key": "replacement-secret" },
    });
    expect(updated.headers).toEqual({ "X-API-Key": "replacement-secret" });
    projects.close();
    projects = createProjectService({ dataRoot });
    expect(createConnectionService(projects).list(project.id)[0]?.headers)
      .toEqual({ "X-API-Key": "replacement-secret" });
  });

  it.each([
    [{ "Bad Header": "value" }, "invalid header name"],
    [{ "X-Test": "value\r\ninjected: true" }, "header injection"],
    [{ Host: "malicious.example" }, "protocol controlled header"],
  ])("rejects unsafe custom headers: %s", (headers, _description) => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const project = projects.create("Unsafe Headers");
    const service = createConnectionService(projects);
    expect(() => service.create(project.id, {
      name: "Unsafe", url: "https://mcp.example.test/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 10_000, headers,
    })).toThrow(/invalid/i);
  });

  it("rejects a custom Authorization header when OAuth owns authorization", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const project = projects.create("OAuth Headers");
    const service = createConnectionService(projects);
    expect(() => service.create(project.id, {
      name: "OAuth", url: "https://mcp.example.test/mcp", transport: "streamable-http",
      authMode: "oauth", timeoutMs: 10_000, headers: { Authorization: "Bearer conflicting" },
    })).toThrow(/invalid/i);
  });

  it("persists Bearer authentication, requires a token, and clears it when authentication changes", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const project = projects.create("Bearer authenticated Tools");
    const service = createConnectionService(projects, {
      createId: () => "00000000-0000-4000-8000-000000000223",
    });

    expect(() => service.create(project.id, {
      name: "Missing token", url: "https://mcp.example.test/mcp", transport: "streamable-http",
      authMode: "bearer", timeoutMs: 10_000,
    })).toThrow(/invalid/i);
    expect(() => service.create(project.id, {
      name: "Conflicting token", url: "https://mcp.example.test/mcp", transport: "streamable-http",
      authMode: "bearer", bearerToken: "secret-token", timeoutMs: 10_000,
      headers: { Authorization: "Bearer conflicting", "X-Tenant": "supplier-eu" },
    })).toThrow(/invalid/i);

    const created = service.create(project.id, {
      name: "Bearer MCP", url: "https://mcp.example.test/mcp", transport: "streamable-http",
      authMode: "bearer", bearerToken: "secret-token", timeoutMs: 10_000,
      headers: { "X-Tenant": "supplier-eu" },
    });
    expect(created).toEqual(expect.objectContaining({
      authMode: "bearer", bearerToken: "secret-token", authorizationStatus: "not-required",
      headers: { "X-Tenant": "supplier-eu" },
    }));

    projects.close();
    projects = createProjectService({ dataRoot });
    const reloadedService = createConnectionService(projects);
    expect(reloadedService.list(project.id)[0]).toEqual(expect.objectContaining({
      authMode: "bearer", bearerToken: "secret-token",
    }));
    await expect(reloadedService.update(project.id, created.id, { authMode: "none" }))
      .resolves.toEqual(expect.objectContaining({ authMode: "none", bearerToken: null }));
  });

  it("normalizes bounded configuration input and rejects unsupported or secret-bearing values", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
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
      authMode: "oauth" as const,
      timeoutMs: 600_000,
    };

    expect(service.create(project.id, valid)).toEqual(expect.objectContaining({
      name: "Catalog MCP",
      url: "https://mcp.example.test/tools/list?cursor=a%2Fb",
      timeoutMs: 600_000,
      authMode: "oauth",
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
      url: "https://mcp.example.test/mcp?access_token=do-not-store&cursor=next",
    })).toThrow(/query parameter/i);
    for (const name of ["auth", "key", "sig", "access_key", "tenantCredential"]) {
      expect(() => service.create(project.id, {
        ...valid,
        url: `https://mcp.example.test/mcp?${name}=do-not-store`,
      })).toThrow(/query parameter/i);
    }
    expect(() => service.create(project.id, {
      ...valid,
      url: "https://mcp.example.test/mcp#api_key=do-not-store",
    })).toThrow(/fragment/i);
    expect(() => service.create(project.id, {
      ...valid,
      transport: "sse" as "streamable-http",
    })).toThrow(/invalid/i);
    expect(() => service.create(project.id, {
      ...valid,
      bearerToken: "must-not-enter-the-model",
    } as typeof valid)).toThrow(/invalid/i);
  });

  it("updates a failed configuration, clears stale diagnostics, and leaves it disconnected", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const project = projects.create("Supplier Tools");
    const connectionId = "00000000-0000-4000-8000-000000000209";
    const service = createConnectionService(projects, {
      createId: () => connectionId,
      now: () => new Date("2026-08-17T10:00:00.000Z"),
      sessionFactory: async () => { throw new Error("unreachable"); },
    });
    service.create(project.id, {
      name: "Broken MCP", url: "http://127.0.0.1:1/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 100,
    });
    await expect(service.connect(project.id, connectionId)).rejects.toThrow(/connect/i);
    expect(service.list(project.id)[0]?.lastError).not.toBeNull();

    const updated = await service.update(project.id, connectionId, {
      name: " Fixed MCP ", url: " https://mcp.example.test:443/mcp ", authMode: "oauth", timeoutMs: 25_000,
    });

    expect(updated).toEqual(expect.objectContaining({
      id: connectionId,
      name: "Fixed MCP",
      url: "https://mcp.example.test/mcp",
      timeoutMs: 25_000,
      authMode: "oauth",
      status: "disconnected",
      lastProtocolVersion: null,
      lastServerInfo: null,
      lastError: null,
    }));
    expect(service.list(project.id)).toEqual([updated]);
  });

  it("disconnects an active session before updating and keeps the old configuration if close fails", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const project = projects.create("Supplier Tools");
    const firstId = "00000000-0000-4000-8000-000000000210";
    const secondId = "00000000-0000-4000-8000-000000000211";
    const firstSession = new FakeMcpSession();
    const secondSession = new FakeMcpSession();
    secondSession.close = async () => { throw new Error("close failed"); };
    const sessions = [firstSession, secondSession];
    const ids = [firstId, secondId];
    let idIndex = 0;
    let sessionIndex = 0;
    const service = createConnectionService(projects, {
      createId: () => ids[idIndex++]!,
      sessionFactory: async () => sessions[sessionIndex++]!,
    });
    const input = { name: "MCP", url: "http://127.0.0.1:1/mcp", transport: "streamable-http" as const,
      authMode: "none" as const, timeoutMs: 100 };
    service.create(project.id, input);
    service.create(project.id, input);
    await service.connect(project.id, firstId);
    await service.connect(project.id, secondId);

    await expect(service.update(project.id, firstId, { url: "https://new.example.test/mcp" }))
      .resolves.toEqual(expect.objectContaining({ url: "https://new.example.test/mcp", status: "disconnected" }));
    expect(firstSession.closeCount).toBe(1);

    await expect(service.update(project.id, secondId, { name: "Must not persist" })).rejects.toThrow(/disconnect/i);
    expect(service.list(project.id).find(({ id }) => id === secondId)?.name).toBe("MCP");
  });

  it("makes a simultaneous first connect resolve the updated configuration", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const project = projects.create("Supplier Tools");
    const connectionId = "00000000-0000-4000-8000-000000000212";
    const resolvedUrls: string[] = [];
    const service = createConnectionService(projects, {
      createId: () => connectionId,
      sessionFactory: async (configuration) => {
        resolvedUrls.push(configuration.url);
        return new FakeMcpSession();
      },
    });
    service.create(project.id, {
      name: "MCP", url: "https://old.example.test/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 100,
    });

    const updating = service.update(project.id, connectionId, { url: "https://new.example.test/mcp" });
    const connecting = service.connect(project.id, connectionId);
    await updating;
    await connecting;

    expect(resolvedUrls).toEqual(["https://new.example.test/mcp"]);
  });

  it("survives closing and reopening the project store", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
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

  it("deletes only from the owning project and rejects unknown IDs", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
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

    await service.delete(firstProject.id, sharedId);
    expect(service.list(firstProject.id)).toEqual([]);
    expect(service.list(secondProject.id)).toHaveLength(1);
    await expect(service.delete(firstProject.id, sharedId)).rejects.toThrow(/not found/i);
    await expect(service.delete(secondProject.id, "not-a-uuid")).rejects.toThrow(/not found/i);
  });

  it("disconnects an active session before deleting its configuration", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const project = projects.create("Supplier Tools");
    const id = "00000000-0000-4000-8000-000000000207";
    const session = new FakeMcpSession();
    const service = createConnectionService(projects, {
      createId: () => id,
      sessionFactory: async () => session,
    });
    service.create(project.id, {
      name: "MCP", url: "http://127.0.0.1:1/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 100,
    });
    await service.connect(project.id, id);

    await service.delete(project.id, id);

    expect(session.closeCount).toBe(1);
    expect(service.list(project.id)).toEqual([]);
  });

  it("keeps configuration when closing its active session fails", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const project = projects.create("Supplier Tools");
    const id = "00000000-0000-4000-8000-000000000208";
    const session = new FakeMcpSession();
    session.close = async () => { throw new Error("remote close detail"); };
    const service = createConnectionService(projects, {
      createId: () => id,
      sessionFactory: async () => session,
    });
    service.create(project.id, {
      name: "MCP", url: "http://127.0.0.1:1/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 100,
    });
    await service.connect(project.id, id);

    await expect(service.delete(project.id, id)).rejects.toThrow(/disconnect/i);
    expect(service.list(project.id)).toHaveLength(1);
  });

  it("decodes malformed observation JSON defensively", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
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

  it("persists negotiated metadata, clears errors, and keeps runtime project-scoped", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-connections-"));
    dataRoots.push(dataRoot);
    projects = createProjectService({ dataRoot });
    const first = projects.create("First");
    const second = projects.create("Second");
    const sharedId = "00000000-0000-4000-8000-000000000206";
    const sessions: FakeMcpSession[] = [];
    const service = createConnectionService(projects, {
      createId: () => sharedId,
      sessionFactory: async () => {
        const session = new FakeMcpSession();
        sessions.push(session);
        return session;
      },
    });
    const input = {
      name: "MCP",
      url: "http://127.0.0.1:1/mcp",
      transport: "streamable-http" as const,
      authMode: "none" as const,
      timeoutMs: 100,
    };
    service.create(first.id, input);
    service.create(second.id, input);

    await service.connect(first.id, sharedId);
    expect(service.list(first.id)[0]).toEqual(expect.objectContaining({
      status: "connected",
      lastProtocolVersion: "2025-06-18",
      lastServerInfo: { name: "fake", version: "1.0.0" },
      lastError: null,
    }));
    expect(service.list(second.id)[0]?.status).toBe("disconnected");
    await service.disconnect(first.id, sharedId);
    expect(sessions[0]?.closeCount).toBe(1);
  });
});
