import {
  authoringDraftExecutionDetailSchema,
  authoringDraftExecutionSummarySchema,
  type AuthoringDraftExecutionDetail,
  type AuthoringDraftExecutionStatus,
  type AuthoringDraftExecutionSummary,
  type AuthoringDraftExecutionTestCase,
} from "../../shared/authoring/execution.js";
import type { JsonObject } from "../../shared/tool-definition.js";
import type { ProjectStore } from "../projects/project-store.js";

interface ExecutionRow {
  id: string; project_id: string; draft_id: string; draft_revision: number; definition_digest: string;
  idempotency_key: string; request_hash: string; status: AuthoringDraftExecutionStatus; inputs_json: string;
  result_json: string | null; error_json: string | null; cancel_requested: number; created_at: string;
  started_at: string | null; completed_at: string | null; duration_ms: number | null;
}

const columns = `id, project_id, draft_id, draft_revision, definition_digest, idempotency_key,
  request_hash, status, inputs_json, result_json, error_json, cancel_requested, created_at,
  started_at, completed_at, duration_ms`;
const activeStatuses = "'QUEUED','VALIDATING','RUNNING_SETUP','RUNNING_STEPS','RUNNING_ASSERTIONS','RUNNING_CLEANUP'";

function parseObject(value: string, label: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    return parsed as JsonObject;
  } catch { throw new Error(`Stored Authoring Draft execution ${label} is corrupt`); }
}

function detail(row: ExecutionRow): AuthoringDraftExecutionDetail {
  const stored = parseObject(row.inputs_json, "inputs") as {
    validationDigest?: unknown; testInputs?: unknown;
  };
  const result = row.result_json === null ? {} : parseObject(row.result_json, "result");
  const error = row.error_json === null ? null : parseObject(row.error_json, "error");
  return authoringDraftExecutionDetailSchema.parse({
    id: row.id, projectId: row.project_id, draftId: row.draft_id, draftRevision: row.draft_revision,
    definitionDigest: row.definition_digest, validationDigest: stored.validationDigest,
    status: row.status, inputs: stored.testInputs ?? {}, testCases: result.testCases ?? [], error,
    createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at,
    durationMs: row.duration_ms,
  });
}

function summary(row: ExecutionRow): AuthoringDraftExecutionSummary {
  const { inputs: _inputs, testCases: _testCases, error: _error, ...value } = detail(row);
  return authoringDraftExecutionSummarySchema.parse(value);
}

export class AuthoringDraftExecutionRepository {
  constructor(private readonly store: ProjectStore) {}

  get(projectId: string, executionId: string): AuthoringDraftExecutionDetail | null {
    const row = this.store.database.prepare(`SELECT ${columns} FROM authoring_draft_executions
      WHERE project_id = ? AND id = ?`).get(projectId, executionId) as ExecutionRow | undefined;
    return row === undefined ? null : detail(row);
  }

