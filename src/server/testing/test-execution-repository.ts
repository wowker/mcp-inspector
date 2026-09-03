import type { AssertionResult } from "../../shared/testing/assertions.js";
import {
  parseTestExecutionDetail,
  testExecutionReportSummarySchema,
  type TestExecutionDetail,
  type TestExecutionReportSummary,
  type TestExecutionStatus,
} from "../../shared/testing/test-execution.js";
import { parseTestCaseDefinition, type TestCaseDefinition } from "../../shared/testing/test-case.js";
import type { JsonObject } from "../../shared/tool-definition.js";
import type { ProjectStore } from "../projects/project-store.js";

interface ExecutionRow {
  id: string; project_id: string; test_case_id: string; test_case_revision: number;
  idempotency_key: string; request_hash: string; status: TestExecutionStatus;
  definition_snapshot_json: string; inputs_json: string; error_json: string | null;
  created_at: string; started_at: string | null; completed_at: string | null; duration_ms: number | null;
}

interface StepRow {
  id: string; execution_id: string; step_id: string; position: number; attempt: number;
  status: "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "ERROR" | "SKIPPED" | "CANCELLED";
  run_id: string | null; workflow_execution_id: string | null; resolved_arguments_json: string | null;
  error_json: string | null; started_at: string | null; completed_at: string | null; duration_ms: number | null;
}

interface AssertionRow {
  id: string; execution_id: string; step_record_id: string | null; assertion_id: string; position: number;
  status: "PASSED" | "FAILED" | "ERROR"; definition_json: string; resolved_path: string | null;
  actual_summary_json: string | null; expected_summary_json: string | null; error_code: string | null;
  message: string | null; duration_ms: number; redacted: number;
}

interface ReportSummaryRow extends ExecutionRow {
  assertion_total: number;
  assertion_passed: number;
  assertion_failed: number;
  assertion_error: number;
}

export interface TestExecutionCursorPosition { createdAt: string; id: string }
export interface TestExecutionRepositoryPage {
  items: TestExecutionReportSummary[];
  next: TestExecutionCursorPosition | null;
}

export interface CreateTestExecutionRecord {
  id: string;
  projectId: string;
  testCase: TestCaseDefinition;
  idempotencyKey: string;
  requestHash: string;
  inputs: JsonObject;
  createdAt: string;
}

export interface CompleteTestExecutionRecord {
  status: "PASSED" | "FAILED" | "ERROR";
  stepStatus: "PASSED" | "FAILED" | "ERROR";
  completedAt: string;
  durationMs: number;
  error: { code: string; message: string } | null;
  assertions: AssertionResult[];
}

export interface ScenarioStepExecutionRecord {
  id: string;
  stepId: string;
  position: number;
  attempt: number;
  status: "PASSED" | "FAILED" | "ERROR" | "SKIPPED" | "CANCELLED";
  runId: string | null;
  workflowExecutionId: string | null;
  argumentsValue: JsonObject | null;
  error: { code: string; message: string } | null;
  assertions: AssertionResult[];
}

export interface CompleteScenarioExecutionRecord {
  status: "PASSED" | "FAILED" | "ERROR";
  completedAt: string;
  durationMs: number;
  error: { code: string; message: string } | null;
  steps: ScenarioStepExecutionRecord[];
  assertions: AssertionResult[];
}

function parseJson(value: string, label: string): unknown {
  try { return JSON.parse(value); }
  catch { throw new Error(`Stored ${label} is corrupt`); }
}

