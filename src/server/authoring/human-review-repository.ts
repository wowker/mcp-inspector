import { randomUUID } from "node:crypto";
import {
  humanReviewDecisionKindSchema,
  humanReviewSchema,
  validatedAssetLinkSchema,
  type HumanReview,
  type HumanReviewDecisionKind,
  type ValidatedAssetLink,
} from "../../shared/authoring/human-review.js";
import type { ProjectStore } from "../projects/project-store.js";

interface ReviewRow {
  project_id: string; session_id: string; evidence_digest: string;
  state: "PENDING" | "APPROVED" | "NEEDS_CHANGE" | "REJECTED";
  revision: number; created_at: string; updated_at: string;
}

interface DecisionRow {
  id: string; expectation_local_id: string | null; decision: HumanReviewDecisionKind;
  explanation: string; review_revision: number; batch_id: string | null; decided_at: string;
}

const positiveDecisions = new Set<HumanReviewDecisionKind>(["CONFIRM_EXPECTATION", "IMPLEMENTATION_DEFECT"]);
const changeDecisions = new Set<HumanReviewDecisionKind>([
  "CORRECT_EXPECTATION", "ENVIRONMENT_ISSUE", "MORE_EVIDENCE_REQUIRED",
]);

export class HumanReviewRepository {
  private readonly createId: () => string;

  constructor(private readonly store: ProjectStore, options: { createId?: () => string } = {}) {
    this.createId = options.createId ?? randomUUID;
  }

  create(input: { projectId: string; sessionId: string; evidenceDigest: string; createdAt: string }): HumanReview {
    return this.store.database.transaction(() => {
      const existing = this.row(input.projectId, input.sessionId);
      if (existing !== null) {
        if (existing.evidence_digest !== input.evidenceDigest) throw new HumanReviewConflictError();
        return this.review(existing);
      }
      const session = this.store.database.prepare(`SELECT phase, evidence_digest FROM validation_sessions
        WHERE project_id = ? AND id = ?`).get(input.projectId, input.sessionId) as
        { phase: string; evidence_digest: string | null } | undefined;
      if (session?.phase !== "COMPLETED" || session.evidence_digest !== input.evidenceDigest) {
        throw new HumanReviewConflictError();
      }
      this.store.database.prepare(`INSERT INTO validation_reviews
        (project_id, session_id, evidence_digest, state, revision, created_at, updated_at)
        VALUES (?, ?, ?, 'PENDING', 1, ?, ?)`)
        .run(input.projectId, input.sessionId, input.evidenceDigest, input.createdAt, input.createdAt);
      return this.review(this.requiredRow(input.projectId, input.sessionId));
    }).immediate();
  }

  get(projectId: string, sessionId: string): HumanReview | null {
    const row = this.row(projectId, sessionId);
    return row === null ? null : this.review(row);
  }

  decide(input: { id: string; projectId: string; sessionId: string; expectedRevision: number;
    evidenceDigest: string; expectationLocalId: string | null; decision: HumanReviewDecisionKind;
    explanation: string; reviewerSessionId: string; decidedAt: string }): HumanReview {
    return this.store.database.transaction(() => {
      const row = this.assertPending(input.projectId, input.sessionId, input.expectedRevision, input.evidenceDigest);
      const decision = humanReviewDecisionKindSchema.parse(input.decision);
      const expectationLocalId = decision === "REJECT_TEST" ? null : input.expectationLocalId;
      if (decision !== "REJECT_TEST" && (expectationLocalId === null ||
          !this.expectationExists(input.projectId, input.sessionId, expectationLocalId))) {
        throw new HumanReviewConflictError("Review expectation is unavailable");
      }
      const revision = row.revision + 1;
      this.insertDecision({ ...input, expectationLocalId, decision, revision, batchId: null });
      const state = decision === "REJECT_TEST" ? "REJECTED"
        : changeDecisions.has(decision) ? "NEEDS_CHANGE"
          : this.coverageState(input.projectId, input.sessionId);
      this.updateReview(input.projectId, input.sessionId, row.revision, state, revision, input.decidedAt);
      return this.review(this.requiredRow(input.projectId, input.sessionId));
    }).immediate();
  }

