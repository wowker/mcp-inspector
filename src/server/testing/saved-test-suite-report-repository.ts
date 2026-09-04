import {
  parseSavedTestSuiteReport,
  type SavedTestSuiteReport,
} from "../../shared/testing/test-suite-report.js";
import type { ProjectStore } from "../projects/project-store.js";

interface SavedReportRow {
  id: string;
  project_id: string;
  suite_id: string;
  suite_execution_id: string;
  name: string;
  version_label: string;
  version_label_normalized: string;
  note: string | null;
  revision: number;
  idempotency_key: string;
  request_hash: string;
  created_at: string;
  updated_at: string;
}

export interface SavedTestSuiteReportCursorPosition {
  createdAt: string;
  id: string;
}

export class SavedTestSuiteReportVersionConflictError extends Error {
  constructor() {
    super("Saved test suite report version conflicts with an existing report");
    this.name = "SavedTestSuiteReportVersionConflictError";
  }
}

function toReport(row: SavedReportRow): SavedTestSuiteReport {
  return parseSavedTestSuiteReport({
    id: row.id,
    projectId: row.project_id,
    suiteId: row.suite_id,
    suiteExecutionId: row.suite_execution_id,
    name: row.name,
    versionLabel: row.version_label,
    note: row.note,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class SavedTestSuiteReportRepository {
  constructor(private readonly store: ProjectStore) {}

  create(input: {
    id: string;
    projectId: string;
    suiteId: string;
    suiteExecutionId: string;
    name: string;
    versionLabel: string;
    normalizedVersionLabel: string;
    note: string | null;
    idempotencyKey: string;
    requestHash: string;
    createdAt: string;
  }): { report: SavedTestSuiteReport; created: boolean; requestHash: string } {
    return this.store.database.transaction(() => {
      const inserted = this.store.database.prepare(`INSERT OR IGNORE INTO saved_test_suite_reports
        (id, project_id, suite_id, suite_execution_id, name, version_label,
         version_label_normalized, note, revision, idempotency_key, request_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`).run(
        input.id,
        input.projectId,
        input.suiteId,
        input.suiteExecutionId,
        input.name,
        input.versionLabel,
        input.normalizedVersionLabel,
        input.note,
        input.idempotencyKey,
        input.requestHash,
        input.createdAt,
        input.createdAt,
      );
      const row = this.store.database.prepare(`SELECT * FROM saved_test_suite_reports
        WHERE project_id = ? AND idempotency_key = ?`).get(
        input.projectId, input.idempotencyKey,
      ) as SavedReportRow | undefined;
      if (row === undefined) throw new SavedTestSuiteReportVersionConflictError();
      return { report: toReport(row), created: inserted.changes === 1, requestHash: row.request_hash };
    })();
  }

  get(projectId: string, reportId: string): SavedTestSuiteReport | null {
    const row = this.store.database.prepare(`SELECT * FROM saved_test_suite_reports
      WHERE project_id = ? AND id = ?`).get(projectId, reportId) as SavedReportRow | undefined;
    return row === undefined ? null : toReport(row);
  }

  list(projectId: string, suiteId: string | undefined, limit: number,
    cursor: SavedTestSuiteReportCursorPosition | null): {
      items: SavedTestSuiteReport[];
      next: SavedTestSuiteReportCursorPosition | null;
    } {
    const suiteFilter = suiteId === undefined ? "" : " AND suite_id = ?";
    const cursorFilter = cursor === null ? "" : " AND (created_at < ? OR (created_at = ? AND id < ?))";
    const values: unknown[] = [projectId];
    if (suiteId !== undefined) values.push(suiteId);
    if (cursor !== null) values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    values.push(limit + 1);
    const rows = this.store.database.prepare(`SELECT * FROM saved_test_suite_reports
      WHERE project_id = ?${suiteFilter}${cursorFilter}
      ORDER BY created_at DESC, id DESC LIMIT ?`).all(...values) as SavedReportRow[];
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toReport),
      next: rows.length > limit && last !== undefined ? { createdAt: last.created_at, id: last.id } : null,
    };
  }

  update(projectId: string, reportId: string, input: {
    revision: number;
    name: string;
    versionLabel: string;
    normalizedVersionLabel: string;
    note: string | null;
    updatedAt: string;
  }): SavedTestSuiteReport | "REVISION_CONFLICT" | "VERSION_CONFLICT" | null {
    try {
      const changed = this.store.database.prepare(`UPDATE saved_test_suite_reports
        SET name = ?, version_label = ?, version_label_normalized = ?, note = ?,
          revision = revision + 1, updated_at = ?
        WHERE project_id = ? AND id = ? AND revision = ?`).run(
        input.name,
        input.versionLabel,
        input.normalizedVersionLabel,
        input.note,
        input.updatedAt,
        projectId,
        reportId,
        input.revision,
      );
      if (changed.changes === 0) return this.get(projectId, reportId) === null ? null : "REVISION_CONFLICT";
      return this.get(projectId, reportId);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed") &&
          error.message.includes("version_label_normalized")) return "VERSION_CONFLICT";
      throw error;
    }
  }

  remove(projectId: string, reportId: string): boolean {
    return this.store.database.prepare(`DELETE FROM saved_test_suite_reports
      WHERE project_id = ? AND id = ?`).run(projectId, reportId).changes === 1;
  }
}