function toDetail(row: ExecutionRow, steps: StepRow[], assertions: AssertionRow[]): TestExecutionDetail {
  const definitionSnapshot = parseTestCaseDefinition(parseJson(row.definition_snapshot_json, "test execution definition"));
  return parseTestExecutionDetail({
    id: row.id,
    projectId: row.project_id,
    testCaseId: row.test_case_id,
    testCaseRevision: row.test_case_revision,
    status: row.status,
    definitionSnapshot,
    inputs: parseJson(row.inputs_json, "test execution inputs"),
    error: row.error_json === null ? null : parseJson(row.error_json, "test execution error"),
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    steps: steps.map((step) => ({
      id: step.id,
      executionId: step.execution_id,
      stepId: step.step_id,
      position: step.position,
      attempt: step.attempt,
      status: step.status,
      runId: step.run_id,
      workflowExecutionId: step.workflow_execution_id,
      resolvedArguments: step.resolved_arguments_json === null
        ? null
        : parseJson(step.resolved_arguments_json, "test execution arguments"),
      error: step.error_json === null ? null : parseJson(step.error_json, "test execution step error"),
      startedAt: step.started_at,
      completedAt: step.completed_at,
      durationMs: step.duration_ms,
    })),
    assertions: assertions.map((result) => ({
      id: result.id,
      executionId: result.execution_id,
      stepRecordId: result.step_record_id,
      assertionId: result.assertion_id,
      position: result.position,
      status: result.status,
      definition: parseJson(result.definition_json, "test assertion definition"),
      resolvedPath: result.resolved_path,
      ...(result.actual_summary_json === null ? {} : { actual: parseJson(result.actual_summary_json, "test assertion actual") }),
      ...(result.expected_summary_json === null ? {} : { expected: parseJson(result.expected_summary_json, "test assertion expected") }),
      errorCode: result.error_code,
      message: result.message,
      durationMs: result.duration_ms,
      isRedacted: result.redacted === 1,
    })),
  });
}

export class TestExecutionRepository {
  constructor(private readonly store: ProjectStore) {}

  create(input: CreateTestExecutionRecord): { execution: TestExecutionDetail; created: boolean; requestHash: string } {
    return this.store.database.transaction(() => {
      const inserted = this.store.database.prepare(`INSERT INTO test_executions
        (id, project_id, test_case_id, test_case_revision, idempotency_key, request_hash, status,
         definition_snapshot_json, inputs_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)
        ON CONFLICT(project_id, idempotency_key) DO NOTHING`).run(
          input.id, input.projectId, input.testCase.id, input.testCase.revision, input.idempotencyKey,
          input.requestHash, JSON.stringify(input.testCase), JSON.stringify(input.inputs), input.createdAt,
        );
      const identity = inserted.changes === 1
        ? { id: input.id, request_hash: input.requestHash }
        : this.store.database.prepare(`SELECT id, request_hash FROM test_executions
          WHERE project_id = ? AND idempotency_key = ?`).get(input.projectId, input.idempotencyKey) as
            { id: string; request_hash: string } | undefined;
      if (identity === undefined) throw new Error("Test execution could not be read");
      const execution = this.get(input.projectId, identity.id);
      if (execution === null) throw new Error("Test execution could not be read");
      return { execution, created: inserted.changes === 1, requestHash: identity.request_hash };
    })();
  }

  get(projectId: string, executionId: string): TestExecutionDetail | null {
    const row = this.store.database.prepare(`SELECT * FROM test_executions
      WHERE project_id = ? AND id = ?`).get(projectId, executionId) as ExecutionRow | undefined;
    if (row === undefined) return null;
    const steps = this.store.database.prepare(`SELECT * FROM test_execution_steps
      WHERE project_id = ? AND execution_id = ? ORDER BY position, attempt, id`)
      .all(projectId, executionId) as StepRow[];
    const assertions = this.store.database.prepare(`SELECT * FROM test_assertion_results
      WHERE project_id = ? AND execution_id = ? ORDER BY position, id`)
      .all(projectId, executionId) as AssertionRow[];
    return toDetail(row, steps, assertions);
  }

