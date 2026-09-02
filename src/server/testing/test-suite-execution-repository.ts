import type { ProjectStore } from "../projects/project-store.js";
import {
  parseTestSuiteExecutionDetail,
  type TestSuiteExecutionDetail,
  type TestSuiteExecutionSummary,
} from "../../shared/testing/test-suite-execution.js";
import { parseTestSuiteDefinition, type TestSuiteDefinition } from "../../shared/testing/test-suite.js";
import type { SuiteRunItem } from "./suite-runner.js";

interface ExecutionRow {
  id: string; project_id: string; suite_id: string; suite_revision: number;
  idempotency_key: string; request_hash: string; status: TestSuiteExecutionDetail["status"];
  suite_snapshot_json: string; summary_json: string | null; error_json: string | null;
  created_at: string; started_at: string | null; completed_at: string | null; duration_ms: number | null;
}

interface ItemRow {
  id: string; suite_execution_id: string; member_id: string;
  test_execution_id: string | null; position: number; status: TestSuiteExecutionDetail["status"];
}

function json(value: string, label: string): unknown {
  try { return JSON.parse(value); } catch { throw new Error(`Stored ${label} is corrupt`); }
}

function detail(row: ExecutionRow, items: ItemRow[]): TestSuiteExecutionDetail {
  const suiteSnapshot = parseTestSuiteDefinition(json(row.suite_snapshot_json, "suite snapshot"));
  const snapshotMembers = new Map(suiteSnapshot.members.map((member) => [member.id, member.testCaseId]));
  return parseTestSuiteExecutionDetail({
    id: row.id, projectId: row.project_id, suiteId: row.suite_id, suiteRevision: row.suite_revision,
    status: row.status, suiteSnapshot,
    summary: row.summary_json === null ? null : json(row.summary_json, "suite summary"),
    error: row.error_json === null ? null : json(row.error_json, "suite execution error"),
    createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at, durationMs: row.duration_ms,
    items: items.map((item) => ({
      id: item.id, suiteExecutionId: item.suite_execution_id, memberId: item.member_id,
      testCaseId: snapshotMembers.get(item.member_id), testExecutionId: item.test_execution_id,
      position: item.position, status: item.status,
    })),
  });
}

export class TestSuiteExecutionRepository {
  constructor(private readonly store: ProjectStore) {}

  create(input: { id: string; projectId: string; suite: TestSuiteDefinition; idempotencyKey: string;
    requestHash: string; createdAt: string; itemIds: Map<string, string> }): {
      execution: TestSuiteExecutionDetail; created: boolean; requestHash: string;
    } {
    return this.store.database.transaction(() => {
      const inserted = this.store.database.prepare(`INSERT INTO test_suite_executions
        (id, project_id, suite_id, suite_revision, idempotency_key, request_hash, status,
         suite_snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?)
        ON CONFLICT(project_id, idempotency_key) DO NOTHING`).run(
        input.id, input.projectId, input.suite.id, input.suite.revision, input.idempotencyKey,
        input.requestHash, JSON.stringify(input.suite), input.createdAt,
      );
      if (inserted.changes === 1) {
        const insertItem = this.store.database.prepare(`INSERT INTO test_suite_execution_items
          (id, project_id, suite_execution_id, member_id, position, status)
          VALUES (?, ?, ?, ?, ?, 'QUEUED')`);
        for (const member of input.suite.members.filter(({ isEnabled }) => isEnabled)) {
          insertItem.run(input.itemIds.get(member.id), input.projectId, input.id, member.id, member.position);
        }
      }
      const identity = inserted.changes === 1
        ? { id: input.id, request_hash: input.requestHash }
        : this.store.database.prepare(`SELECT id, request_hash FROM test_suite_executions
          WHERE project_id = ? AND idempotency_key = ?`).get(input.projectId, input.idempotencyKey) as
            { id: string; request_hash: string } | undefined;
      if (identity === undefined) throw new Error("Test suite execution could not be read");
      const execution = this.get(input.projectId, identity.id);
      if (execution === null) throw new Error("Test suite execution could not be read");
      return { execution, created: inserted.changes === 1, requestHash: identity.request_hash };
    })();
  }

  get(projectId: string, executionId: string): TestSuiteExecutionDetail | null {
    const row = this.store.database.prepare(`SELECT * FROM test_suite_executions
      WHERE project_id = ? AND id = ?`).get(projectId, executionId) as ExecutionRow | undefined;
    if (row === undefined) return null;
    const items = this.store.database.prepare(`SELECT * FROM test_suite_execution_items
      WHERE project_id = ? AND suite_execution_id = ? ORDER BY position, id`)
      .all(projectId, executionId) as ItemRow[];
    return detail(row, items);
  }

  begin(projectId: string, executionId: string, at: string): boolean {
    return this.store.database.prepare(`UPDATE test_suite_executions SET status = 'RUNNING', started_at = ?
      WHERE project_id = ? AND id = ? AND status = 'QUEUED'`).run(at, projectId, executionId).changes === 1;
  }

  complete(projectId: string, executionId: string, input: { status: SuiteRunItem["status"];
    completedAt: string; durationMs: number; summary: TestSuiteExecutionSummary;
    error: { code: string; message: string } | null; items: SuiteRunItem[] }): boolean {
    return this.store.database.transaction(() => {
      const changed = this.store.database.prepare(`UPDATE test_suite_executions SET status = ?, summary_json = ?,
        error_json = ?, completed_at = ?, duration_ms = ?
        WHERE project_id = ? AND id = ? AND status = 'RUNNING'`).run(
        input.status, JSON.stringify(input.summary), input.error === null ? null : JSON.stringify(input.error),
        input.completedAt, input.durationMs, projectId, executionId,
      ).changes === 1;
      if (!changed) return false;
      const update = this.store.database.prepare(`UPDATE test_suite_execution_items
        SET test_execution_id = ?, status = ?
        WHERE project_id = ? AND suite_execution_id = ? AND member_id = ?`);
      for (const item of input.items) {
        if (update.run(item.testExecutionId, item.status, projectId, executionId, item.memberId).changes !== 1) {
          throw new Error("Test suite execution item could not reach terminal state");
        }
      }
      return true;
    })();
  }

  cancel(projectId: string, executionId: string, at: string, durationMs: number): boolean {
    return this.store.database.transaction(() => {
      const itemCount = this.store.database.prepare(`SELECT COUNT(*) AS total
        FROM test_suite_execution_items WHERE project_id = ? AND suite_execution_id = ?`)
        .get(projectId, executionId) as { total: number };
      const changed = this.store.database.prepare(`UPDATE test_suite_executions SET status = 'CANCELLED',
        summary_json = ?, error_json = ?, completed_at = ?, duration_ms = ?
        WHERE project_id = ? AND id = ? AND status IN ('QUEUED', 'RUNNING')`).run(
        JSON.stringify({ total: itemCount.total, passed: 0, failed: 0, errors: 0, cancelled: itemCount.total }),
        JSON.stringify({ code: "CANCELLED", message: "Test suite execution was cancelled" }),
        at, durationMs, projectId, executionId,
      ).changes === 1;
      if (changed) this.store.database.prepare(`UPDATE test_suite_execution_items SET status = 'CANCELLED'
        WHERE project_id = ? AND suite_execution_id = ? AND status IN ('QUEUED', 'RUNNING')`)
        .run(projectId, executionId);
      return changed;
    })();
  }
}
