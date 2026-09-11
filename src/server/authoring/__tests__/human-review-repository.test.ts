import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../../projects/project-service.js";
import { HumanReviewConflictError, HumanReviewRepository } from "../human-review-repository.js";
import { ValidationSessionRepository } from "../validation-session-repository.js";

const projectId = "00000000-0000-4000-8000-000000008101";
const testCaseId = "00000000-0000-4000-8000-000000008102";
const sessionId = "00000000-0000-4000-8000-000000008103";
const evidenceDigest = "b".repeat(64);
const now = "2026-09-11T01:00:00.000Z";

describe("HumanReviewRepository", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture(expectations = ["claim-1"]) {
    const dataRoot = mkdtempSync(join(tmpdir(), "human-review-repository-"));
    roots.push(dataRoot);
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Review");
    const store = projects.open(projectId);
    const sessions = new ValidationSessionRepository(store);
    sessions.create({ id: sessionId, projectId, source: { kind: "TEST_CASE", testCaseId, revision: 3 },
      sourceSnapshot: { kind: "tool" }, sourceSnapshotDigest: "a".repeat(64), toolSchemaHashes: {},
      mode: "MANUAL_EXECUTION", idempotencyKey: "start", requestHash: "a".repeat(64), createdAt: now });
    sessions.transition({ projectId, sessionId, expectedRevision: 1, from: "READY", to: "RUNNING", timestamp: now });
    sessions.transition({ projectId, sessionId, expectedRevision: 2, from: "RUNNING", to: "EVALUATING", timestamp: now });
    sessions.completeEvidence({ projectId, sessionId, expectedRevision: 3,
      id: "00000000-0000-4000-8000-000000008104", evidenceDigest, machineVerdict: "PASS",
      expectations: expectations.map((expectationLocalId) => ({ expectationLocalId, verdict: "PASS" as const,
        evidence: { actual: true, expected: true }, runId: null, redactionCount: 0, truncated: false })), completedAt: now });
    return { projects, store, reviews: new HumanReviewRepository(store) };
  }

  it("appends an optimistic individual decision bound to the exact evidence digest", () => {
    const { projects, store, reviews } = fixture();
    try {
      const review = reviews.create({ projectId, sessionId, evidenceDigest, createdAt: now });
      expect(review).toMatchObject({ state: "PENDING", revision: 1, decisions: [] });
      const approved = reviews.decide({ id: "00000000-0000-4000-8000-000000008105",
        projectId, sessionId, expectedRevision: 1, evidenceDigest, expectationLocalId: "claim-1",
        decision: "CONFIRM_EXPECTATION", explanation: "Expectation is correct.",
        reviewerSessionId: "browser-session", decidedAt: now });
      expect(approved).toMatchObject({ state: "APPROVED", revision: 2,
        decisions: [{ expectationLocalId: "claim-1", decision: "CONFIRM_EXPECTATION", reviewRevision: 2 }] });
      expect(() => reviews.decide({ id: "00000000-0000-4000-8000-000000008106",
        projectId, sessionId, expectedRevision: 1, evidenceDigest, expectationLocalId: "claim-1",
        decision: "IMPLEMENTATION_DEFECT", explanation: "Stale", reviewerSessionId: "browser-session", decidedAt: now }))
        .toThrow(HumanReviewConflictError);
      expect(() => store.database.prepare("UPDATE validation_review_decisions SET explanation = 'changed'").run())
        .toThrow(/immutable/i);
    } finally { projects.close(); }
  });

  it("records one auditable batch and rolls the whole action back on stale membership", () => {
    const { projects, store, reviews } = fixture(["claim-1", "claim-2"]);
    try {
      reviews.create({ projectId, sessionId, evidenceDigest, createdAt: now });
      const pending = reviews.confirmBatch({ id: "00000000-0000-4000-8000-000000008107",
        projectId, sessionId, expectedRevision: 1, evidenceDigest,
        expectationLocalIds: ["claim-1"], reviewerSessionId: "browser-session", decidedAt: now });
      expect(pending).toMatchObject({ state: "PENDING", revision: 2 });
      expect(store.database.prepare("SELECT count(*) AS count FROM validation_review_batches").get())
        .toEqual({ count: 1 });
      expect(store.database.prepare("SELECT count(*) AS count FROM validation_review_batch_members").get())
        .toEqual({ count: 1 });
      expect(() => reviews.confirmBatch({ id: "00000000-0000-4000-8000-000000008108",
        projectId, sessionId, expectedRevision: 2, evidenceDigest, expectationLocalIds: ["missing"],
        reviewerSessionId: "browser-session", decidedAt: now })).toThrow(HumanReviewConflictError);
      expect(store.database.prepare("SELECT count(*) AS count FROM validation_review_batches").get())
        .toEqual({ count: 1 });
      expect(store.database.prepare("SELECT count(*) AS count FROM validation_review_batch_members").get())
        .toEqual({ count: 1 });
    } finally { projects.close(); }
  });

  it("links approval only to the exact formal asset revision captured by the session", () => {
    const { projects, reviews } = fixture();
    try {
      reviews.create({ projectId, sessionId, evidenceDigest, createdAt: now });
      reviews.decide({ id: "00000000-0000-4000-8000-000000008109", projectId, sessionId,
        expectedRevision: 1, evidenceDigest, expectationLocalId: "claim-1", decision: "CONFIRM_EXPECTATION",
        explanation: "Confirmed", reviewerSessionId: "browser-session", decidedAt: now });
      expect(reviews.verifyAsset({ id: "00000000-0000-4000-8000-000000008110", projectId,
        assetKind: "TEST_CASE", assetId: testCaseId, assetRevision: 3, sessionId,
        evidenceVersion: 1, reviewRevision: 2, verifiedAt: now })).toMatchObject({
        assetKind: "TEST_CASE", assetId: testCaseId, assetRevision: 3, reviewRevision: 2,
      });
      expect(() => reviews.verifyAsset({ id: "00000000-0000-4000-8000-000000008111", projectId,
        assetKind: "TEST_CASE", assetId: testCaseId, assetRevision: 4, sessionId,
        evidenceVersion: 1, reviewRevision: 2, verifiedAt: now })).toThrow(HumanReviewConflictError);
    } finally { projects.close(); }
  });
});
