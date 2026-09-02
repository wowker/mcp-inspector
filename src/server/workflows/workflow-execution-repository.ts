import type { JsonObject, JsonValue } from "../../shared/tool-definition.js";
import type { ProjectStore } from "../projects/project-store.js";

export type WorkflowPhase = "queued" | "before" | "main" | "after";
export type WorkflowTerminalStatus = "succeeded" | "failed" | "cancelled" | "interrupted";
export type WorkflowStatus = WorkflowPhase | WorkflowTerminalStatus;

export interface WorkflowExecutionEvent {
  executionId: string;
  sequence: number;
  kind: string;
  occurredAt: string;
  payload: JsonValue;
}

export interface WorkflowExecutionDetail {
  id: string;
  projectId: string;
  connectionId: string;
  tabId: string | null;
  toolName: string;
  toolSnapshotId: string;
  idempotencyKey: string;
  status: WorkflowStatus;
  initialArguments: JsonObject;
  finalArguments: JsonObject | null;
  workflowSnapshot: JsonObject;
  response: JsonValue | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  runs: Array<{ runId: string; phase: "helper-before" | "main" | "helper-after"; ordinal: number; sourceLine: number | null }>;
  events: WorkflowExecutionEvent[];
}

interface ExecutionRow {
  id: string; project_id: string; connection_id: string; tab_id: string | null; tool_name: string;
  tool_snapshot_id: string; idempotency_key: string; status: WorkflowStatus;
  initial_arguments_json: string; final_arguments_json: string | null; workflow_snapshot_json: string;
  response_json: string | null; error_json: string | null; created_at: string; started_at: string | null;
  completed_at: string | null; duration_ms: number | null;
}

interface RunRow { run_id: string; phase: "helper-before" | "main" | "helper-after"; ordinal: number; source_line: number | null }
interface EventRow { execution_id: string; sequence: number; kind: string; occurred_at: string; payload_json: string }

const active: WorkflowStatus[] = ["queued", "before", "main", "after"];

function detail(row: ExecutionRow, runs: RunRow[], events: EventRow[]): WorkflowExecutionDetail {
  return {
    id: row.id,
    projectId: row.project_id,
    connectionId: row.connection_id,
    tabId: row.tab_id,
    toolName: row.tool_name,
    toolSnapshotId: row.tool_snapshot_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    initialArguments: JSON.parse(row.initial_arguments_json) as JsonObject,
    finalArguments: row.final_arguments_json === null ? null : JSON.parse(row.final_arguments_json) as JsonObject,
    workflowSnapshot: JSON.parse(row.workflow_snapshot_json) as JsonObject,
    response: row.response_json === null ? null : JSON.parse(row.response_json) as JsonValue,
    error: row.error_json === null ? null : JSON.parse(row.error_json) as { code: string; message: string },
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    runs: runs.map((item) => ({ runId: item.run_id, phase: item.phase, ordinal: item.ordinal, sourceLine: item.source_line })),
    events: events.map((item) => ({
      executionId: item.execution_id,
      sequence: item.sequence,
      kind: item.kind,
      occurredAt: item.occurred_at,
      payload: JSON.parse(item.payload_json) as JsonValue,
    })),
  };
}

export class WorkflowExecutionRepository {
  constructor(private readonly store: ProjectStore) {}

  create(input: {
    id: string; projectId: string; connectionId: string; tabId: string | null; toolName: string; toolSnapshotId: string;
    idempotencyKey: string; initialArguments: JsonObject; workflowSnapshot: JsonObject; createdAt: string;
  }): { execution: WorkflowExecutionDetail; created: boolean } {
    return this.store.database.transaction(() => {
      const inserted = this.store.database.prepare(`INSERT INTO workflow_executions
        (id, project_id, connection_id, tab_id, tool_name, tool_snapshot_id, idempotency_key, status,
         initial_arguments_json, workflow_snapshot_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
        ON CONFLICT(project_id, idempotency_key) DO NOTHING`).run(
          input.id, input.projectId, input.connectionId, input.tabId, input.toolName, input.toolSnapshotId,
          input.idempotencyKey, JSON.stringify(input.initialArguments), JSON.stringify(input.workflowSnapshot), input.createdAt,
        );
      const execution = inserted.changes === 1
        ? this.get(input.projectId, input.id)
        : this.byIdempotency(input.projectId, input.idempotencyKey);
      if (execution === null) throw new Error("Workflow execution could not be read");
      if (inserted.changes === 1) {
        this.append(input.projectId, input.id, "workflow-status", input.createdAt, { status: "queued" });
      }
      return { execution: this.get(input.projectId, execution.id)!, created: inserted.changes === 1 };
    })();
  }

  private byIdempotency(projectId: string, key: string): WorkflowExecutionDetail | null {
    const row = this.store.database.prepare("SELECT id FROM workflow_executions WHERE project_id = ? AND idempotency_key = ?")
      .get(projectId, key) as { id: string } | undefined;
    return row === undefined ? null : this.get(projectId, row.id);
  }

