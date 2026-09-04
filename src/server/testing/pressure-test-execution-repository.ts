import {
  parsePressureTestExecution,
  pressureTestSampleSchema,
  type PressureTestDefinition,
  type PressureTestExecution,
  type PressureTestExecutionStatus,
  type PressureTestExecutionSummary,
  type PressureTestSample,
  type PressureTestTargetSnapshot,
} from "../../shared/testing/pressure-test.js";
import type { ProjectStore } from "../projects/project-store.js";

interface ExecutionRow {
  id: string;
  project_id: string;
  pressure_test_id: string;
  pressure_test_revision: number;
  request_hash: string;
  status: string;
  definition_snapshot_json: string;
  target_snapshot_json: string;
  summary_json: string | null;
  error_json: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
}

interface SampleRow {
  id: string;
  project_id: string;
  pressure_test_execution_id: string;
  test_execution_id: string;
  virtual_user: number;
  iteration: number;
  status: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  error_json: string | null;
}

const executionColumns = `id, project_id, pressure_test_id, pressure_test_revision, request_hash,
  status, definition_snapshot_json, target_snapshot_json, summary_json, error_json, created_at,
  started_at, completed_at, duration_ms`;

function json(value: string | null): unknown {
  if (value === null) return null;
  try { return JSON.parse(value); }
  catch { throw new Error("Stored pressure test execution is corrupt"); }
}

function executionFromRow(row: ExecutionRow): PressureTestExecution {
  try {
    return parsePressureTestExecution({
      id: row.id,
      projectId: row.project_id,
      pressureTestId: row.pressure_test_id,
      pressureTestRevision: row.pressure_test_revision,
      definitionSnapshot: json(row.definition_snapshot_json),
      targetSnapshot: json(row.target_snapshot_json),
      status: row.status,
      summary: json(row.summary_json),
      error: json(row.error_json),
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
    });
  } catch { throw new Error("Stored pressure test execution is corrupt"); }
}

function sampleFromRow(row: SampleRow): PressureTestSample {
  try {
    return pressureTestSampleSchema.parse({
      id: row.id,
      projectId: row.project_id,
      pressureTestExecutionId: row.pressure_test_execution_id,
      testExecutionId: row.test_execution_id,
      virtualUser: row.virtual_user,
      iteration: row.iteration,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      error: json(row.error_json),
    });
  } catch { throw new Error("Stored pressure test sample is corrupt"); }
}

export class PressureTestExecutionRepository {
  constructor(private readonly store: ProjectStore) {}

  interruptActive(projectId: string, completedAt: string): number {
    return this.store.database.prepare(`UPDATE pressure_test_executions SET status = 'INTERRUPTED',
      error_json = '{"code":"PROCESS_RESTARTED","message":"Pressure test was interrupted by a process restart"}',
      completed_at = ?, duration_ms = max(0, CAST((julianday(?) - julianday(created_at)) * 86400000 AS INTEGER))
      WHERE project_id = ? AND status IN ('QUEUED', 'RUNNING')`)
      .run(completedAt, completedAt, projectId).changes;
  }

  get(projectId: string, executionId: string): PressureTestExecution | null {
    const row = this.store.database.prepare(`SELECT ${executionColumns} FROM pressure_test_executions
      WHERE project_id = ? AND id = ?`).get(projectId, executionId) as ExecutionRow | undefined;
    return row === undefined ? null : executionFromRow(row);
  }

  getByIdempotencyKey(projectId: string, idempotencyKey: string): PressureTestExecution | null {
    const row = this.store.database.prepare(`SELECT ${executionColumns} FROM pressure_test_executions
      WHERE project_id = ? AND idempotency_key = ?`).get(projectId, idempotencyKey) as ExecutionRow | undefined;
    return row === undefined ? null : executionFromRow(row);
  }