  list(projectId: string, draftId: string | undefined, limit: number): AuthoringDraftExecutionSummary[] {
    const rows = this.store.database.prepare(`SELECT ${columns} FROM authoring_draft_executions
      WHERE project_id = ? ${draftId === undefined ? "" : "AND draft_id = ?"}
      ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...(draftId === undefined ? [projectId, limit] : [projectId, draftId, limit])) as ExecutionRow[];
    return rows.map(summary);
  }

  create(input: {
    id: string; projectId: string; draftId: string; draftRevision: number; definitionDigest: string;
    validationDigest: string; idempotencyKey: string; requestHash: string;
    inputs: Record<string, JsonObject>; createdAt: string;
  }): { created: boolean; execution: AuthoringDraftExecutionSummary } {
    return this.store.database.transaction(() => {
      const existing = this.store.database.prepare(`SELECT ${columns} FROM authoring_draft_executions
        WHERE project_id = ? AND idempotency_key = ?`).get(input.projectId, input.idempotencyKey) as ExecutionRow | undefined;
      if (existing !== undefined) {
        if (existing.request_hash !== input.requestHash) throw new AuthoringDraftExecutionRepositoryConflictError();
        return { created: false, execution: summary(existing) };
      }
      const active = this.store.database.prepare(`SELECT 1 FROM authoring_draft_executions
        WHERE project_id = ? AND draft_id = ? AND status IN (${activeStatuses})`)
        .get(input.projectId, input.draftId);
      if (active !== undefined) throw new AuthoringDraftExecutionRepositoryActiveError();
      this.store.database.prepare(`INSERT INTO authoring_draft_executions
        (id, project_id, draft_id, draft_revision, definition_digest, idempotency_key, request_hash,
         status, inputs_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?)`)
        .run(input.id, input.projectId, input.draftId, input.draftRevision, input.definitionDigest,
          input.idempotencyKey, input.requestHash,
          JSON.stringify({ validationDigest: input.validationDigest, testInputs: input.inputs }), input.createdAt);
      return { created: true, execution: summary(this.row(input.projectId, input.id)) };
    }).immediate();
  }

  transition(projectId: string, executionId: string, status: AuthoringDraftExecutionStatus, timestamp: string): boolean {
    const startedAt = status === "VALIDATING" ? timestamp : null;
    return this.store.database.prepare(`UPDATE authoring_draft_executions
      SET status = ?, started_at = COALESCE(started_at, ?)
      WHERE project_id = ? AND id = ? AND status IN (${activeStatuses}) AND cancel_requested = 0`)
      .run(status, startedAt, projectId, executionId).changes === 1;
  }

  complete(input: { projectId: string; executionId: string; status: "PASSED" | "FAILED" | "ERROR";
    testCases: AuthoringDraftExecutionTestCase[]; error: { code: string; message: string } | null;
    completedAt: string; durationMs: number }): boolean {
    return this.store.database.prepare(`UPDATE authoring_draft_executions
      SET status = ?, result_json = ?, error_json = ?, completed_at = ?, duration_ms = ?
      WHERE project_id = ? AND id = ? AND status IN (${activeStatuses}) AND cancel_requested = 0`)
      .run(input.status, JSON.stringify({ testCases: input.testCases }),
        input.error === null ? null : JSON.stringify(input.error), input.completedAt, input.durationMs,
        input.projectId, input.executionId).changes === 1;
  }

  cancel(projectId: string, executionId: string, completedAt: string, durationMs: number): boolean {
    return this.store.database.prepare(`UPDATE authoring_draft_executions
      SET status = 'CANCELLED', cancel_requested = 1, completed_at = ?, duration_ms = ?
      WHERE project_id = ? AND id = ? AND status IN (${activeStatuses})`)
      .run(completedAt, durationMs, projectId, executionId).changes === 1;
  }

  recordCancelledResult(projectId: string, executionId: string,
    testCases: AuthoringDraftExecutionTestCase[]): void {
    this.store.database.prepare(`UPDATE authoring_draft_executions SET result_json = ?
      WHERE project_id = ? AND id = ? AND status = 'CANCELLED' AND cancel_requested = 1`)
      .run(JSON.stringify({ testCases }), projectId, executionId);
  }

  interruptActive(projectId: string, completedAt: string): number {
    return this.store.database.prepare(`UPDATE authoring_draft_executions
      SET status = 'INTERRUPTED', error_json = ?, completed_at = ?,
          duration_ms = MAX(0, CAST((julianday(?) - julianday(created_at)) * 86400000 AS INTEGER))
      WHERE project_id = ? AND status IN (${activeStatuses})`)
      .run(JSON.stringify({ code: "AUTHORING_RESTARTED", message: "Draft execution was interrupted by restart" }),
        completedAt, completedAt, projectId).changes;
  }

  private row(projectId: string, executionId: string): ExecutionRow {
    return this.store.database.prepare(`SELECT ${columns} FROM authoring_draft_executions
      WHERE project_id = ? AND id = ?`).get(projectId, executionId) as ExecutionRow;
  }
}

export class AuthoringDraftExecutionRepositoryConflictError extends Error {}
export class AuthoringDraftExecutionRepositoryActiveError extends Error {}
