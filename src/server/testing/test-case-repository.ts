import type { ProjectStore } from "../projects/project-store.js";
import {
  parseTestCaseDefinition,
  testCaseSummarySchema,
  type TestCaseDefinition,
  type TestCaseSummary,
  type ToolTarget,
} from "../../shared/testing/test-case.js";

interface TestCaseRow {
  id: string;
  project_id: string;
  kind: "tool" | "scenario";
  name: string;
  description: string;
  tags_json: string;
  revision: number;
  enabled: number;
  definition_json: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TestCaseListFilters {
  kind?: "tool" | "scenario";
  connectionId?: string;
  tag?: string;
  query?: string;
}

export interface TestCaseCursorPosition {
  updatedAt: string;
  id: string;
}

export interface TestCaseRepositoryPage {
  items: TestCaseSummary[];
  next: TestCaseCursorPosition | null;
}

const columns = `id, project_id, kind, name, description, tags_json, revision,
  enabled, definition_json, deleted_at, created_at, updated_at`;
const aliasedColumns = `tc.id, tc.project_id, tc.kind, tc.name, tc.description, tc.tags_json,
  tc.revision, tc.enabled, tc.definition_json, tc.deleted_at, tc.created_at, tc.updated_at`;

function definitionFromRow(row: TestCaseRow): TestCaseDefinition {
  try {
    return parseTestCaseDefinition(JSON.parse(row.definition_json));
  } catch {
    throw new Error("Stored test case definition is corrupt");
  }
}

function summaryFromRow(row: TestCaseRow, targetConnectionIds: string[]): TestCaseSummary {
  let tags: unknown;
  try { tags = JSON.parse(row.tags_json); }
  catch { throw new Error("Stored test case tags are corrupt"); }
  return testCaseSummarySchema.parse({
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    tags,
    revision: row.revision,
    isEnabled: row.enabled === 1,
    targetConnectionIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function uniqueTargets(targets: ToolTarget[]): ToolTarget[] {
  const seen = new Set<string>();
  return targets.filter(({ connectionId, toolName }) => {
    const key = `${connectionId}\0${toolName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class TestCaseRepository {
  constructor(private readonly store: ProjectStore) {}

  hasConnection(projectId: string, connectionId: string): boolean {
    return this.store.database.prepare(
      "SELECT 1 FROM connections WHERE project_id = ? AND id = ?",
    ).get(projectId, connectionId) !== undefined;
  }

  get(projectId: string, testCaseId: string): TestCaseDefinition | null {
    const row = this.store.database.prepare(
      `SELECT ${columns} FROM test_cases WHERE project_id = ? AND id = ? AND deleted_at IS NULL`,
    ).get(projectId, testCaseId) as TestCaseRow | undefined;
    return row === undefined ? null : definitionFromRow(row);
  }

  list(
    projectId: string,
    filters: TestCaseListFilters,
    limit: number,
    cursor: TestCaseCursorPosition | null,
  ): TestCaseRepositoryPage {
    const where = ["tc.project_id = ?", "tc.deleted_at IS NULL"];
    const params: unknown[] = [projectId];
    if (filters.kind !== undefined) { where.push("tc.kind = ?"); params.push(filters.kind); }
    if (filters.connectionId !== undefined) {
      where.push(`EXISTS (SELECT 1 FROM test_case_targets t
        WHERE t.project_id = tc.project_id AND t.test_case_id = tc.id AND t.connection_id = ?)`);
      params.push(filters.connectionId);
    }
    if (filters.tag !== undefined) {
      where.push("EXISTS (SELECT 1 FROM json_each(tc.tags_json) WHERE lower(value) = lower(?))");
      params.push(filters.tag);
    }
    if (filters.query !== undefined) {
      where.push("(lower(tc.name) LIKE ? ESCAPE '\\' OR lower(tc.description) LIKE ? ESCAPE '\\')");
      const escaped = filters.query.toLocaleLowerCase().replace(/[\\%_]/g, "\\$&");
      params.push(`%${escaped}%`, `%${escaped}%`);
    }
    if (cursor !== null) {
      where.push("(tc.updated_at < ? OR (tc.updated_at = ? AND tc.id < ?))");
      params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    params.push(limit + 1);
    const rows = this.store.database.prepare(`SELECT ${aliasedColumns}
      FROM test_cases tc WHERE ${where.join(" AND ")}
      ORDER BY tc.updated_at DESC, tc.id DESC LIMIT ?`).all(...params) as TestCaseRow[];
    const visible = rows.slice(0, limit);
    const targetsByCase = new Map<string, string[]>();
    if (visible.length > 0) {
      const placeholders = visible.map(() => "?").join(", ");
      const targets = this.store.database.prepare(`SELECT test_case_id, connection_id
        FROM test_case_targets WHERE project_id = ? AND test_case_id IN (${placeholders})
        GROUP BY test_case_id, connection_id ORDER BY connection_id`).all(
        projectId, ...visible.map(({ id }) => id),
      ) as Array<{ test_case_id: string; connection_id: string }>;
      for (const target of targets) {
        const values = targetsByCase.get(target.test_case_id) ?? [];
        values.push(target.connection_id);
        targetsByCase.set(target.test_case_id, values);
      }
    }
    const last = visible.at(-1);
    return {
      items: visible.map((row) => summaryFromRow(row, targetsByCase.get(row.id) ?? [])),
      next: rows.length > limit && last !== undefined ? { updatedAt: last.updated_at, id: last.id } : null,
    };
  }

  insert(definition: TestCaseDefinition, revisionId: string, targets: ToolTarget[]): TestCaseDefinition {
    const write = this.store.database.transaction(() => {
      const definitionJson = JSON.stringify(definition);
      this.store.database.prepare(`INSERT INTO test_cases
        (id, project_id, kind, name, description, tags_json, revision, enabled,
         definition_json, deleted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
        .run(definition.id, definition.projectId, definition.kind, definition.name,
          definition.description, JSON.stringify(definition.tags), definition.revision,
          definition.isEnabled ? 1 : 0, definitionJson, definition.createdAt, definition.updatedAt);
      this.insertTargets(definition.projectId, definition.id, targets);
      this.store.database.prepare(`INSERT INTO test_case_revisions
        (id, project_id, test_case_id, revision, definition_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(revisionId, definition.projectId, definition.id, definition.revision,
          definitionJson, definition.updatedAt);
    });
    write();
    return definition;
  }

  update(
    definition: TestCaseDefinition,
    expectedRevision: number,
    revisionId: string,
    targets: ToolTarget[],
  ): "updated" | "missing" | "conflict" {
    const write = this.store.database.transaction(() => {
      const result = this.store.database.prepare(`UPDATE test_cases SET
        kind = ?, name = ?, description = ?, tags_json = ?, revision = ?, enabled = ?,
        definition_json = ?, updated_at = ?
        WHERE project_id = ? AND id = ? AND deleted_at IS NULL AND revision = ?`)
        .run(definition.kind, definition.name, definition.description,
          JSON.stringify(definition.tags), definition.revision, definition.isEnabled ? 1 : 0,
          JSON.stringify(definition), definition.updatedAt, definition.projectId,
          definition.id, expectedRevision);
      if (result.changes !== 1) {
        const exists = this.store.database.prepare(
          "SELECT 1 FROM test_cases WHERE project_id = ? AND id = ? AND deleted_at IS NULL",
        ).get(definition.projectId, definition.id) !== undefined;
        return exists ? "conflict" : "missing";
      }
      this.store.database.prepare(
        "DELETE FROM test_case_targets WHERE project_id = ? AND test_case_id = ?",
      ).run(definition.projectId, definition.id);
      this.insertTargets(definition.projectId, definition.id, targets);
      this.store.database.prepare(`INSERT INTO test_case_revisions
        (id, project_id, test_case_id, revision, definition_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(revisionId, definition.projectId, definition.id, definition.revision,
          JSON.stringify(definition), definition.updatedAt);
      return "updated" as const;
    });
    return write();
  }

  remove(projectId: string, testCaseId: string, deletedAt: string): boolean {
    const write = this.store.database.transaction(() => {
      const result = this.store.database.prepare(`UPDATE test_cases
        SET deleted_at = ?, updated_at = ?
        WHERE project_id = ? AND id = ? AND deleted_at IS NULL`)
        .run(deletedAt, deletedAt, projectId, testCaseId);
      if (result.changes !== 1) return false;
      this.store.database.prepare(
        "DELETE FROM test_case_targets WHERE project_id = ? AND test_case_id = ?",
      ).run(projectId, testCaseId);
      return true;
    });
    return write();
  }

  private insertTargets(projectId: string, testCaseId: string, targets: ToolTarget[]): void {
    const statement = this.store.database.prepare(`INSERT INTO test_case_targets
      (project_id, test_case_id, connection_id, tool_name) VALUES (?, ?, ?, ?)`);
    for (const target of uniqueTargets(targets)) {
      statement.run(projectId, testCaseId, target.connectionId, target.toolName);
    }
  }
}
