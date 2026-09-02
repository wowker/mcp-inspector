import { describe, expect, it, vi } from "vitest";
import type { ConnectionService } from "../../connections/connection-service.js";
import { ConnectionNotFoundError } from "../../connections/connection-service.js";
import type { ToolService } from "../../tools/tool-service.js";
import { ToolNotFoundError } from "../../tools/tool-service.js";
import type { ToolDefinition, ToolDetail } from "../../tools/tool-types.js";
import type { RunServiceWithEvents } from "../run-service.js";
import { RunNotFoundError } from "../run-service.js";
import {
  createReplayPreflightService,
  diffJsonSchemas,
  ReplayConnectionUnavailableError,
  ReplaySourceUnavailableError,
  ReplayToolUnavailableError,
} from "../replay-preflight-service.js";
import type { RunDetail } from "../run-types.js";

const projectId = "00000000-0000-4000-8000-000000000801";
const connectionId = "00000000-0000-4000-8000-000000000802";
const runId = "00000000-0000-4000-8000-000000000803";
const tabId = "00000000-0000-4000-8000-000000000804";
const sourceSnapshotId = "00000000-0000-4000-8000-000000000805";
const currentSnapshotId = "00000000-0000-4000-8000-000000000806";
const sourceHash = "a".repeat(64);
const currentHash = "b".repeat(64);

function definition(inputSchema: ToolDefinition["inputSchema"], annotations?: ToolDefinition["annotations"]): ToolDefinition {
  return { name: "update_item", inputSchema, ...(annotations === undefined ? {} : { annotations }) };
}

const sourceDefinition = definition({
  type: "object",
  properties: {
    count: { type: "number", minimum: 0 },
    nested: { anyOf: [true, { type: "string", pattern: "^[a-z]+$" }] },
  },
  required: ["count"],
});
const currentDefinition = definition({
  type: "object",
  properties: {
    count: { type: "integer", minimum: 1 },
    nested: { anyOf: [false, { type: "string", pattern: "^[a-z]+$" }] },
    mode: { type: "string", enum: ["safe"] },
  },
  required: ["count", "mode"],
  "x-vendor-rule": { remote: { $ref: "https://example.invalid/schema" } },
}, { destructiveHint: true, "x-risk": "writes-data" });

const run: RunDetail = {
  id: runId, projectId, connectionId, tabId, toolName: "update_item", toolSnapshotId: sourceSnapshotId,
  idempotencyKey: "original", status: "succeeded", createdAt: "2026-09-01T00:00:00.000Z",
  startedAt: "2026-09-01T00:00:00.000Z", completedAt: "2026-09-01T00:00:01.000Z",
  durationMs: 1_000, networkDurationMs: 900, pinned: false, replayedFromRunId: null,
  toolSnapshotHash: sourceHash, protocolVersion: "2025-06-18", serverInfo: null, clientInfo: {},
  request: { arguments: { count: 2, nested: { value: "unchanged" } }, jsonrpc: {}, http: null },
  response: { result: { ok: true }, error: null, truncated: false, originalBytes: 11 }, events: [],
};

const tool: ToolDetail = {
  tool: {
    projectId, connectionId, name: "update_item", status: "changed", folderId: null,
    favorite: false, lastUsedAt: null,
    updatedAt: "2026-09-01T01:00:00.000Z",
    currentSnapshot: {
      id: currentSnapshotId, projectId, connectionId, toolName: "update_item", contentHash: currentHash,
      definition: currentDefinition, createdAt: "2026-09-01T01:00:00.000Z",
    },
  },
  snapshots: [{
    id: sourceSnapshotId, projectId, connectionId, toolName: "update_item", contentHash: sourceHash,
    definition: sourceDefinition, createdAt: "2026-09-01T00:00:00.000Z",
  }],
};

function dependencies(overrides: {
  run?: () => RunDetail;
  connection?: () => unknown;
  tool?: () => ToolDetail;
} = {}) {
  const getRun = vi.fn(overrides.run ?? (() => structuredClone(run)));
  const getConnection = vi.fn(overrides.connection ?? (() => ({ id: connectionId })));
  const getTool = vi.fn(overrides.tool ?? (() => structuredClone(tool)));
  const start = vi.fn();
  const startInvocation = vi.fn();
  const runtime = vi.fn();
  return {
    service: createReplayPreflightService({
      runs: { get: getRun, start, startInvocation } as unknown as RunServiceWithEvents,
      connections: { get: getConnection, runtime } as unknown as ConnectionService,
      tools: { get: getTool } as unknown as ToolService,
    }),
    spies: { getRun, getConnection, getTool, start, startInvocation, runtime },
  };
}