  list(projectId: string, pressureTestId: string | undefined, limit: number,
    cursor?: { createdAt: string; id: string }): {
      items: PressureTestExecution[];
      next: { createdAt: string; id: string } | null;
    } {
    const filter = pressureTestId === undefined ? "" : " AND pressure_test_id = ?";
    const position = cursor === undefined ? "" : " AND (created_at < ? OR (created_at = ? AND id < ?))";
    const parameters: unknown[] = [projectId];
    if (pressureTestId !== undefined) parameters.push(pressureTestId);
    if (cursor !== undefined) parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
    parameters.push(limit + 1);
    const rows = this.store.database.prepare(`SELECT ${executionColumns} FROM pressure_test_executions
      WHERE project_id = ?${filter}${position} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...parameters) as ExecutionRow[];
    const items = rows.slice(0, limit).map(executionFromRow);
    const last = items.at(-1);
    return { items, next: rows.length > limit && last !== undefined
      ? { createdAt: last.createdAt, id: last.id } : null };
  }

  hasActive(projectId: string): boolean {
    return this.store.database.prepare(`SELECT 1 FROM pressure_test_executions
      WHERE project_id = ? AND status IN ('QUEUED', 'RUNNING') LIMIT 1`).get(projectId) !== undefined;
  }

  insert(input: {
    id: string;
    projectId: string;
    definition: PressureTestDefinition;
    targetSnapshot: PressureTestTargetSnapshot;
    idempotencyKey: string;
    requestHash: string;
    createdAt: string;
  }): PressureTestExecution {
    this.store.database.prepare(`INSERT INTO pressure_test_executions
      (id, project_id, pressure_test_id, pressure_test_revision, idempotency_key, request_hash, status,
       definition_snapshot_json, target_snapshot_json, summary_json, error_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, NULL, NULL, ?)`).run(
      input.id, input.projectId, input.definition.id, input.definition.revision, input.idempotencyKey,
      input.requestHash, JSON.stringify(input.definition), JSON.stringify(input.targetSnapshot), input.createdAt,
    );
    const result = this.get(input.projectId, input.id);
    if (result === null) throw new Error("Pressure test execution insert failed");
    return result;
  }

  begin(projectId: string, executionId: string, startedAt: string): boolean {
    return this.store.database.prepare(`UPDATE pressure_test_executions SET status = 'RUNNING', started_at = ?
      WHERE project_id = ? AND id = ? AND status = 'QUEUED'`)
      .run(startedAt, projectId, executionId).changes === 1;
  }

  appendSample(sample: PressureTestSample): void {
    this.store.database.prepare(`INSERT INTO pressure_test_samples
      (id, project_id, pressure_test_execution_id, test_execution_id, virtual_user, iteration,
       status, started_at, completed_at, duration_ms, error_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      sample.id, sample.projectId, sample.pressureTestExecutionId, sample.testExecutionId,
      sample.virtualUser, sample.iteration, sample.status, sample.startedAt, sample.completedAt,
      sample.durationMs, sample.error === null ? null : JSON.stringify(sample.error),
    );
  }

  listSamples(projectId: string, executionId: string, limit: number, afterIteration = 0): {
    items: PressureTestSample[];
    nextIteration: number | null;
  } {
    const rows = this.store.database.prepare(`SELECT id, project_id, pressure_test_execution_id,
      test_execution_id, virtual_user, iteration, status, started_at, completed_at, duration_ms, error_json
      FROM pressure_test_samples WHERE project_id = ? AND pressure_test_execution_id = ? AND iteration > ?
      ORDER BY iteration LIMIT ?`).all(projectId, executionId, afterIteration, limit + 1) as SampleRow[];
    const items = rows.slice(0, limit).map(sampleFromRow);
    return { items, nextIteration: rows.length > limit ? items.at(-1)?.iteration ?? null : null };
  }

  allSamples(projectId: string, executionId: string): PressureTestSample[] {
    return (this.store.database.prepare(`SELECT id, project_id, pressure_test_execution_id,
      test_execution_id, virtual_user, iteration, status, started_at, completed_at, duration_ms, error_json
      FROM pressure_test_samples WHERE project_id = ? AND pressure_test_execution_id = ? ORDER BY iteration`)
      .all(projectId, executionId) as SampleRow[]).map(sampleFromRow);
  }

  complete(projectId: string, executionId: string, input: {
    status: Extract<PressureTestExecutionStatus, "PASSED" | "FAILED" | "ERROR">;
    summary: PressureTestExecutionSummary | null;
    error: { code: string; message: string } | null;
    completedAt: string;
    durationMs: number;
  }): boolean {
    return this.store.database.prepare(`UPDATE pressure_test_executions SET status = ?, summary_json = ?,
      error_json = ?, completed_at = ?, duration_ms = ?
      WHERE project_id = ? AND id = ? AND status IN ('QUEUED', 'RUNNING')`).run(
      input.status, input.summary === null ? null : JSON.stringify(input.summary),
      input.error === null ? null : JSON.stringify(input.error), input.completedAt, input.durationMs,
      projectId, executionId,
    ).changes === 1;
  }

  cancel(projectId: string, executionId: string, completedAt: string, durationMs: number): boolean {
    return this.store.database.prepare(`UPDATE pressure_test_executions SET status = 'CANCELLED',
      completed_at = ?, duration_ms = ? WHERE project_id = ? AND id = ? AND status IN ('QUEUED', 'RUNNING')`)
      .run(completedAt, durationMs, projectId, executionId).changes === 1;
  }
}
