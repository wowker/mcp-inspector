import type { ProjectStore } from "../projects/project-store.js";
import {
  parsePressureTestDefinition,
  type PressureTestDefinition,
} from "../../shared/testing/pressure-test.js";

interface PressureTestRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  revision: number;
  test_case_id: string;
  inputs_json: string;
  load_json: string;
  thresholds_json: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PressureTestCursor {
  updatedAt: string;
  id: string;
}

const columns = `id, project_id, name, description, revision, test_case_id, inputs_json,
  load_json, thresholds_json, deleted_at, created_at, updated_at`;

function parseJson(value: string): unknown {
  try { return JSON.parse(value); }
  catch { throw new Error("Stored pressure test definition is corrupt"); }
}

function fromRow(row: PressureTestRow): PressureTestDefinition {
  try {
    return parsePressureTestDefinition({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      revision: row.revision,
      target: { testCaseId: row.test_case_id },
      inputs: parseJson(row.inputs_json),
      load: parseJson(row.load_json),
      thresholds: parseJson(row.thresholds_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch {
    throw new Error("Stored pressure test definition is corrupt");
  }
}

export class PressureTestRepository {
  constructor(private readonly store: ProjectStore) {}

  hasActiveTestCase(projectId: string, testCaseId: string): boolean {
    return this.store.database.prepare(
      "SELECT 1 FROM test_cases WHERE project_id = ? AND id = ? AND deleted_at IS NULL",
    ).get(projectId, testCaseId) !== undefined;
  }

  get(projectId: string, pressureTestId: string): PressureTestDefinition | null {
    const row = this.store.database.prepare(
      `SELECT ${columns} FROM pressure_tests WHERE project_id = ? AND id = ? AND deleted_at IS NULL`,
    ).get(projectId, pressureTestId) as PressureTestRow | undefined;
    return row === undefined ? null : fromRow(row);
  }

  list(projectId: string, limit: number, cursor?: PressureTestCursor): {
    items: PressureTestDefinition[];
    hasMore: boolean;
  } {
    const rows = (cursor === undefined
      ? this.store.database.prepare(`SELECT ${columns} FROM pressure_tests
          WHERE project_id = ? AND deleted_at IS NULL
          ORDER BY updated_at DESC, id DESC LIMIT ?`).all(projectId, limit + 1)
      : this.store.database.prepare(`SELECT ${columns} FROM pressure_tests
          WHERE project_id = ? AND deleted_at IS NULL
            AND (updated_at < ? OR (updated_at = ? AND id < ?))
          ORDER BY updated_at DESC, id DESC LIMIT ?`)
        .all(projectId, cursor.updatedAt, cursor.updatedAt, cursor.id, limit + 1)) as PressureTestRow[];
    return { items: rows.slice(0, limit).map(fromRow), hasMore: rows.length > limit };
  }

  insert(definition: PressureTestDefinition): PressureTestDefinition {
    this.store.database.prepare(`INSERT INTO pressure_tests
      (id, project_id, name, description, revision, test_case_id, inputs_json, load_json,
       thresholds_json, deleted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
      definition.id, definition.projectId, definition.name, definition.description, definition.revision,
      definition.target.testCaseId, JSON.stringify(definition.inputs), JSON.stringify(definition.load),
      JSON.stringify(definition.thresholds), definition.createdAt, definition.updatedAt,
    );
    return definition;
  }

  update(definition: PressureTestDefinition, expectedRevision: number): "updated" | "missing" | "conflict" {
    const result = this.store.database.prepare(`UPDATE pressure_tests SET name = ?, description = ?,
      revision = ?, test_case_id = ?, inputs_json = ?, load_json = ?, thresholds_json = ?, updated_at = ?
      WHERE project_id = ? AND id = ? AND deleted_at IS NULL AND revision = ?`).run(
      definition.name, definition.description, definition.revision, definition.target.testCaseId,
      JSON.stringify(definition.inputs), JSON.stringify(definition.load), JSON.stringify(definition.thresholds),
      definition.updatedAt, definition.projectId, definition.id, expectedRevision,
    );
    if (result.changes === 1) return "updated";
    const exists = this.store.database.prepare(
      "SELECT 1 FROM pressure_tests WHERE project_id = ? AND id = ? AND deleted_at IS NULL",
    ).get(definition.projectId, definition.id) !== undefined;
    return exists ? "conflict" : "missing";
  }

  remove(projectId: string, pressureTestId: string, timestamp: string): boolean {
    return this.store.database.prepare(`UPDATE pressure_tests SET deleted_at = ?, updated_at = ?
      WHERE project_id = ? AND id = ? AND deleted_at IS NULL`)
      .run(timestamp, timestamp, projectId, pressureTestId).changes === 1;
  }
}