  confirmBatch(input: { id: string; projectId: string; sessionId: string; expectedRevision: number;
    evidenceDigest: string; expectationLocalIds: string[]; reviewerSessionId: string; decidedAt: string }): HumanReview {
    return this.store.database.transaction(() => {
      const row = this.assertPending(input.projectId, input.sessionId, input.expectedRevision, input.evidenceDigest);
      const ids = [...new Set(input.expectationLocalIds)];
      if (ids.length === 0 || ids.length !== input.expectationLocalIds.length || ids.length > 500) {
        throw new HumanReviewConflictError("Review batch membership is invalid");
      }
      const placeholders = ids.map(() => "?").join(",");
      const eligible = this.store.database.prepare(`SELECT evidence.expectation_local_id
        FROM validation_expectation_evidence evidence
        JOIN validation_sessions session
          ON session.project_id = evidence.project_id AND session.id = evidence.session_id
          AND session.evidence_version = evidence.evidence_version
        WHERE evidence.project_id = ? AND evidence.session_id = ?
          AND evidence.machine_verdict = 'PASS' AND evidence.expectation_local_id IN (${placeholders})`)
        .all(input.projectId, input.sessionId, ...ids) as Array<{ expectation_local_id: string }>;
      if (eligible.length !== ids.length) throw new HumanReviewConflictError("Review batch contains an ineligible expectation");
      const revision = row.revision + 1;
      this.store.database.prepare(`INSERT INTO validation_review_batches
        (id, project_id, session_id, evidence_digest, expected_review_revision,
         resulting_review_revision, reviewer_session_id, decided_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.id, input.projectId, input.sessionId, input.evidenceDigest,
          row.revision, revision, input.reviewerSessionId, input.decidedAt);
      const member = this.store.database.prepare(`INSERT INTO validation_review_batch_members
        (project_id, batch_id, expectation_local_id, decision_id) VALUES (?, ?, ?, ?)`);
      for (const expectationLocalId of ids) {
        const decisionId = this.createId();
        this.insertDecision({ id: decisionId, projectId: input.projectId, sessionId: input.sessionId,
          expectationLocalId, decision: "CONFIRM_EXPECTATION", explanation: "",
          reviewerSessionId: input.reviewerSessionId, decidedAt: input.decidedAt, revision, batchId: input.id });
        member.run(input.projectId, input.id, expectationLocalId, decisionId);
      }
      const state = this.coverageState(input.projectId, input.sessionId);
      this.updateReview(input.projectId, input.sessionId, row.revision, state, revision, input.decidedAt);
      return this.review(this.requiredRow(input.projectId, input.sessionId));
    }).immediate();
  }

  verifyAsset(input: { id: string; projectId: string; assetKind: "TEST_CASE" | "TEST_SUITE";
    assetId: string; assetRevision: number; draftLocalId?: string | null; sessionId: string;
    evidenceVersion: number; reviewRevision: number; verifiedAt: string }): ValidatedAssetLink {
    const session = this.store.database.prepare(`SELECT session.source_kind, session.source_id,
      session.source_revision, review.state, review.revision
      FROM validation_sessions session JOIN validation_reviews review
        ON review.project_id = session.project_id AND review.session_id = session.id
      WHERE session.project_id = ? AND session.id = ? AND session.phase = 'COMPLETED'`)
      .get(input.projectId, input.sessionId) as
      { source_kind: string; source_id: string; source_revision: number; state: string; revision: number } | undefined;
    if (session === undefined || session.state !== "APPROVED" || session.revision !== input.reviewRevision) {
      throw new HumanReviewConflictError();
    }
    const direct = (session.source_kind === "TEST_CASE" || session.source_kind === "TEST_SUITE") &&
      session.source_kind === input.assetKind && session.source_id === input.assetId &&
      session.source_revision === input.assetRevision && input.draftLocalId == null;
    const mapped = session.source_kind === "DRAFT" && input.draftLocalId !== undefined && input.draftLocalId !== null &&
      this.store.database.prepare(`SELECT 1 FROM authoring_draft_asset_mappings
        WHERE project_id = ? AND draft_id = ? AND draft_local_id = ? AND asset_kind = ?
          AND formal_asset_id = ? AND formal_revision = ?`)
        .get(input.projectId, session.source_id, input.draftLocalId, input.assetKind,
          input.assetId, input.assetRevision) !== undefined;
    if (!direct && !mapped) throw new HumanReviewConflictError("Verified asset revision does not match the session source");
    try {
      this.store.database.prepare(`INSERT INTO validated_asset_links
        (id, project_id, asset_kind, asset_id, asset_revision, draft_local_id,
         session_id, evidence_version, review_revision, verified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.id, input.projectId, input.assetKind, input.assetId, input.assetRevision,
          input.draftLocalId ?? null, input.sessionId, input.evidenceVersion, input.reviewRevision, input.verifiedAt);
    } catch { throw new HumanReviewConflictError(); }
    return validatedAssetLinkSchema.parse({ id: input.id, projectId: input.projectId,
      assetKind: input.assetKind, assetId: input.assetId, assetRevision: input.assetRevision,
      draftLocalId: input.draftLocalId ?? null, sessionId: input.sessionId,
      evidenceVersion: input.evidenceVersion, reviewRevision: input.reviewRevision, verifiedAt: input.verifiedAt });
  }

  private expectationExists(projectId: string, sessionId: string, expectationLocalId: string): boolean {
    return this.store.database.prepare(`SELECT 1 FROM validation_expectation_evidence evidence
      JOIN validation_sessions session
        ON session.project_id = evidence.project_id AND session.id = evidence.session_id
        AND session.evidence_version = evidence.evidence_version
      WHERE evidence.project_id = ? AND evidence.session_id = ? AND evidence.expectation_local_id = ?`)
      .get(projectId, sessionId, expectationLocalId) !== undefined;
  }

  private coverageState(projectId: string, sessionId: string): "PENDING" | "APPROVED" {
    const evidence = this.store.database.prepare(`SELECT evidence.expectation_local_id
      FROM validation_expectation_evidence evidence
      JOIN validation_sessions session
        ON session.project_id = evidence.project_id AND session.id = evidence.session_id
        AND session.evidence_version = evidence.evidence_version
      WHERE evidence.project_id = ? AND evidence.session_id = ?`)
      .all(projectId, sessionId) as Array<{ expectation_local_id: string }>;
    const latest = new Map<string, HumanReviewDecisionKind>();
    for (const decision of this.decisions(projectId, sessionId)) {
      if (decision.expectation_local_id !== null) latest.set(decision.expectation_local_id, decision.decision);
    }
    return evidence.length > 0 && evidence.every(({ expectation_local_id }) =>
      positiveDecisions.has(latest.get(expectation_local_id)!)) ? "APPROVED" : "PENDING";
  }

  private insertDecision(input: { id: string; projectId: string; sessionId: string; revision: number;
    expectationLocalId: string | null; decision: HumanReviewDecisionKind; explanation: string;
    reviewerSessionId: string; batchId: string | null; decidedAt: string }): void {
    this.store.database.prepare(`INSERT INTO validation_review_decisions
      (id, project_id, session_id, review_revision, expectation_local_id, decision,
       explanation, reviewer_session_id, batch_id, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.id, input.projectId, input.sessionId, input.revision, input.expectationLocalId,
        input.decision, input.explanation, input.reviewerSessionId, input.batchId, input.decidedAt);
  }

  private updateReview(projectId: string, sessionId: string, expectedRevision: number,
    state: ReviewRow["state"], revision: number, updatedAt: string): void {
    const changed = this.store.database.prepare(`UPDATE validation_reviews SET state = ?, revision = ?, updated_at = ?
      WHERE project_id = ? AND session_id = ? AND revision = ? AND state = 'PENDING'`)
      .run(state, revision, updatedAt, projectId, sessionId, expectedRevision);
    if (changed.changes !== 1) throw new HumanReviewConflictError();
    this.store.database.prepare(`UPDATE validation_sessions SET review_state = ?, revision = revision + 1, updated_at = ?
      WHERE project_id = ? AND id = ? AND phase = 'COMPLETED'`)
      .run(state, updatedAt, projectId, sessionId);
  }

  private assertPending(projectId: string, sessionId: string, revision: number, evidenceDigest: string): ReviewRow {
    const row = this.requiredRow(projectId, sessionId);
    if (row.state !== "PENDING" || row.revision !== revision || row.evidence_digest !== evidenceDigest) {
      throw new HumanReviewConflictError();
    }
    return row;
  }

  private decisions(projectId: string, sessionId: string): DecisionRow[] {
    return this.store.database.prepare(`SELECT id, expectation_local_id, decision, explanation,
      review_revision, batch_id, decided_at FROM validation_review_decisions
      WHERE project_id = ? AND session_id = ? ORDER BY review_revision, id`)
      .all(projectId, sessionId) as DecisionRow[];
  }

  private review(row: ReviewRow): HumanReview {
    return humanReviewSchema.parse({ projectId: row.project_id, sessionId: row.session_id,
      evidenceDigest: row.evidence_digest, state: row.state, revision: row.revision,
      decisions: this.decisions(row.project_id, row.session_id).map((decision) => ({ id: decision.id,
        expectationLocalId: decision.expectation_local_id, decision: decision.decision,
        explanation: decision.explanation, reviewRevision: decision.review_revision,
        batchId: decision.batch_id, decidedAt: decision.decided_at })),
      createdAt: row.created_at, updatedAt: row.updated_at });
  }

  private row(projectId: string, sessionId: string): ReviewRow | null {
    return (this.store.database.prepare(`SELECT project_id, session_id, evidence_digest,
      state, revision, created_at, updated_at FROM validation_reviews
      WHERE project_id = ? AND session_id = ?`).get(projectId, sessionId) as ReviewRow | undefined) ?? null;
  }

  private requiredRow(projectId: string, sessionId: string): ReviewRow {
    const row = this.row(projectId, sessionId);
    if (row === null) throw new HumanReviewNotFoundError();
    return row;
  }
}

export class HumanReviewNotFoundError extends Error {}
export class HumanReviewConflictError extends Error {}
