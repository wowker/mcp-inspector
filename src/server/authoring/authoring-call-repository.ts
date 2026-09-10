import type { JsonObject, JsonValue } from "../../shared/tool-definition.js";
import type {
  AuthoringCallContext,
  AuthoringCallPurpose,
  AuthoringCallStatus,
} from "../../shared/authoring/calls.js";
import type { ProjectStore } from "../projects/project-store.js";

interface CallRow {
  id: string;
  project_id: string;
  context_kind: AuthoringCallContext["kind"];
  context_label: string | null;
  draft_id: string | null;
  draft_revision: number | null;
  connection_id: string;
  tool_name: string;
  tool_snapshot_id: string | null;
  tool_schema_hash: string;
  purpose: AuthoringCallPurpose;
  cleanup_for_call_id: string | null;
  run_id: string | null;
  idempotency_key: string;
  request_hash: string;
  arguments_json: string;
  status: AuthoringCallStatus;
  may_have_side_effects: number;
  summary_json: string | null;
  error_json: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface StoredAuthoringCall {
  id: string;
  projectId: string;
  context: AuthoringCallContext;
  connectionId: string;
  toolName: string;
  toolSnapshotId: string | null;
  toolSchemaHash: string;
  purpose: AuthoringCallPurpose;
  cleanupForCallId: string | null;
  runId: string | null;
  idempotencyKey: string;
  requestHash: string;
  arguments: JsonObject;
  status: AuthoringCallStatus;
  mayHaveSideEffects: boolean;
  summary: JsonValue | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

export type ClaimAuthoringCallResult =
  | { kind: "created"; call: StoredAuthoringCall }
  | { kind: "existing"; call: StoredAuthoringCall }
  | { kind: "rate-limited" }
  | { kind: "concurrency-limited" };

const columns = `id, project_id, context_kind, context_label, draft_id, draft_revision,
  connection_id, tool_name, tool_snapshot_id, tool_schema_hash, purpose, cleanup_for_call_id,
  run_id, idempotency_key, request_hash, arguments_json, status, may_have_side_effects,
  summary_json, error_json, created_at, started_at, completed_at, duration_ms`;

function parseJson(value: string | null, label: string): unknown {
  if (value === null) return null;
  try { return JSON.parse(value) as unknown; }
  catch { throw new Error(`Stored Authoring call ${label} is corrupt`); }
}

function callFromRow(row: CallRow): StoredAuthoringCall {
  const argumentsValue = parseJson(row.arguments_json, "arguments");
  const errorValue = parseJson(row.error_json, "error");
  if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
    throw new Error("Stored Authoring call arguments are invalid");
  }
  if (errorValue !== null && (typeof errorValue !== "object" || Array.isArray(errorValue) ||
      typeof (errorValue as Record<string, unknown>).code !== "string" ||
      typeof (errorValue as Record<string, unknown>).message !== "string")) {
    throw new Error("Stored Authoring call error is invalid");
  }
  const context: AuthoringCallContext = row.context_kind === "STANDALONE"
    ? { kind: "STANDALONE", ...(row.context_label === null ? {} : { label: row.context_label }) }
    : { kind: "DRAFT", draftId: row.draft_id!, draftRevision: row.draft_revision! };
  return {
    id: row.id, projectId: row.project_id, context, connectionId: row.connection_id,
    toolName: row.tool_name, toolSnapshotId: row.tool_snapshot_id, toolSchemaHash: row.tool_schema_hash,
    purpose: row.purpose, cleanupForCallId: row.cleanup_for_call_id, runId: row.run_id,
    idempotencyKey: row.idempotency_key, requestHash: row.request_hash,
    arguments: argumentsValue as JsonObject, status: row.status,
    mayHaveSideEffects: row.may_have_side_effects === 1,
    summary: parseJson(row.summary_json, "summary") as JsonValue | null,
    error: errorValue as { code: string; message: string } | null,
    createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at,
    durationMs: row.duration_ms,
  };
}

export class AuthoringCallRepository {
  constructor(private readonly store: ProjectStore) {}

  get(projectId: string, callId: string): StoredAuthoringCall | null {
    const row = this.store.database.prepare(`SELECT ${columns} FROM authoring_tool_calls
      WHERE project_id = ? AND id = ?`).get(projectId, callId) as CallRow | undefined;
    return row === undefined ? null : callFromRow(row);
  }

  findByIdempotency(projectId: string, idempotencyKey: string): StoredAuthoringCall | null {
    const row = this.store.database.prepare(`SELECT ${columns} FROM authoring_tool_calls
      WHERE project_id = ? AND idempotency_key = ?`).get(projectId, idempotencyKey) as CallRow | undefined;
    return row === undefined ? null : callFromRow(row);
  }