  list(projectId: string, limit: number, cursor: TestExecutionCursorPosition | null,
    testCaseId?: string): TestExecutionRepositoryPage {
    const where = ["e.project_id = ?"];
    const params: unknown[] = [projectId];
    if (testCaseId !== undefined) {
      where.push("e.test_case_id = ?");
      params.push(testCaseId);
    }
    if (cursor !== null) {
      where.push("(e.created_at < ? OR (e.created_at = ? AND e.id < ?))");
      params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    params.push(limit + 1);
    const rows = this.store.database.prepare(`SELECT e.*,
      COUNT(a.id) AS assertion_total,
      SUM(CASE WHEN a.status = 'PASSED' THEN 1 ELSE 0 END) AS assertion_passed,
      SUM(CASE WHEN a.status = 'FAILED' THEN 1 ELSE 0 END) AS assertion_failed,
      SUM(CASE WHEN a.status = 'ERROR' THEN 1 ELSE 0 END) AS assertion_error
      FROM test_executions e
      LEFT JOIN test_assertion_results a ON a.project_id = e.project_id AND a.execution_id = e.id
      WHERE ${where.join(" AND ")}
      GROUP BY e.id ORDER BY e.created_at DESC, e.id DESC LIMIT ?`).all(...params) as ReportSummaryRow[];
    const visible = rows.slice(0, limit);
    const items = visible.map((row) => {
      const definition = parseTestCaseDefinition(parseJson(row.definition_snapshot_json, "test execution definition"));
      return testExecutionReportSummarySchema.parse({
        id: row.id, projectId: row.project_id, testCaseId: row.test_case_id,
        testCaseRevision: row.test_case_revision, testCaseName: definition.name, testCaseKind: definition.kind,
        status: row.status, createdAt: row.created_at, startedAt: row.started_at,
        completedAt: row.completed_at, durationMs: row.duration_ms,
        error: row.error_json === null ? null : parseJson(row.error_json, "test execution error"),
        assertionSummary: { total: row.assertion_total, passed: row.assertion_passed,
          failed: row.assertion_failed, error: row.assertion_error },
      });
    });
    const last = visible.at(-1);
    return { items, next: rows.length > limit && last !== undefined
      ? { createdAt: last.created_at, id: last.id } : null };
  }

  begin(projectId: string, executionId: string, stepRecordId: string, at: string, argumentsValue: JsonObject): boolean {
    return this.store.database.transaction(() => {
      const changed = this.store.database.prepare(`UPDATE test_executions SET status = 'RUNNING', started_at = ?
        WHERE project_id = ? AND id = ? AND status = 'QUEUED'`).run(at, projectId, executionId).changes === 1;
      if (!changed) return false;
      this.store.database.prepare(`INSERT INTO test_execution_steps
        (id, project_id, execution_id, step_id, position, attempt, status, resolved_arguments_json, started_at)
        VALUES (?, ?, ?, 'main', 0, 1, 'RUNNING', ?, ?)`).run(
          stepRecordId, projectId, executionId, JSON.stringify(argumentsValue), at,
        );
      return true;
    })();
  }

  beginExecution(projectId: string, executionId: string, at: string): boolean {
    return this.store.database.prepare(`UPDATE test_executions SET status = 'RUNNING', started_at = ?
      WHERE project_id = ? AND id = ? AND status = 'QUEUED'`)
      .run(at, projectId, executionId).changes === 1;
  }

  linkInvocation(projectId: string, executionId: string, stepRecordId: string, input: {
    runId: string | null;
    workflowExecutionId: string | null;
  }): boolean {
    return this.store.database.prepare(`UPDATE test_execution_steps SET run_id = ?, workflow_execution_id = ?
      WHERE project_id = ? AND execution_id = ? AND id = ? AND status = 'RUNNING'`)
      .run(input.runId, input.workflowExecutionId, projectId, executionId, stepRecordId).changes === 1;
  }

  complete(projectId: string, executionId: string, stepRecordId: string, input: CompleteTestExecutionRecord): boolean {
    return this.store.database.transaction(() => {
      const executionChanged = this.store.database.prepare(`UPDATE test_executions SET status = ?, error_json = ?,
        completed_at = ?, duration_ms = ? WHERE project_id = ? AND id = ? AND status = 'RUNNING'`)
        .run(input.status, input.error === null ? null : JSON.stringify(input.error), input.completedAt,
          input.durationMs, projectId, executionId).changes === 1;
      if (!executionChanged) return false;
      const stepChanged = this.store.database.prepare(`UPDATE test_execution_steps SET status = ?, error_json = ?,
        completed_at = ?, duration_ms = ? WHERE project_id = ? AND execution_id = ? AND id = ? AND status = 'RUNNING'`)
        .run(input.stepStatus, input.error === null ? null : JSON.stringify(input.error), input.completedAt,
          input.durationMs, projectId, executionId, stepRecordId).changes === 1;
      if (!stepChanged) throw new Error("Test execution step could not reach terminal state");
      const insert = this.store.database.prepare(`INSERT INTO test_assertion_results
        (id, project_id, execution_id, step_record_id, assertion_id, position, status, definition_json,
         resolved_path, actual_summary_json, expected_summary_json, error_code, message, duration_ms, redacted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      input.assertions.forEach((result, position) => insert.run(
        result.id, projectId, executionId, stepRecordId, result.assertionId, position, result.status,
        JSON.stringify(result.definition), result.resolvedPath,
        result.actual === undefined ? null : JSON.stringify(result.actual),
        result.expected === undefined ? null : JSON.stringify(result.expected),
        result.errorCode, result.message, result.durationMs, result.isRedacted ? 1 : 0,
      ));
      return true;
    })();
  }

  completeScenario(
    projectId: string,
    executionId: string,
    input: CompleteScenarioExecutionRecord,
  ): boolean {
    return this.store.database.transaction(() => {
      const executionChanged = this.store.database.prepare(`UPDATE test_executions SET status = ?, error_json = ?,
        completed_at = ?, duration_ms = ? WHERE project_id = ? AND id = ? AND status = 'RUNNING'`)
        .run(input.status, input.error === null ? null : JSON.stringify(input.error), input.completedAt,
          input.durationMs, projectId, executionId).changes === 1;
      if (!executionChanged) return false;
      const insertStep = this.store.database.prepare(`INSERT INTO test_execution_steps
        (id, project_id, execution_id, step_id, position, attempt, status, run_id, workflow_execution_id,
         resolved_arguments_json, error_json, started_at, completed_at, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertAssertion = this.store.database.prepare(`INSERT INTO test_assertion_results
        (id, project_id, execution_id, step_record_id, assertion_id, position, status, definition_json,
         resolved_path, actual_summary_json, expected_summary_json, error_code, message, duration_ms, redacted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const writeAssertion = (result: AssertionResult, stepRecordId: string | null, position: number) => {
        insertAssertion.run(
          result.id, projectId, executionId, stepRecordId, result.assertionId, position, result.status,
          JSON.stringify(result.definition), result.resolvedPath,
          result.actual === undefined ? null : JSON.stringify(result.actual),
          result.expected === undefined ? null : JSON.stringify(result.expected),
          result.errorCode, result.message, result.durationMs, result.isRedacted ? 1 : 0,
        );
      };
      for (const step of input.steps) {
        insertStep.run(
          step.id, projectId, executionId, step.stepId, step.position, step.attempt, step.status,
          step.runId, step.workflowExecutionId,
          step.argumentsValue === null ? null : JSON.stringify(step.argumentsValue),
          step.error === null ? null : JSON.stringify(step.error),
          input.completedAt, input.completedAt, 0,
        );
        step.assertions.forEach((assertion, position) => writeAssertion(assertion, step.id, position));
      }
      input.assertions.forEach((assertion, position) => writeAssertion(assertion, null, position));
      return true;
    })();
  }

  cancel(projectId: string, executionId: string, at: string, durationMs: number): boolean {
    return this.store.database.transaction(() => {
      const changed = this.store.database.prepare(`UPDATE test_executions SET status = 'CANCELLED',
        error_json = ?, completed_at = ?, duration_ms = ?
        WHERE project_id = ? AND id = ? AND status IN ('QUEUED', 'RUNNING')`).run(
          JSON.stringify({ code: "CANCELLED", message: "Test execution was cancelled" }),
          at, durationMs, projectId, executionId,
        ).changes === 1;
      if (changed) this.store.database.prepare(`UPDATE test_execution_steps SET status = 'CANCELLED', error_json = ?,
        completed_at = ?, duration_ms = ? WHERE project_id = ? AND execution_id = ? AND status = 'RUNNING'`).run(
          JSON.stringify({ code: "CANCELLED", message: "Test execution was cancelled" }),
          at, durationMs, projectId, executionId,
        );
      return changed;
    })();
  }

  interruptActive(projectId: string, at: string): number {
    return this.store.database.transaction(() => {
      const rows = this.store.database.prepare(`SELECT id, created_at FROM test_executions
        WHERE project_id = ? AND status IN ('QUEUED', 'RUNNING')`).all(projectId) as Array<{ id: string; created_at: string }>;
      for (const row of rows) {
        const duration = Math.max(0, Date.parse(at) - Date.parse(row.created_at));
        const error = JSON.stringify({ code: "PROCESS_RESTARTED", message: "Test execution was interrupted by Inspector restart" });
        this.store.database.prepare(`UPDATE test_executions SET status = 'INTERRUPTED', error_json = ?,
          completed_at = ?, duration_ms = ? WHERE project_id = ? AND id = ? AND status IN ('QUEUED', 'RUNNING')`)
          .run(error, at, Number.isFinite(duration) ? duration : 0, projectId, row.id);
        this.store.database.prepare(`UPDATE test_execution_steps SET status = 'ERROR', error_json = ?, completed_at = ?,
          duration_ms = ? WHERE project_id = ? AND execution_id = ? AND status = 'RUNNING'`)
          .run(error, at, Number.isFinite(duration) ? duration : 0, projectId, row.id);
      }
      return rows.length;
    })();
  }
}
