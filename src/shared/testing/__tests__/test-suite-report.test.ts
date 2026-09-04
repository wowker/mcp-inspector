import { describe, expect, it } from "vitest";
import {
  createSavedTestSuiteReportRequestSchema,
  savedTestSuiteReportSchema,
  testSuiteExecutionReportOutlineSchema,
  testSuiteExecutionReportPageSchema,
  updateSavedTestSuiteReportRequestSchema,
} from "../test-suite-report.js";

const projectId = "00000000-0000-4000-8000-000000003001";
const suiteId = "00000000-0000-4000-8000-000000003002";
const suiteExecutionId = "00000000-0000-4000-8000-000000003003";
const memberId = "00000000-0000-4000-8000-000000003004";
const testCaseId = "00000000-0000-4000-8000-000000003005";
const testExecutionId = "00000000-0000-4000-8000-000000003006";
const stepRecordId = "00000000-0000-4000-8000-000000003007";
const runId = "00000000-0000-4000-8000-000000003008";
const now = "2026-09-04T08:00:00.000Z";

const execution = {
  id: suiteExecutionId,
  projectId,
  suiteId,
  suiteRevision: 3,
  status: "PASSED" as const,
  suiteSnapshot: {
    id: suiteId,
    projectId,
    name: "Release regression",
    description: "",
    tags: [],
    revision: 3,
    members: [{ id: memberId, testCaseId, position: 0, isEnabled: true }],
    executionPolicy: { concurrency: 2, stopOnFailure: false },
    createdAt: now,
    updatedAt: now,
  },
  summary: { total: 1, passed: 1, failed: 0, errors: 0, cancelled: 0 },
  error: null,
  createdAt: now,
  startedAt: now,
  completedAt: now,
  durationMs: 42,
  items: [{
    id: "00000000-0000-4000-8000-000000003009",
    suiteExecutionId,
    memberId,
    testCaseId,
    testExecutionId,
    position: 0,
    status: "PASSED" as const,
  }],
};

describe("test suite report contracts", () => {
  it("parses bounded history pages and a navigation-only report outline", () => {
    expect(testSuiteExecutionReportPageSchema.parse({
      items: [{
        id: suiteExecutionId,
        projectId,
        suiteId,
        suiteRevision: 3,
        suiteName: "Release regression",
        status: "PASSED",
        summary: execution.summary,
        createdAt: now,
        startedAt: now,
        completedAt: now,
        durationMs: 42,
      }],
      nextCursor: null,
    }).items[0]?.suiteName).toBe("Release regression");

    const outline = testSuiteExecutionReportOutlineSchema.parse({
      execution,
      members: [{
        item: execution.items[0],
        testExecution: {
          id: testExecutionId,
          testCaseId,
          testCaseRevision: 2,
          testCaseName: "Query shop",
          testCaseKind: "scenario",
          status: "PASSED",
          createdAt: now,
          startedAt: now,
          completedAt: now,
          durationMs: 42,
          error: null,
        },
        calls: [{
          stepRecordId,
          stepId: "query-shop",
          stepKind: "tool",
          position: 0,
          attempt: 1,
          runId,
          workflowExecutionId: null,
          status: "PASSED",
          startedAt: now,
          completedAt: now,
          durationMs: 42,
          error: null,
        }],
      }],
    });

    expect(outline.members[0]?.calls[0]?.runId).toBe(runId);
    expect(testSuiteExecutionReportOutlineSchema.safeParse({
      ...outline,
      members: [{ ...outline.members[0], response: { secret: "must-not-be-in-outline" } }],
    }).success).toBe(false);
  });

  it("validates immutable saved-report references and bounded editable metadata", () => {
    const create = createSavedTestSuiteReportRequestSchema.parse({
      suiteId,
      suiteExecutionId,
      name: "  Release baseline  ",
      versionLabel: "  1.0  ",
      note: "Stable before rollout",
    });
    expect(create).toMatchObject({ name: "Release baseline", versionLabel: "1.0" });

    expect(savedTestSuiteReportSchema.parse({
      id: "00000000-0000-4000-8000-000000003010",
      projectId,
      suiteId,
      suiteExecutionId,
      name: create.name,
      versionLabel: create.versionLabel,
      note: create.note,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }).suiteExecutionId).toBe(suiteExecutionId);

    expect(updateSavedTestSuiteReportRequestSchema.safeParse({
      revision: 1,
      suiteExecutionId: "00000000-0000-4000-8000-000000003099",
    }).success).toBe(false);
    expect(createSavedTestSuiteReportRequestSchema.safeParse({
      suiteId,
      suiteExecutionId,
      name: "Baseline",
      versionLabel: "x".repeat(41),
    }).success).toBe(false);
  });
});
