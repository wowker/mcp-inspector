import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { ToolRepository } from "../../tools/tool-repository.js";
import { createTabService } from "../tab-service.js";

const projectId = "00000000-0000-4000-8000-000000000601";
const connectionId = "00000000-0000-4000-8000-000000000602";
const bearerConnectionId = "00000000-0000-4000-8000-000000000603";

describe("TabService", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-tabs-"));
    roots.push(dataRoot);
    let next = 610;
    const ids = () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Tabs");
    const connectionIds = [connectionId, bearerConnectionId];
    const connections = createConnectionService(projects, { createId: () => connectionIds.shift()! });
    connections.create(projectId, {
      name: "OAuth", url: "https://example.test/mcp", transport: "streamable-http",
      authMode: "oauth", timeoutMs: 10_000,
    });
    connections.create(projectId, {
      name: "Bearer", url: "https://example.test/mcp", transport: "streamable-http",
      authMode: "bearer", bearerToken: "secret", timeoutMs: 10_000,
    });
    const toolRepository = new ToolRepository(projects.open(projectId));
    toolRepository.replaceCatalog(projectId, connectionId, [{
      id: ids(), name: "sum", contentHash: "a".repeat(64),
      definitionJson: JSON.stringify({ name: "sum", inputSchema: { type: "object" } }),
    }], "2026-08-17T00:00:00.000Z");
    toolRepository.replaceCatalog(projectId, bearerConnectionId, [{
      id: ids(), name: "sum", contentHash: "b".repeat(64),
      definitionJson: JSON.stringify({ name: "sum", inputSchema: { type: "object" } }),
    }], "2026-08-17T00:00:00.000Z");
    return { dataRoot, projects, service: createTabService(projects, connections, { createId: ids,
      now: () => new Date("2026-08-17T00:00:00.000Z") }) };
  }

  it("isolates persisted Tabs and bulk operations by immutable connection identity", () => {
    const { projects, service } = fixture();
    try {
      const oauthFirst = service.open({ projectId, connectionId, toolName: "sum" });
      const oauthSecond = service.open({ projectId, connectionId, toolName: "sum" });
      const bearer = service.open({ projectId, connectionId: bearerConnectionId, toolName: "sum" });

      expect(service.list(projectId, connectionId).map(({ id, title }) => [id, title]))
        .toEqual([[oauthFirst.id, "sum"], [oauthSecond.id, "sum (2)"]]);
      expect(service.list(projectId, bearerConnectionId).map(({ id, title }) => [id, title]))
        .toEqual([[bearer.id, "sum"]]);

      service.closeOthers(projectId, oauthFirst.id);
      expect(service.list(projectId, connectionId).map(({ id }) => id)).toEqual([oauthFirst.id]);
      expect(service.list(projectId, bearerConnectionId).map(({ id }) => id)).toEqual([bearer.id]);
      expect(() => service.replaceTool(projectId, oauthFirst.id, bearerConnectionId, "sum")).toThrow(/connection/i);
    } finally { projects.close(); }
  });

  it("keeps repeated same-Tool Tabs independently persisted", () => {
    const { projects, service } = fixture();
    try {
      const first = service.open({ projectId, connectionId, toolName: "sum" });
      const second = service.open({ projectId, connectionId, toolName: "sum" });
      expect(first).toMatchObject({ arguments: {}, rawText: "" });
      expect(second).toMatchObject({ arguments: {}, rawText: "" });
      expect(first.id).not.toBe(second.id);
      expect(first.title).toBe("sum");
      expect(second.title).toBe("sum (2)");
      service.update(first.id, projectId, { arguments: { a: 1, b: 2 }, inputMode: "form" });
      service.update(second.id, projectId, {
        arguments: { a: 10, b: 20 }, inputMode: "raw", rawText: "{\n  \"a\": 10,\n  \"b\": 20\n}",
      });
      expect(service.get(projectId, first.id).arguments).toEqual({ a: 1, b: 2 });
      expect(service.get(projectId, second.id).arguments).toEqual({ a: 10, b: 20 });
    } finally { projects.close(); }
  });

  it("resets Raw JSON to blank when replacing the Tool", () => {
    const { projects, service } = fixture();
    try {
      const opened = service.open({ projectId, connectionId, toolName: "sum" });
      service.update(opened.id, projectId, { inputMode: "raw", arguments: { a: 1 }, rawText: '{"a":1}' });
      expect(service.replaceTool(projectId, opened.id, connectionId, "sum"))
        .toMatchObject({ inputMode: "form", arguments: {}, rawText: "" });
    } finally { projects.close(); }
  });

  it("preserves pinned Tabs during bulk close and keeps dense positions", () => {
    const { projects, service } = fixture();
    try {
      const first = service.open({ projectId, connectionId, toolName: "sum" });
      const pinned = service.open({ projectId, connectionId, toolName: "sum" });
      const last = service.open({ projectId, connectionId, toolName: "sum" });
      service.update(pinned.id, projectId, { pinned: true });
      service.closeOthers(projectId, first.id);
      expect(service.list(projectId, connectionId).map(({ id, position }) => [id, position])).toEqual([
        [first.id, 0], [pinned.id, 1],
      ]);
      service.open({ projectId, connectionId, toolName: "sum" });
      service.closeRight(projectId, first.id);
      expect(service.list(projectId, connectionId).map(({ id }) => id)).toEqual([first.id, pinned.id]);
      expect(() => service.get(projectId, last.id)).toThrow(/not found/i);
    } finally { projects.close(); }
  });

  it("duplicates drafts, reorders only complete project sets, and reuses title gaps", () => {
    const { projects, service } = fixture();
    try {
      const first = service.open({ projectId, connectionId, toolName: "sum" });
      const second = service.open({ projectId, connectionId, toolName: "sum" });
      const third = service.open({ projectId, connectionId, toolName: "sum" });
      service.update(second.id, projectId, { arguments: { marker: 2 }, rawText: "{\"marker\":2}", inputMode: "raw",
        viewState: { editorScrollTop: 9, resultScrollTop: 10, splitRatio: 0.6,
          requestExpanded: false, responseExpanded: true }, pinned: true });
      const copy = service.duplicate(projectId, second.id);
      expect(copy).toMatchObject({ title: "sum (4)", arguments: { marker: 2 }, rawText: "{\"marker\":2}",
        inputMode: "raw", pinned: false, lastRunId: null,
        viewState: { splitRatio: 0.6, requestExpanded: false, responseExpanded: true } });
      expect(() => service.reorder(projectId, connectionId, [first.id, second.id])).toThrow(/invalid/i);
      expect(service.reorder(projectId, connectionId, [copy.id, third.id, first.id, second.id]).map(({ id, position }) => [id, position]))
        .toEqual([[copy.id, 0], [third.id, 1], [first.id, 2], [second.id, 3]]);
      service.update(second.id, projectId, { pinned: false });
      service.close(projectId, second.id);
      expect(service.open({ projectId, connectionId, toolName: "sum" }).title).toBe("sum (2)");
    } finally { projects.close(); }
  });

  it("restores legacy Split Pane state with both panes expanded", () => {
    const { projects, service } = fixture();
    try {
      const opened = service.open({ projectId, connectionId, toolName: "sum" });
      projects.open(projectId).database.prepare("UPDATE debug_tabs SET view_state_json = ? WHERE id = ?")
        .run('{"editorScrollTop":7,"resultScrollTop":8,"splitRatio":0.35}', opened.id);

      expect(service.get(projectId, opened.id).viewState).toEqual({
        editorScrollTop: 7,
        resultScrollTop: 8,
        splitRatio: 0.35,
        requestExpanded: true,
        responseExpanded: true,
      });
    } finally { projects.close(); }
  });

  it("rejects corrupt persisted JSON instead of resetting a draft", () => {
    const { projects, service } = fixture();
    try {
      const opened = service.open({ projectId, connectionId, toolName: "sum" });
      projects.open(projectId).database.prepare("UPDATE debug_tabs SET arguments_json = ? WHERE id = ?")
        .run("not-json", opened.id);
      expect(() => service.get(projectId, opened.id)).toThrow(/corrupt/i);
    } finally { projects.close(); }
  });

  it("refuses removed Tools and foreign Tab IDs", () => {
    const { projects, service } = fixture();
    try {
      const opened = service.open({ projectId, connectionId, toolName: "sum" });
      expect(() => service.update(opened.id, projectId, {
        arguments: { invalid: undefined },
      })).toThrow(/invalid/i);
      new ToolRepository(projects.open(projectId)).replaceCatalog(projectId, connectionId, [], "2026-08-17T01:00:00.000Z");
      expect(() => service.open({ projectId, connectionId, toolName: "sum" })).toThrow(/removed/i);
      expect(() => service.get(projectId, "00000000-0000-4000-8000-000000000999")).toThrow(/not found/i);
      expect(service.get(projectId, opened.id).id).toBe(opened.id);
    } finally { projects.close(); }
  });

  it("applies all current migrations once and enforces Tab foreign keys", () => {
    const { dataRoot, projects } = fixture();
    const store = projects.open(projectId);
    expect(store.database.prepare("SELECT version FROM schema_migrations ORDER BY version").all())
      .toEqual(Array.from({ length: 18 }, (_, index) => ({ version: index + 1 })));
    expect(() => store.database.prepare(`INSERT INTO debug_tabs
      (id, project_id, connection_id, tool_name, title, position, pinned, input_mode,
       arguments_json, raw_text, view_state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("00000000-0000-4000-8000-000000000699", projectId,
        "00000000-0000-4000-8000-000000000698", "sum", "sum", 0, 0, "form", "{}", "{}",
        '{"editorScrollTop":0,"resultScrollTop":0,"splitRatio":0.5}',
        "2026-08-17T00:00:00.000Z", "2026-08-17T00:00:00.000Z")).toThrow(/foreign key/i);
    expect(() => store.database.prepare(`INSERT INTO debug_tabs
      (id, project_id, connection_id, tool_name, title, position, pinned, input_mode,
       arguments_json, raw_text, view_state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("00000000-0000-4000-8000-000000000700", "00000000-0000-4000-8000-000000000697",
        connectionId, "sum", "sum", 0, 0, "form", "{}", "{}",
        '{"editorScrollTop":0,"resultScrollTop":0,"splitRatio":0.5}',
        "2026-08-17T00:00:00.000Z", "2026-08-17T00:00:00.000Z")).toThrow(/foreign key/i);
    const foreignProjectId = "00000000-0000-4000-8000-000000000697";
    store.database.prepare(`INSERT INTO projects (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)`).run(foreignProjectId, "Foreign", "2026-08-17T00:00:00.000Z", "2026-08-17T00:00:00.000Z");
    expect(() => store.database.prepare(`INSERT INTO tool_folders
      (id, project_id, connection_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
        "00000000-0000-4000-8000-000000000696", foreignProjectId, connectionId, "Wrong Server",
        "2026-08-17T00:00:00.000Z", "2026-08-17T00:00:00.000Z",
      )).toThrow(/foreign key/i);
    projects.close();
    const reopened = createProjectService({ dataRoot });
    try {
      expect(reopened.open(projectId).database.prepare("SELECT count(*) AS count FROM schema_migrations WHERE version = 4").get())
        .toEqual({ count: 1 });
    } finally { reopened.close(); }
  });
});
