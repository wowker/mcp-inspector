import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../../projects/project-service.js";
import {
  SavedTestSuiteReportConflictError,
  SavedTestSuiteReportRevisionConflictError,
  createSavedTestSuiteReportService,
} from "../saved-test-suite-report-service.js";

const projectId = "00000000-0000-4000-8000-000000004001";
const suiteId = "00000000-0000-4000-8000-000000004002";
const suiteExecutionId = "00000000-0000-4000-8000-000000004003";
const reportOneId = "00000000-0000-4000-8000-000000004004";
const reportTwoId = "00000000-0000-4000-8000-000000004005";
const discardedReplayId = "00000000-0000-4000-8000-000000004006";
const discardedConflictId = "00000000-0000-4000-8000-000000004007";
const now = "2026-09-04T09:00:00.000Z";

describe("SavedTestSuiteReportService", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("saves immutable execution references as independently named report versions", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-saved-suite-report-"));
    roots.push(dataRoot);
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Saved reports");
    const database = projects.open(projectId).database;
    database.prepare(`INSERT INTO test_suites
      (id, project_id, name, description, tags_json, revision, concurrency, stop_on_failure, created_at, updated_at)
      VALUES (?, ?, 'Release suite', '', '[]', 1, 1, 0, ?, ?)`).run(suiteId, projectId, now, now);
    database.prepare(`INSERT INTO test_suite_executions
      (id, project_id, suite_id, suite_revision, idempotency_key, request_hash, status,
       suite_snapshot_json, summary_json, created_at, started_at, completed_at, duration_ms)
      VALUES (?, ?, ?, 1, 'suite-run', 'suite-hash', 'PASSED', ?, ?, ?, ?, ?, 42)`).run(
      suiteExecutionId,
      projectId,
      suiteId,
      JSON.stringify({
        id: suiteId, projectId, name: "Release suite", description: "", tags: [], revision: 1,
        members: [], executionPolicy: { concurrency: 1, stopOnFailure: false }, createdAt: now, updatedAt: now,
      }),
      JSON.stringify({ total: 0, passed: 0, failed: 0, errors: 0, cancelled: 0 }),
      now,
      now,
      now,
    );
    const ids = [reportOneId, discardedReplayId, discardedConflictId, reportTwoId];
    const service = createSavedTestSuiteReportService({
      projects,
      createId: () => ids.shift()!,
      now: () => new Date(now),
    });

    try {
      const one = service.create(projectId, "save-1", {
        suiteId, suiteExecutionId, name: "Release baseline", versionLabel: "1.0", note: "Before rollout",
      });
      expect(one).toMatchObject({ id: reportOneId, suiteExecutionId, versionLabel: "1.0", revision: 1 });
      expect(service.create(projectId, "save-1", {
        suiteId, suiteExecutionId, name: "Release baseline", versionLabel: "1.0", note: "Before rollout",
      })).toEqual(one);

      expect(() => service.create(projectId, "save-duplicate", {
        suiteId, suiteExecutionId, name: "Duplicate", versionLabel: " 1.0 ", note: null,
      })).toThrow(SavedTestSuiteReportConflictError);

      const two = service.create(projectId, "save-2", {
        suiteId, suiteExecutionId, name: "After parameter migration", versionLabel: "2.0", note: null,
      });
      expect(service.list(projectId, { suiteId, limit: 10 }).items.map(({ versionLabel }) => versionLabel))
        .toEqual(["2.0", "1.0"]);

      const updated = service.update(projectId, two.id, {
        revision: 1, name: "Release candidate", note: "Reviewed",
      });
      expect(updated).toMatchObject({
        id: reportTwoId, suiteExecutionId, name: "Release candidate", note: "Reviewed", revision: 2,
      });
      expect(() => service.update(projectId, two.id, { revision: 1, name: "Stale" }))
        .toThrow(SavedTestSuiteReportRevisionConflictError);

      service.remove(projectId, one.id);
      expect(service.list(projectId, { suiteId }).items.map(({ id }) => id))
        .toEqual([reportTwoId]);
    } finally {
      projects.close();
    }
  });
});
