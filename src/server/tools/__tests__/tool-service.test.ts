import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StandardSchemaV1 } from "@modelcontextprotocol/client";
import { createConnectionService, type ConnectionService } from "../../connections/connection-service.js";
import type { McpSession } from "../../connections/connection-runtime.js";
import { createStreamableMcpSessionFactory } from "../../connections/streamable-session.js";
import { createProjectService, type ProjectService } from "../../projects/project-service.js";
import { canonicalJson, createToolService } from "../tool-service.js";

const connectionId = "00000000-0000-4000-8000-000000000501";
const snapshotIds = [
  "00000000-0000-4000-8000-000000000511",
  "00000000-0000-4000-8000-000000000512",
  "00000000-0000-4000-8000-000000000513",
  "00000000-0000-4000-8000-000000000514",
];

function tool(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    title: `${name} title`,
    description: `${name} description`,
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
    icons: [{ src: "https://example.test/icon.svg" }],
    _meta: { vendor: { retained: true } },
    ...extra,
  };
}

describe("ToolService", () => {
  let dataRoot: string;
  let projects: ProjectService;
  let connections: ConnectionService;
  let projectId: string;
  let pages: Array<{ tools: Array<Record<string, unknown>>; nextCursor?: string }>;
  let listTools: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), "dsers-inspector-tools-"));
    projects = createProjectService({ dataRoot });
    const project = projects.create("Catalog");
    projectId = project.id;
    pages = [{ tools: [tool("sum"), tool("echo")] }];
    listTools = vi.fn(async ({ cursor }: { cursor?: string } = {}) => {
      const page = cursor === undefined ? 0 : Number(cursor);
      return pages[page] ?? { tools: [] };
    });
    const session = {
      protocolVersion: "2025-06-18",
      serverInfo: { name: "fake", version: "1" },
      listTools,
      callTool: vi.fn(),
      close: vi.fn(),
    } as unknown as McpSession;
    connections = createConnectionService(projects, {
      createId: () => connectionId,
      sessionFactory: async () => session,
    });
    connections.create(projectId, {
      name: "Catalog MCP", url: "http://127.0.0.1:1/mcp",
      transport: "streamable-http", authMode: "none", timeoutMs: 100,
    });
    await connections.connect(projectId, connectionId);
  });

  afterEach(() => {
    projects.close();
    rmSync(dataRoot, { recursive: true, force: true });
  });

  function service() {
    let index = 0;
    return createToolService(projects, connections, {
      createId: () => snapshotIds[index++] ?? crypto.randomUUID(),
      now: () => new Date("2026-08-17T12:00:00.000Z"),
    });
  }

  it("canonicalizes object keys recursively, preserves array order, and rejects non-JSON values", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: [3, { b: 2, a: 1 }] } }))
      .toBe('{"a":{"x":[3,{"a":1,"b":2}],"y":2},"z":1}');
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
    expect(() => canonicalJson({ value: undefined })).toThrow(/json/i);
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(/json/i);
    expect(() => canonicalJson(new Array(1))).toThrow(/json/i);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/json/i);
    const special = JSON.parse('{"nested":{"__proto__":{"polluted":true},"constructor":"kept"}}') as unknown;
    expect(canonicalJson(special)).toBe('{"nested":{"__proto__":{"polluted":true},"constructor":"kept"}}');
    expect(canonicalJson(special)).not.toBe(canonicalJson({ nested: { constructor: "kept" } }));
  });

  it("persists future Tool fields unchanged through the real low-level client adapter", async () => {
    const adapterConnectionId = "00000000-0000-4000-8000-000000000518";
    const adapterProject = projects.create("Adapter Catalog");
    const definition = {
      name: "future/tool",
      title: "Future tool",
      description: "Exercises every current MCP Tool field",
      inputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { value: { type: "string", minLength: 1 }, disabled: false },
        required: ["value"],
        additionalProperties: false,
        futureKeyword: { nested: ["a", "b"] },
      },
      outputSchema: {
        type: "array",
        items: false,
        futureOutputKeyword: true,
      },
      annotations: {
        title: "Future annotation",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        futureHint: { keep: true },
      },
      execution: { taskSupport: "optional", futureExecution: "keep" },
      icons: [{
        src: "https://example.test/icon.svg",
        mimeType: "image/svg+xml",
        sizes: ["any", "48x48"],
        theme: "dark",
        futureIconField: { keep: true },
      }],
      _meta: { vendor: { keep: true } },
      futureTopLevel: { keep: [1, 2, 3] },
    };
    const definitions = [
      definition,
      { name: "future/any-of", inputSchema: { type: "object" },
        outputSchema: { anyOf: [false, { type: "string" }] } },
      { name: "future/not", inputSchema: { type: "object" }, outputSchema: { not: false } },
      { name: "future/empty", inputSchema: { type: "object" }, outputSchema: {} },
    ];
    const highLevelListTools = vi.fn(async () => ({ tools: [] }));
    const request = vi.fn(async (_request: unknown, schema: StandardSchemaV1) => {
      const validated = await schema["~standard"].validate({ tools: definitions });
      if (validated.issues !== undefined) throw new Error("schema rejected controlled Tool");
      return validated.value;
    });
    const sessionFactory = createStreamableMcpSessionFactory({
      createClient: () => ({
        connect: async () => undefined,
        getServerVersion: () => undefined,
        listTools: highLevelListTools,
        callTool: async () => ({ content: [] }),
        request,
        close: async () => undefined,
      }),
      createTransport: () => ({
        start: async () => undefined, send: async () => undefined, close: async () => undefined,
      }),
    });
    const adapterConnections = createConnectionService(projects, {
      createId: () => adapterConnectionId,
      sessionFactory,
    });
    adapterConnections.create(adapterProject.id, {
      name: "Adapter", url: "http://127.0.0.1:1/mcp",
      transport: "streamable-http", authMode: "none", timeoutMs: 100,
    });
    await adapterConnections.connect(adapterProject.id, adapterConnectionId);
    let snapshotIndex = 519;
    const adapterTools = createToolService(projects, adapterConnections, {
      createId: () => `00000000-0000-4000-8000-${String(snapshotIndex++).padStart(12, "0")}`,
    });

    await adapterTools.refresh(adapterProject.id, adapterConnectionId);

    expect(highLevelListTools).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
    expect(adapterTools.get(adapterProject.id, adapterConnectionId, definition.name)
      .tool.currentSnapshot.definition).toEqual(definition);
    for (const expected of definitions.slice(1)) {
      expect(adapterTools.get(adapterProject.id, adapterConnectionId, expected.name)
        .tool.currentSnapshot.definition).toEqual(expected);
    }
  });

  it("rejects a Tool whose inputSchema properties is not an object", async () => {
    pages = [{ tools: [tool("bad-properties", {
      inputSchema: { type: "object", properties: [] },
    })] }];

    await expect(service().refresh(projectId, connectionId))
      .rejects.toThrow("MCP Tool catalog is invalid");
  });

  it("preserves nested special keys and hashes them as content", async () => {
    const tools = service();
    const withSpecialKey = JSON.parse(
      '{"name":"special","inputSchema":{"type":"object"},"future":{"__proto__":{"kept":true},"constructor":"value"}}',
    ) as Record<string, unknown>;
    pages = [{ tools: [withSpecialKey] }];
    await tools.refresh(projectId, connectionId);
    const first = tools.get(projectId, connectionId, "special").tool.currentSnapshot;

    pages = [{ tools: [{
      name: "special", inputSchema: { type: "object" }, future: { constructor: "value" },
    }] }];
    await tools.refresh(projectId, connectionId);
    const second = tools.get(projectId, connectionId, "special").tool.currentSnapshot;

    expect(first.definition).toEqual(withSpecialKey);
    expect(first.contentHash).not.toBe(second.contentHash);
  });

  it("marks a reappeared Tool changed when its definition differs from its last snapshot", async () => {
    const tools = service();
    await tools.refresh(projectId, connectionId);
    pages = [{ tools: [tool("sum")] }];
    await tools.refresh(projectId, connectionId);
    pages = [{ tools: [tool("sum"), tool("echo", { description: "new echo" })] }];

    await tools.refresh(projectId, connectionId);

    expect(tools.get(projectId, connectionId, "echo").tool.status).toBe("changed");
    expect(tools.get(projectId, connectionId, "echo").snapshots).toHaveLength(2);
  });

  it("deduplicates identical snapshots and preserves complete untrusted definitions", async () => {
    const tools = service();
    await tools.refresh(projectId, connectionId);
    await tools.refresh(projectId, connectionId);

    expect(tools.list(projectId, connectionId)).toEqual([
      expect.objectContaining({ name: "echo", status: "current" }),
      expect.objectContaining({
        name: "sum", status: "current",
        currentSnapshot: expect.objectContaining({
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          definition: tool("sum"),
        }),
      }),
    ]);
    expect(tools.get(projectId, connectionId, "sum").snapshots).toHaveLength(1);
  });

  it("tracks changed, settled, removed, and reappeared definitions without deleting history", async () => {
    const tools = service();
    await tools.refresh(projectId, connectionId);
    pages = [{ tools: [tool("sum", { inputSchema: { type: "object", required: ["a"] } })] }];
    await tools.refresh(projectId, connectionId);
    expect(tools.list(projectId, connectionId)).toEqual([
      expect.objectContaining({ name: "echo", status: "removed" }),
      expect.objectContaining({ name: "sum", status: "changed" }),
    ]);
    expect(tools.get(projectId, connectionId, "sum").snapshots).toHaveLength(2);

    await tools.refresh(projectId, connectionId);
    expect(tools.get(projectId, connectionId, "sum").tool.status).toBe("current");
    pages = [{ tools: [tool("sum", { inputSchema: { type: "object", required: ["a"] } }), tool("echo")] }];
    await tools.refresh(projectId, connectionId);
    expect(tools.get(projectId, connectionId, "echo").tool.status).toBe("current");
    expect(tools.get(projectId, connectionId, "echo").snapshots).toHaveLength(1);
  });

  it("drains pagination before one atomic write and rejects duplicate names or repeated cursors", async () => {
    const tools = service();
    pages = [
      { tools: [tool("sum")], nextCursor: "1" },
      { tools: [tool("echo")] },
    ];
    await tools.refresh(projectId, connectionId);
    expect(listTools).toHaveBeenNthCalledWith(1, undefined);
    expect(listTools).toHaveBeenNthCalledWith(2, { cursor: "1" });
    expect(tools.list(projectId, connectionId)).toHaveLength(2);

    pages = [{ tools: [tool("bad")], nextCursor: "0" }];
    await expect(tools.refresh(projectId, connectionId)).rejects.toThrow(/cursor/i);
    expect(tools.list(projectId, connectionId).map(({ name }) => name)).toEqual(["echo", "sum"]);

    pages = [{ tools: [tool("same"), tool("same")] }];
    await expect(tools.refresh(projectId, connectionId)).rejects.toThrow(/duplicate/i);
    expect(tools.list(projectId, connectionId).map(({ name }) => name)).toEqual(["echo", "sum"]);
  });

  it("rejects page 1001 and leaves the previous catalog untouched", async () => {
    const tools = service();
    await tools.refresh(projectId, connectionId);
    listTools.mockImplementation(async ({ cursor }: { cursor?: string } = {}) => ({
      tools: [], nextCursor: String((cursor === undefined ? 0 : Number(cursor)) + 1),
    }));
    await expect(tools.refresh(projectId, connectionId)).rejects.toThrow(/1,000/i);
    expect(listTools).toHaveBeenCalledTimes(1001);
    expect(tools.list(projectId, connectionId)).toHaveLength(2);
  });

  it("treats an empty cursor as present and requests the next page", async () => {
    const tools = service();
    listTools
      .mockResolvedValueOnce({ tools: [tool("sum")], nextCursor: "" })
      .mockResolvedValueOnce({ tools: [tool("echo")] });

    await tools.refresh(projectId, connectionId);

    expect(listTools).toHaveBeenNthCalledWith(2, { cursor: "" });
    expect(tools.list(projectId, connectionId)).toHaveLength(2);
  });

  it("rolls back the entire refresh if persistence fails", async () => {
    const tools = service();
    await tools.refresh(projectId, connectionId);
    projects.open(projectId).database.exec(`
      CREATE TRIGGER fail_tool_update BEFORE UPDATE ON tools
      BEGIN SELECT RAISE(ABORT, 'forced persistence failure'); END;
    `);
    pages = [{ tools: [tool("sum", { description: "changed" })] }];

    await expect(tools.refresh(projectId, connectionId)).rejects.toThrow("Unable to refresh MCP Tool catalog");
    expect(tools.get(projectId, connectionId, "sum").snapshots).toHaveLength(1);
    expect(tools.get(projectId, connectionId, "echo").tool.status).toBe("current");
  });

  it("uses no network for list/get and rejects disconnected or cross-project refreshes", async () => {
    const tools = service();
    await tools.refresh(projectId, connectionId);
    listTools.mockClear();
    tools.list(projectId, connectionId);
    tools.get(projectId, connectionId, "sum");
    expect(listTools).not.toHaveBeenCalled();

    await connections.disconnect(projectId, connectionId);
    await expect(tools.refresh(projectId, connectionId)).rejects.toThrow(/not active/i);
    const other = projects.create("Other");
    await expect(tools.refresh(other.id, connectionId)).rejects.toThrow(/not found/i);
    expect(() => tools.list(other.id, connectionId)).toThrow(/not found/i);
  });
});