  findUnknownByRequestHash(projectId: string, requestHash: string): StoredAuthoringCall | null {
    const row = this.store.database.prepare(`SELECT ${columns} FROM authoring_tool_calls
      WHERE project_id = ? AND request_hash = ? AND status = 'UNKNOWN'
      ORDER BY created_at DESC, id DESC LIMIT 1`).get(projectId, requestHash) as CallRow | undefined;
    return row === undefined ? null : callFromRow(row);
  }

  claim(input: {
    id: string;
    projectId: string;
    context: AuthoringCallContext;
    connectionId: string;
    toolName: string;
    toolSnapshotId: string;
    toolSchemaHash: string;
    purpose: AuthoringCallPurpose;
    cleanupForCallId: string | null;
    idempotencyKey: string;
    requestHash: string;
    sanitizedArgumentsJson: string;
    mayHaveSideEffects: boolean;
    createdAt: string;
    rateWindowStart: string;
    maxCallsPerMinute: number;
    maxConcurrentCalls: number;
  }): ClaimAuthoringCallResult {
    return this.store.database.transaction((): ClaimAuthoringCallResult => {
      const existing = this.store.database.prepare(`SELECT ${columns} FROM authoring_tool_calls
        WHERE project_id = ? AND idempotency_key = ?`).get(input.projectId, input.idempotencyKey) as CallRow | undefined;
      if (existing !== undefined) return { kind: "existing", call: callFromRow(existing) };
      const recent = this.store.database.prepare(`SELECT count(*) AS count FROM authoring_tool_calls
        WHERE project_id = ? AND connection_id = ? AND created_at >= ?`)
        .get(input.projectId, input.connectionId, input.rateWindowStart) as { count: number };
      if (recent.count >= input.maxCallsPerMinute) return { kind: "rate-limited" };
      const active = this.store.database.prepare(`SELECT count(*) AS count FROM authoring_tool_calls
        WHERE project_id = ? AND connection_id = ? AND status IN ('PENDING', 'RUNNING')`)
        .get(input.projectId, input.connectionId) as { count: number };
      if (active.count >= input.maxConcurrentCalls) return { kind: "concurrency-limited" };
      this.store.database.prepare(`INSERT INTO authoring_tool_calls
        (id, project_id, context_kind, context_label, draft_id, draft_revision, connection_id,
         tool_name, tool_snapshot_id, tool_schema_hash, purpose, cleanup_for_call_id,
         run_id, idempotency_key, request_hash, arguments_json, status, may_have_side_effects, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'PENDING', ?, ?)`)
        .run(input.id, input.projectId, input.context.kind,
          input.context.kind === "STANDALONE" ? input.context.label ?? null : null,
          input.context.kind === "DRAFT" ? input.context.draftId : null,
          input.context.kind === "DRAFT" ? input.context.draftRevision : null,
          input.connectionId, input.toolName, input.toolSnapshotId, input.toolSchemaHash,
          input.purpose, input.cleanupForCallId, input.idempotencyKey, input.requestHash,
          input.sanitizedArgumentsJson, Number(input.mayHaveSideEffects), input.createdAt);
      const created = this.get(input.projectId, input.id);
      if (created === null) throw new Error("Authoring call was not persisted");
      return { kind: "created", call: created };
    }).immediate();
  }

  markRunning(projectId: string, callId: string, runId: string, startedAt: string): StoredAuthoringCall {
    const changed = this.store.database.prepare(`UPDATE authoring_tool_calls
      SET status = 'RUNNING', run_id = ?, started_at = ?
      WHERE project_id = ? AND id = ? AND status = 'PENDING'`)
      .run(runId, startedAt, projectId, callId);
    if (changed.changes !== 1) throw new Error("Authoring call could not start");
    return this.get(projectId, callId)!;
  }

  finish(input: {
    projectId: string;
    callId: string;
    status: Exclude<AuthoringCallStatus, "PENDING" | "RUNNING">;
    summary: JsonValue | null;
    error: { code: string; message: string } | null;
    completedAt: string;
    durationMs: number;
  }): StoredAuthoringCall {
    const changed = this.store.database.prepare(`UPDATE authoring_tool_calls
      SET status = ?, summary_json = ?, error_json = ?, completed_at = ?, duration_ms = ?
      WHERE project_id = ? AND id = ? AND status IN ('PENDING', 'RUNNING')`)
      .run(input.status, input.summary === null ? null : JSON.stringify(input.summary),
        input.error === null ? null : JSON.stringify(input.error), input.completedAt, input.durationMs,
        input.projectId, input.callId);
    if (changed.changes !== 1) {
      const current = this.get(input.projectId, input.callId);
      if (current !== null && current.status === input.status) return current;
      throw new Error("Authoring call could not finish");
    }
    return this.get(input.projectId, input.callId)!;
  }
}