describe("replay preflight service", () => {
  it("diffs nested boolean/object JSON Schema fields deterministically without resolving remote refs", () => {
    expect(diffJsonSchemas(sourceDefinition.inputSchema, currentDefinition.inputSchema)).toEqual([
      { path: "/properties/count/minimum", kind: "CHANGED" },
      { path: "/properties/count/type", kind: "CHANGED" },
      { path: "/properties/mode", kind: "ADDED" },
      { path: "/properties/nested/anyOf/0", kind: "CHANGED" },
      { path: "/required/1", kind: "ADDED" },
      { path: "/x-vendor-rule", kind: "ADDED" },
    ]);
  });

  it("returns a deterministic immutable preflight and performs no invocation or runtime access", () => {
    const first = dependencies();
    const result = first.service.inspect(projectId, runId);
    expect(result).toMatchObject({
      projectId, sourceRunId: runId, connectionId, toolName: "update_item",
      arguments: run.request.arguments,
      sourceToolSnapshotId: sourceSnapshotId, sourceToolSnapshotHash: sourceHash,
      currentToolSnapshotId: currentSnapshotId, currentToolSnapshotHash: currentHash,
      annotations: { destructiveHint: true, "x-risk": "writes-data" },
      sideEffectRisk: "DESTRUCTIVE", blockers: [],
      requiredConfirmations: ["SCHEMA_DRIFT", "SIDE_EFFECT_RISK"],
    });
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.service.inspect(projectId, runId)).toEqual(result);
    expect(first.spies.getRun).toHaveBeenCalledWith(projectId, runId);
    expect(first.spies.getConnection).toHaveBeenCalledWith(projectId, connectionId);
    expect(first.spies.getTool).toHaveBeenCalledWith(projectId, connectionId, "update_item");
    expect(first.spies.start).not.toHaveBeenCalled();
    expect(first.spies.startInvocation).not.toHaveBeenCalled();
    expect(first.spies.runtime).not.toHaveBeenCalled();

    result.arguments.count = 999;
    expect(run.request.arguments).toEqual({ count: 2, nested: { value: "unchanged" } });
  });

  it("classifies read-only Tools as safe without a side-effect confirmation", () => {
    const safeTool = structuredClone(tool);
    safeTool.tool.currentSnapshot.definition.annotations = { readOnlyHint: true };
    safeTool.tool.currentSnapshot.contentHash = sourceHash;
    safeTool.tool.currentSnapshot.definition.inputSchema = structuredClone(sourceDefinition.inputSchema);
    const { service } = dependencies({ tool: () => safeTool });
    expect(service.inspect(projectId, runId)).toMatchObject({
      sideEffectRisk: "SAFE", schemaChanges: [], requiredConfirmations: [],
    });
  });

  it("returns stable source, connection, Tool, removed Tool, and source-snapshot failures", () => {
    expect(() => dependencies({ run: () => { throw new RunNotFoundError(); } }).service.inspect(projectId, runId))
      .toThrow(ReplaySourceUnavailableError);
    expect(() => dependencies({ connection: () => { throw new ConnectionNotFoundError(); } }).service.inspect(projectId, runId))
      .toThrow(ReplayConnectionUnavailableError);
    expect(() => dependencies({ tool: () => { throw new ToolNotFoundError(); } }).service.inspect(projectId, runId))
      .toThrow(ReplayToolUnavailableError);
    expect(() => dependencies({ tool: () => ({ ...structuredClone(tool), tool: { ...tool.tool, status: "removed" } }) })
      .service.inspect(projectId, runId)).toThrow(ReplayToolUnavailableError);
    expect(() => dependencies({ tool: () => ({ ...structuredClone(tool), snapshots: [] }) })
      .service.inspect(projectId, runId)).toThrow(ReplaySourceUnavailableError);
  });
});