  get(projectId: string, id: string): WorkflowExecutionDetail | null {
    const row = this.store.database.prepare("SELECT * FROM workflow_executions WHERE project_id = ? AND id = ?")
      .get(projectId, id) as ExecutionRow | undefined;
    if (row === undefined) return null;
    const runs = this.store.database.prepare(`SELECT run_id, phase, ordinal, source_line
      FROM workflow_execution_runs WHERE project_id = ? AND execution_id = ? ORDER BY ordinal`)
      .all(projectId, id) as RunRow[];
    const events = this.store.database.prepare(`SELECT execution_id, sequence, kind, occurred_at, payload_json
      FROM workflow_events WHERE project_id = ? AND execution_id = ? ORDER BY sequence`)
      .all(projectId, id) as EventRow[];
    return detail(row, runs, events);
  }

  activeForTab(projectId: string, tabId: string): WorkflowExecutionDetail | null {
    const row = this.store.database.prepare(`SELECT id FROM workflow_executions
      WHERE project_id = ? AND tab_id = ? AND status IN ('queued', 'before', 'main', 'after')
      ORDER BY created_at DESC, id DESC LIMIT 1`).get(projectId, tabId) as { id: string } | undefined;
    return row === undefined ? null : this.get(projectId, row.id);
  }

  interruptActive(projectId: string, at: string): number {
    const rows = this.store.database.prepare(`SELECT id, created_at, initial_arguments_json, response_json
      FROM workflow_executions WHERE project_id = ? AND status IN ('queued', 'before', 'main', 'after')`)
      .all(projectId) as Array<{ id: string; created_at: string; initial_arguments_json: string; response_json: string | null }>;
    let interrupted = 0;
    for (const row of rows) {
      const duration = Math.max(0, Date.parse(at) - Date.parse(row.created_at));
      if (this.finish(projectId, row.id, "interrupted", at, Number.isFinite(duration) ? duration : 0,
        JSON.parse(row.initial_arguments_json) as JsonObject,
        row.response_json === null ? null : JSON.parse(row.response_json) as JsonValue,
        { code: "PROCESS_RESTARTED", message: "Workflow execution was interrupted by Inspector restart" })) {
        interrupted += 1;
      }
    }
    return interrupted;
  }

  transition(projectId: string, id: string, from: WorkflowStatus[], to: WorkflowPhase, at: string): boolean {
    return this.store.database.transaction(() => {
      const placeholders = from.map(() => "?").join(",");
      const changed = this.store.database.prepare(`UPDATE workflow_executions SET status = ?,
        started_at = COALESCE(started_at, ?) WHERE project_id = ? AND id = ? AND status IN (${placeholders})`)
        .run(to, at, projectId, id, ...from).changes === 1;
      if (changed) this.append(projectId, id, "workflow-status", at, { status: to });
      return changed;
    })();
  }

  linkRun(projectId: string, id: string, runId: string,
    phase: "helper-before" | "main" | "helper-after", ordinal: number, at: string): void {
    this.store.database.transaction(() => {
      this.store.database.prepare(`INSERT INTO workflow_execution_runs
        (project_id, execution_id, run_id, phase, ordinal, source_line) VALUES (?, ?, ?, ?, ?, NULL)`)
        .run(projectId, id, runId, phase, ordinal);
      this.append(projectId, id, "run-linked", at, { runId, phase, ordinal });
    })();
  }

  append(projectId: string, id: string, kind: string, at: string, payload: JsonValue): WorkflowExecutionEvent {
    return this.store.database.transaction(() => {
      const next = this.store.database.prepare(`SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
        FROM workflow_events WHERE execution_id = ?`).get(id) as { sequence: number };
      this.store.database.prepare(`INSERT INTO workflow_events
        (project_id, execution_id, sequence, kind, occurred_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(projectId, id, next.sequence, kind, at, JSON.stringify(payload));
      return { executionId: id, sequence: next.sequence, kind, occurredAt: at, payload };
    })();
  }

  finish(projectId: string, id: string, status: WorkflowTerminalStatus, at: string, durationMs: number,
    finalArguments: JsonObject, response: JsonValue | null, error: { code: string; message: string } | null): boolean {
    return this.store.database.transaction(() => {
      const placeholders = active.map(() => "?").join(",");
      const changed = this.store.database.prepare(`UPDATE workflow_executions SET status = ?, final_arguments_json = ?,
        response_json = ?, error_json = ?, completed_at = ?, duration_ms = ?
        WHERE project_id = ? AND id = ? AND status IN (${placeholders})`).run(
          status, JSON.stringify(finalArguments), response === null ? null : JSON.stringify(response),
          error === null ? null : JSON.stringify(error), at, durationMs, projectId, id, ...active,
        ).changes === 1;
      if (changed) this.append(projectId, id, "workflow-status", at, { status, ...(error === null ? {} : { error }) });
      return changed;
    })();
  }
}
