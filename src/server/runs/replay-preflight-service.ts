import { createHash } from "node:crypto";
import { replayPreflightSchema, type ReplayPreflight } from "../../shared/run-replay.js";
import type { JsonObject, JsonValue } from "../../shared/tool-definition.js";
import { ConnectionNotFoundError, type ConnectionService } from "../connections/connection-service.js";
import { canonicalJson, ToolNotFoundError, type ToolService } from "../tools/tool-service.js";
import type { ToolDefinition } from "../tools/tool-types.js";
import { RunNotFoundError, type RunServiceWithEvents } from "./run-service.js";

const MAX_SCHEMA_CHANGES = 2_000;

export class ReplaySourceUnavailableError extends Error {
  readonly code = "RUN_NOT_FOUND" as const;
  constructor() { super("Source Run or Tool snapshot is unavailable"); this.name = "ReplaySourceUnavailableError"; }
}

export class ReplayConnectionUnavailableError extends Error {
  readonly code = "REPLAY_BLOCKED" as const;
  constructor() { super("Source connection is unavailable"); this.name = "ReplayConnectionUnavailableError"; }
}

export class ReplayToolUnavailableError extends Error {
  readonly code = "REPLAY_BLOCKED" as const;
  constructor() { super("Current Tool is unavailable"); this.name = "ReplayToolUnavailableError"; }
}

export interface ReplayPreflightService {
  inspect(projectId: string, sourceRunId: string): ReplayPreflight;
}

type SchemaChange = ReplayPreflight["schemaChanges"][number];

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function pointer(parent: string, segment: string): string {
  return `${parent}/${pointerSegment(segment)}`;
}

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Produces a stable structural JSON diff. JSON Schema keywords are intentionally
 * not interpreted, so extensions, boolean subschemas, and remote refs stay local
 * data and never trigger network access.
 */
export function diffJsonSchemas(source: JsonValue, current: JsonValue): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const visit = (left: JsonValue, right: JsonValue, path: string): void => {
    if (changes.length >= MAX_SCHEMA_CHANGES || canonicalJson(left) === canonicalJson(right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length && changes.length < MAX_SCHEMA_CHANGES; index += 1) {
        const childPath = pointer(path, String(index));
        if (index >= left.length) changes.push({ path: childPath, kind: "ADDED" });
        else if (index >= right.length) changes.push({ path: childPath, kind: "REMOVED" });
        else visit(left[index]!, right[index]!, childPath);
      }
      return;
    }
    if (isObject(left) && isObject(right)) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      for (const key of keys) {
        if (changes.length >= MAX_SCHEMA_CHANGES) break;
        const childPath = pointer(path, key);
        if (!Object.hasOwn(left, key)) changes.push({ path: childPath, kind: "ADDED" });
        else if (!Object.hasOwn(right, key)) changes.push({ path: childPath, kind: "REMOVED" });
        else visit(left[key]!, right[key]!, childPath);
      }
      return;
    }
    changes.push({ path: path.length === 0 ? "/" : path, kind: "CHANGED" });
  };
  visit(source, current, "");
  return changes;
}

function annotationsOf(definition: ToolDefinition): JsonObject {
  return definition.annotations === undefined
    ? {}
    : JSON.parse(canonicalJson(definition.annotations)) as JsonObject;
}

function sideEffectRisk(annotations: JsonObject): ReplayPreflight["sideEffectRisk"] {
  if (annotations.destructiveHint === true) return "DESTRUCTIVE";
  if (annotations.readOnlyHint === true) return "SAFE";
  return "UNKNOWN";
}

function digestFor(value: Omit<ReplayPreflight, "digest">): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function createReplayPreflightService(dependencies: {
  runs: Pick<RunServiceWithEvents, "get">;
  connections: Pick<ConnectionService, "get">;
  tools: Pick<ToolService, "get">;
}): ReplayPreflightService {
  return {
    inspect(projectId, sourceRunId) {
      let source;
      try {
        source = dependencies.runs.get(projectId, sourceRunId);
      } catch (error) {
        if (error instanceof RunNotFoundError) throw new ReplaySourceUnavailableError();
        throw error;
      }

      try {
        dependencies.connections.get(projectId, source.connectionId);
      } catch (error) {
        if (error instanceof ConnectionNotFoundError) throw new ReplayConnectionUnavailableError();
        throw error;
      }

      let detail;
      try {
        detail = dependencies.tools.get(projectId, source.connectionId, source.toolName);
      } catch (error) {
        if (error instanceof ToolNotFoundError || error instanceof ConnectionNotFoundError) {
          throw new ReplayToolUnavailableError();
        }
        throw error;
      }
      if (detail.tool.status === "removed") throw new ReplayToolUnavailableError();

      const sourceSnapshot = detail.snapshots.find(({ id }) => id === source.toolSnapshotId);
      if (sourceSnapshot === undefined || sourceSnapshot.contentHash !== source.toolSnapshotHash) {
        throw new ReplaySourceUnavailableError();
      }
      const currentSnapshot = detail.tool.currentSnapshot;
      const schemaChanges = diffJsonSchemas(sourceSnapshot.definition.inputSchema, currentSnapshot.definition.inputSchema);
      const annotations = annotationsOf(currentSnapshot.definition);
      const risk = sideEffectRisk(annotations);
      const requiredConfirmations: ReplayPreflight["requiredConfirmations"] = [];
      if (schemaChanges.length > 0) requiredConfirmations.push("SCHEMA_DRIFT");
      if (risk !== "SAFE") requiredConfirmations.push("SIDE_EFFECT_RISK");

      const preflightWithoutDigest: Omit<ReplayPreflight, "digest"> = {
        projectId,
        sourceRunId,
        connectionId: source.connectionId,
        toolName: source.toolName,
        arguments: JSON.parse(canonicalJson(source.request.arguments)) as JsonObject,
        sourceToolSnapshotId: sourceSnapshot.id,
        sourceToolSnapshotHash: sourceSnapshot.contentHash,
        currentToolSnapshotId: currentSnapshot.id,
        currentToolSnapshotHash: currentSnapshot.contentHash,
        annotations,
        schemaChanges,
        sideEffectRisk: risk,
        blockers: [],
        requiredConfirmations,
      };
      return replayPreflightSchema.parse({
        ...preflightWithoutDigest,
        digest: digestFor(preflightWithoutDigest),
      });
    },
  };
}
