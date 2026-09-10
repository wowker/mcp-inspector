import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { canonicalJson, createToolService } from "../../tools/tool-service.js";
import { ToolRepository } from "../../tools/tool-repository.js";
import { createAuthoringCatalogService, InvalidAuthoringCursorError } from "../authoring-catalog-service.js";
import { createAuthoringPolicyService } from "../authoring-policy-service.js";

describe("Authoring catalog service", () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-authoring-catalog-"));
    const projectIds = [
      "20000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000002",
    ];
    let projectIndex = 0;
    const projects = createProjectService({ dataRoot, createId: () => projectIds[projectIndex++]! });
    const first = projects.create("Alpha project");
    const second = projects.create("Beta project");
    const connectionIds = [
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
    ];
    let connectionIndex = 0;
    const connections = createConnectionService(projects, { createId: () => connectionIds[connectionIndex++]! });
    const permitted = connections.create(first.id, {
      name: "Permitted Server", url: "http://127.0.0.1:9001/mcp?ordinary=value",
      transport: "streamable-http", authMode: "none", timeoutMs: 30000,
    });
    const hidden = connections.create(first.id, {
      name: "Hidden Server", url: "http://127.0.0.1:9002/mcp",
      transport: "streamable-http", authMode: "none", timeoutMs: 30000,
    });
    const tools = createToolService(projects, connections);
    const definitions = [
      { name: "read_orders", description: "Read orders", inputSchema: { type: "object" as const } },
      { name: "delete_order", description: "Delete order", inputSchema: { type: "object" as const } },
    ];
    new ToolRepository(projects.open(first.id)).replaceCatalog(first.id, permitted.id, definitions.map((definition, index) => ({
      id: `40000000-0000-4000-8000-00000000000${index + 1}`,
      name: definition.name,
      contentHash: createHash("sha256").update(canonicalJson(definition)).digest("hex"),
      definitionJson: canonicalJson(definition),
    })), "2026-09-10T00:00:00.000Z");
    const policies = createAuthoringPolicyService({ projects });
    policies.replace(first.id, permitted.id, {
      expectedRevision: 0, mode: "CUSTOM", allowedTools: ["read_orders"], deniedTools: [],
      requireCleanupForDraftMutations: true, maxCallsPerMinute: 60, maxConcurrentCalls: 2, maxCallDurationMs: 30000,
    });
    const catalog = createAuthoringCatalogService({
      projects, connections, tools, policies, cursorSecret: Buffer.alloc(32, 7),
    });
    cleanups.push(async () => {
      await connections.close();
      projects.close();
      rmSync(dataRoot, { recursive: true, force: true });
    });
    return { catalog, first, second, permitted, hidden };
  }

  test("paginates projects with opaque filter-bound cursors", () => {
    const { catalog } = fixture();
    const firstPage = catalog.listProjects({ limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(catalog.listProjects({ limit: 1, cursor: firstPage.nextCursor! }).items).toHaveLength(1);
    expect(() => catalog.listProjects({ limit: 1, query: "Alpha", cursor: firstPage.nextCursor! }))
      .toThrow(InvalidAuthoringCursorError);
    expect(() => catalog.listProjects({ cursor: `${firstPage.nextCursor}x` }))
      .toThrow(InvalidAuthoringCursorError);
  });

  test("hides disabled connections and denied Tools without exposing connection URLs", () => {
    const { catalog, first, permitted } = fixture();
    const connections = catalog.listConnections(first.id, {});
    expect(connections.items.map((item) => item.id)).toEqual([permitted.id]);
    expect(JSON.stringify(connections)).not.toContain("9001");
    expect(JSON.stringify(connections)).not.toContain("ordinary=value");

    const tools = catalog.listTools(first.id, permitted.id, {});
    expect(tools.items.map((item) => item.name)).toEqual(["read_orders"]);
    expect(tools.items[0]).toMatchObject({ schemaHash: expect.stringMatching(/^[a-f0-9]{64}$/), stale: false });
    const detail = catalog.describeTool(first.id, permitted.id, "read_orders");
    expect(detail).toMatchObject({ name: "read_orders", untrusted: true, inputSchema: { type: "object" } });
  });
});
