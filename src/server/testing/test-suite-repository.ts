import type { ProjectStore } from "../projects/project-store.js";
import {
  parseTestSuiteDefinition,
  testSuiteSummarySchema,
  type TestSuiteDefinition,
  type TestSuiteSummary,
} from "../../shared/testing/test-suite.js";

interface SuiteRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  tags_json: string;
  revision: number;
  concurrency: number;
  stop_on_failure: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  id: string;
  test_case_id: string;
  position: number;
  enabled: number;
}

const suiteColumns = `id, project_id, name, description, tags_json, revision,
  concurrency, stop_on_failure, deleted_at, created_at, updated_at`;

function tagsOf(row: SuiteRow): string[] {
  let value: unknown;
  try { value = JSON.parse(row.tags_json); }
  catch { throw new Error("Stored test suite tags are corrupt"); }
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === "string")) {
    throw new Error("Stored test suite tags are corrupt");
  }
  return value;
}

function definitionFromRows(row: SuiteRow, members: MemberRow[]): TestSuiteDefinition {
  try {
    return parseTestSuiteDefinition({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      tags: tagsOf(row),
      revision: row.revision,
      members: members.map((member) => ({
        id: member.id,
        testCaseId: member.test_case_id,
        position: member.position,
        isEnabled: member.enabled === 1,
      })),
      executionPolicy: { concurrency: row.concurrency, stopOnFailure: row.stop_on_failure === 1 },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch {
    throw new Error("Stored test suite definition is corrupt");
  }
}

function summaryFromRow(row: SuiteRow, memberCount: number): TestSuiteSummary {
  return testSuiteSummarySchema.parse({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    tags: tagsOf(row),
    revision: row.revision,
    memberCount,
    executionPolicy: { concurrency: row.concurrency, stopOnFailure: row.stop_on_failure === 1 },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class TestSuiteRepository {
  constructor(private readonly store: ProjectStore) {}

  hasActiveTestCase(projectId: string, testCaseId: string): boolean {
    return this.store.database.prepare(
      "SELECT 1 FROM test_cases WHERE project_id = ? AND id = ? AND deleted_at IS NULL",
    ).get(projectId, testCaseId) !== undefined;
  }

  get(projectId: string, suiteId: string): TestSuiteDefinition | null {
    const row = this.store.database.prepare(
      `SELECT ${suiteColumns} FROM test_suites WHERE project_id = ? AND id = ? AND deleted_at IS NULL`,
    ).get(projectId, suiteId) as SuiteRow | undefined;
    if (row === undefined) return null;
    const members = this.store.database.prepare(`SELECT id, test_case_id, position, enabled
      FROM test_suite_members WHERE project_id = ? AND suite_id = ? AND deleted_at IS NULL ORDER BY position, id`)
      .all(projectId, suiteId) as MemberRow[];
    return definitionFromRows(row, members);
  }

  list(projectId: string): TestSuiteSummary[] {
    const rows = this.store.database.prepare(`SELECT ${suiteColumns},
      (SELECT count(*) FROM test_suite_members member
        WHERE member.project_id = test_suites.project_id AND member.suite_id = test_suites.id
          AND member.deleted_at IS NULL) AS member_count
      FROM test_suites WHERE project_id = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC, id DESC`).all(projectId) as Array<SuiteRow & { member_count: number }>;
    return rows.map((row) => summaryFromRow(row, row.member_count));
  }

  insert(definition: TestSuiteDefinition): TestSuiteDefinition {
    this.store.database.transaction(() => {
      this.store.database.prepare(`INSERT INTO test_suites
        (id, project_id, name, description, tags_json, revision, concurrency, stop_on_failure,
         deleted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
        definition.id, definition.projectId, definition.name, definition.description,
        JSON.stringify(definition.tags), definition.revision, definition.executionPolicy.concurrency,
        definition.executionPolicy.stopOnFailure ? 1 : 0, definition.createdAt, definition.updatedAt,
      );
      this.insertMembers(definition);
    })();
    return definition;
  }

  update(definition: TestSuiteDefinition, expectedRevision: number): "updated" | "missing" | "conflict" {
    return this.store.database.transaction(() => {
      const result = this.store.database.prepare(`UPDATE test_suites SET
        name = ?, description = ?, tags_json = ?, revision = ?, concurrency = ?, stop_on_failure = ?, updated_at = ?
        WHERE project_id = ? AND id = ? AND deleted_at IS NULL AND revision = ?`).run(
        definition.name, definition.description, JSON.stringify(definition.tags), definition.revision,
        definition.executionPolicy.concurrency, definition.executionPolicy.stopOnFailure ? 1 : 0,
        definition.updatedAt, definition.projectId, definition.id, expectedRevision,
      );
      if (result.changes !== 1) {
        const exists = this.store.database.prepare(
          "SELECT 1 FROM test_suites WHERE project_id = ? AND id = ? AND deleted_at IS NULL",
        ).get(definition.projectId, definition.id) !== undefined;
        return exists ? "conflict" as const : "missing" as const;
      }
      const existing = this.store.database.prepare(`SELECT id FROM test_suite_members
        WHERE project_id = ? AND suite_id = ? AND deleted_at IS NULL`)
        .all(definition.projectId, definition.id) as Array<{ id: string }>;
      const incoming = new Set(definition.members.map(({ id }) => id));
      this.store.database.prepare(`UPDATE test_suite_members SET position = position + 1000000
        WHERE project_id = ? AND suite_id = ?`).run(definition.projectId, definition.id);
      const updateMember = this.store.database.prepare(`UPDATE test_suite_members SET
        test_case_id = ?, position = ?, enabled = ? WHERE project_id = ? AND suite_id = ? AND id = ?
          AND deleted_at IS NULL`);
      const reviveMember = this.store.database.prepare(`UPDATE test_suite_members SET
        position = ?, enabled = ?, deleted_at = NULL WHERE project_id = ? AND suite_id = ?
          AND test_case_id = ? AND deleted_at IS NOT NULL RETURNING id`);
      const insertMember = this.store.database.prepare(`INSERT INTO test_suite_members
        (id, project_id, suite_id, test_case_id, position, enabled) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const member of definition.members) {
        const updated = updateMember.run(member.testCaseId, member.position, member.isEnabled ? 1 : 0,
          definition.projectId, definition.id, member.id);
        if (updated.changes === 0) {
          const revived = reviveMember.get(member.position, member.isEnabled ? 1 : 0,
            definition.projectId, definition.id, member.testCaseId);
          if (revived === undefined) insertMember.run(member.id, definition.projectId, definition.id,
            member.testCaseId, member.position, member.isEnabled ? 1 : 0);
        }
      }
      const removeMember = this.store.database.prepare(`UPDATE test_suite_members SET deleted_at = ?, enabled = 0
        WHERE project_id = ? AND suite_id = ? AND id = ? AND deleted_at IS NULL`);
      for (const member of existing) if (!incoming.has(member.id)) {
        removeMember.run(definition.updatedAt, definition.projectId, definition.id, member.id);
      }
      return "updated" as const;
    })();
  }

  remove(projectId: string, suiteId: string, timestamp: string): boolean {
    return this.store.database.prepare(`UPDATE test_suites SET deleted_at = ?, updated_at = ?
      WHERE project_id = ? AND id = ? AND deleted_at IS NULL`)
      .run(timestamp, timestamp, projectId, suiteId).changes === 1;
  }

  private insertMembers(definition: TestSuiteDefinition): void {
    const statement = this.store.database.prepare(`INSERT INTO test_suite_members
      (id, project_id, suite_id, test_case_id, position, enabled) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const member of definition.members) {
      statement.run(member.id, definition.projectId, definition.id, member.testCaseId,
        member.position, member.isEnabled ? 1 : 0);
    }
  }
}
