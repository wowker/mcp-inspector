import { randomUUID } from "node:crypto";
import {
  aiAssessmentFindingSchema,
  machineVerdictSchema,
  validationAIAssessmentSchema,
  validationEvidenceVersionSchema,
  validationExecutionModeSchema,
  validationPhaseSchema,
  validationSessionDetailSchema,
  validationSessionPageSchema,
  validationSourceSchema,
  type AIAssessmentFinding,
  type MachineVerdict,
  type ValidationAIAssessment,
  type ValidationEvidenceVersion,
  type ValidationExecutionMode,
  type ValidationPhase,
  type ValidationSessionDetail,
  type ValidationSessionPage,
  type ValidationSource,
} from "../../shared/authoring/validation-session.js";
import { jsonObjectSchema, type JsonObject } from "../../shared/tool-definition.js";
import type { ProjectStore } from "../projects/project-store.js";

interface SessionRow {
  id: string; project_id: string; source_kind: ValidationSource["kind"]; source_id: string;
  source_revision: number; source_digest: string; execution_mode: ValidationExecutionMode; phase: ValidationPhase;
  machine_verdict: MachineVerdict | null; review_state: "NOT_READY" | "PENDING" | "APPROVED" | "NEEDS_CHANGE" | "REJECTED";
  source_snapshot_json: string; tool_schema_hashes_json: string; draft_execution_id: string | null;
  test_execution_id: string | null; suite_execution_id: string | null; evidence_version: number | null;
  evidence_digest: string | null; idempotency_key: string; request_hash: string; revision: number;
  created_at: string; started_at: string | null; completed_at: string | null; updated_at: string;
}

interface EvidenceRow {
  id: string; project_id: string; session_id: string; version: number; evidence_digest: string;
  machine_verdict: MachineVerdict; redaction_count: number; truncation_count: number;
  created_at: string; completed_at: string;
}

interface AssessmentRow {
  id: string; project_id: string; session_id: string; version: number; evidence_digest: string;
  request_hash: string; created_at: string;
}

const sessionColumns = `id, project_id, source_kind, source_id, source_revision, source_digest,
  execution_mode, phase, machine_verdict, review_state, source_snapshot_json, tool_schema_hashes_json,
  draft_execution_id, test_execution_id, suite_execution_id, evidence_version, evidence_digest,
  idempotency_key, request_hash, revision, created_at, started_at, completed_at, updated_at`;

const terminalPhases = new Set<ValidationPhase>(["COMPLETED", "CANCELLED", "INTERRUPTED", "ERROR"]);

function parseObject(value: string, label: string): JsonObject {
  try { return jsonObjectSchema.parse(JSON.parse(value)); } catch { throw new Error(`Stored Validation ${label} is corrupt`); }
}

function source(row: SessionRow): ValidationSource {
  if (row.source_kind === "DRAFT") {
    return validationSourceSchema.parse({ kind: "DRAFT", draftId: row.source_id,
      revision: row.source_revision, definitionDigest: row.source_digest });
  }
  if (row.source_kind === "TEST_CASE") {
    return validationSourceSchema.parse({ kind: "TEST_CASE", testCaseId: row.source_id, revision: row.source_revision });
  }
  return validationSourceSchema.parse({ kind: "TEST_SUITE", suiteId: row.source_id, revision: row.source_revision });
}

function detail(row: SessionRow): ValidationSessionDetail {
  return validationSessionDetailSchema.parse({
    id: row.id, projectId: row.project_id, source: source(row), sourceSnapshotDigest: row.source_digest,
    mode: row.execution_mode, phase: row.phase, machineVerdict: row.machine_verdict,
    reviewState: row.review_state, revision: row.revision, evidenceVersion: row.evidence_version,
    evidenceDigest: row.evidence_digest, sourceSnapshot: parseObject(row.source_snapshot_json, "source snapshot"),
    toolSchemaHashes: parseObject(row.tool_schema_hashes_json, "Tool Schema hashes"),
    executionIds: { draftExecutionId: row.draft_execution_id, testExecutionId: row.test_execution_id,
      suiteExecutionId: row.suite_execution_id },
    createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at, updatedAt: row.updated_at,
  });
}

function sourceIdentity(value: ValidationSource): { kind: ValidationSource["kind"]; id: string; revision: number } {
  if (value.kind === "DRAFT") return { kind: value.kind, id: value.draftId, revision: value.revision };
  if (value.kind === "TEST_CASE") return { kind: value.kind, id: value.testCaseId, revision: value.revision };
  return { kind: value.kind, id: value.suiteId, revision: value.revision };
}

function encodeCursor(projectId: string, row: SessionRow): string {
  return Buffer.from(JSON.stringify({ projectId, createdAt: row.created_at, id: row.id }), "utf8").toString("base64url");
}

function decodeCursor(projectId: string, cursor: string): { createdAt: string; id: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
    if (value.projectId !== projectId || typeof value.createdAt !== "string" || typeof value.id !== "string") throw new Error();
    return { createdAt: value.createdAt, id: value.id };
  } catch { throw new ValidationSessionConflictError("Validation Session cursor is invalid"); }
}

export class ValidationSessionRepository {
  private readonly createId: () => string;

  constructor(private readonly store: ProjectStore, options: { createId?: () => string } = {}) {
    this.createId = options.createId ?? randomUUID;
  }

  get(projectId: string, sessionId: string): ValidationSessionDetail | null {
    const row = this.store.database.prepare(`SELECT ${sessionColumns} FROM validation_sessions
      WHERE project_id = ? AND id = ?`).get(projectId, sessionId) as SessionRow | undefined;
    return row === undefined ? null : detail(row);
  }

  replay(projectId: string, idempotencyKey: string, requestHash: string): ValidationSessionDetail | null {
    const row = this.store.database.prepare(`SELECT ${sessionColumns} FROM validation_sessions
      WHERE project_id = ? AND idempotency_key = ?`).get(projectId, idempotencyKey) as SessionRow | undefined;
    if (row === undefined) return null;
    if (row.request_hash !== requestHash) throw new ValidationSessionConflictError();
    return detail(row);
  }

  list(projectId: string, input: { cursor?: string; limit?: number; phase?: ValidationPhase } = {}): ValidationSessionPage {
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    const cursor = input.cursor === undefined ? undefined : decodeCursor(projectId, input.cursor);
    const conditions = ["project_id = ?"];
    const parameters: unknown[] = [projectId];
    if (input.phase !== undefined) {
      conditions.push("phase = ?"); parameters.push(validationPhaseSchema.parse(input.phase));
    }
    if (cursor !== undefined) {
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const rows = this.store.database.prepare(`SELECT ${sessionColumns} FROM validation_sessions
      WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...parameters, limit + 1) as SessionRow[];
    const pageRows = rows.slice(0, limit);
    const summaries = pageRows.map((row) => {
      const { sourceSnapshot: _snapshot, toolSchemaHashes: _hashes, executionIds: _executions, ...summary } = detail(row);
      return summary;
    });
    return validationSessionPageSchema.parse({ items: summaries,
      nextCursor: rows.length > limit ? encodeCursor(projectId, pageRows.at(-1)!) : null });
  }

  create(input: {
    id: string; projectId: string; source: ValidationSource; sourceSnapshot: JsonObject;
    sourceSnapshotDigest: string; toolSchemaHashes: Record<string, string>; mode: ValidationExecutionMode;
    idempotencyKey: string; requestHash: string; createdAt: string; assertSourceCurrent?: () => void;
  }): { created: boolean; session: ValidationSessionDetail } {
    return this.store.database.transaction(() => {
      const parsedSource = validationSourceSchema.parse(input.source);
      const mode = validationExecutionModeSchema.parse(input.mode);
      const snapshot = jsonObjectSchema.parse(input.sourceSnapshot);
      if (parsedSource.kind === "DRAFT" && parsedSource.definitionDigest !== input.sourceSnapshotDigest) {
        throw new ValidationSessionConflictError("Draft definition digest does not match its source snapshot");
      }
      const existing = this.store.database.prepare(`SELECT ${sessionColumns} FROM validation_sessions
        WHERE project_id = ? AND idempotency_key = ?`).get(input.projectId, input.idempotencyKey) as SessionRow | undefined;
      if (existing !== undefined) {
        if (existing.request_hash !== input.requestHash) throw new ValidationSessionConflictError();
        return { created: false, session: detail(existing) };
      }
      input.assertSourceCurrent?.();
      const identity = sourceIdentity(parsedSource);
      const active = this.store.database.prepare(`SELECT 1 FROM validation_sessions
        WHERE project_id = ? AND source_kind = ? AND source_id = ?
          AND phase IN ('READY', 'RUNNING', 'EVALUATING')`)
        .get(input.projectId, identity.kind, identity.id);
      if (active !== undefined) throw new ValidationSessionActiveError();
      this.store.database.prepare(`INSERT INTO validation_sessions
        (id, project_id, source_kind, source_id, source_revision, source_digest, execution_mode,
         phase, source_snapshot_json, tool_schema_hashes_json, idempotency_key, request_hash,
         revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'READY', ?, ?, ?, ?, 1, ?, ?)`)
        .run(input.id, input.projectId, identity.kind, identity.id, identity.revision,
          input.sourceSnapshotDigest, mode, JSON.stringify(snapshot), JSON.stringify(input.toolSchemaHashes),
          input.idempotencyKey, input.requestHash, input.createdAt, input.createdAt);
      return { created: true, session: detail(this.row(input.projectId, input.id)) };
    }).immediate();
  }

  transition(input: { projectId: string; sessionId: string; expectedRevision: number;
    from: ValidationPhase; to: ValidationPhase; timestamp: string }): ValidationSessionDetail {
    const from = validationPhaseSchema.parse(input.from);
    const to = validationPhaseSchema.parse(input.to);
    if (terminalPhases.has(from)) throw new ValidationSessionConflictError();
    const completedAt = terminalPhases.has(to) ? input.timestamp : null;
    const changed = this.store.database.prepare(`UPDATE validation_sessions
      SET phase = ?, revision = revision + 1, started_at = CASE WHEN ? = 'RUNNING' THEN COALESCE(started_at, ?) ELSE started_at END,
          completed_at = COALESCE(?, completed_at), updated_at = ?
      WHERE project_id = ? AND id = ? AND revision = ? AND phase = ?`)
      .run(to, to, input.timestamp, completedAt, input.timestamp,
        input.projectId, input.sessionId, input.expectedRevision, from);
    if (changed.changes !== 1) throw new ValidationSessionConflictError();
    return detail(this.row(input.projectId, input.sessionId));
  }

  completeEvidence(input: {
    projectId: string; sessionId: string; expectedRevision: number; id: string; evidenceDigest: string;
    machineVerdict: MachineVerdict; expectations: Array<{ expectationLocalId: string; verdict: MachineVerdict;
      evidence: JsonObject; runId: string | null; redactionCount: number; truncated: boolean }>;
    completedAt: string;
  }): ValidationEvidenceVersion {
    return this.store.database.transaction(() => {
      const session = this.row(input.projectId, input.sessionId);
      if (session.phase !== "EVALUATING" || session.revision !== input.expectedRevision) {
        throw new ValidationSessionConflictError();
      }
      const verdict = machineVerdictSchema.parse(input.machineVerdict);
      const version = (this.store.database.prepare(`SELECT COALESCE(MAX(version), 0) + 1 AS version
        FROM validation_evidence_versions WHERE project_id = ? AND session_id = ?`)
        .get(input.projectId, input.sessionId) as { version: number }).version;
      const redactionCount = input.expectations.reduce((sum, item) => sum + item.redactionCount, 0);
      const truncationCount = input.expectations.filter(({ truncated }) => truncated).length;
      this.store.database.prepare(`INSERT INTO validation_evidence_versions
        (id, project_id, session_id, version, evidence_digest, machine_verdict,
         redaction_count, truncation_count, created_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.id, input.projectId, input.sessionId, version, input.evidenceDigest, verdict,
          redactionCount, truncationCount, input.completedAt, input.completedAt);
      const insert = this.store.database.prepare(`INSERT INTO validation_expectation_evidence
        (id, project_id, session_id, evidence_version, expectation_local_id, machine_verdict,
         evidence_json, run_id, redaction_count, truncated, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const expectations = input.expectations.map((item) => {
        const id = this.createId();
        const evidence = jsonObjectSchema.parse(item.evidence);
        const itemVerdict = machineVerdictSchema.parse(item.verdict);
        insert.run(id, input.projectId, input.sessionId, version, item.expectationLocalId,
          itemVerdict, JSON.stringify(evidence), item.runId, item.redactionCount,
          item.truncated ? 1 : 0, input.completedAt);
        return { id, expectationLocalId: item.expectationLocalId, verdict: itemVerdict,
          evidence, runId: item.runId, redactionCount: item.redactionCount, truncated: item.truncated };
      });
      const changed = this.store.database.prepare(`UPDATE validation_sessions
        SET phase = 'COMPLETED', machine_verdict = ?, review_state = 'PENDING', evidence_version = ?,
            evidence_digest = ?, revision = revision + 1, completed_at = ?, updated_at = ?
        WHERE project_id = ? AND id = ? AND revision = ? AND phase = 'EVALUATING'`)
        .run(verdict, version, input.evidenceDigest, input.completedAt, input.completedAt,
          input.projectId, input.sessionId, input.expectedRevision);
      if (changed.changes !== 1) throw new ValidationSessionConflictError();
      return validationEvidenceVersionSchema.parse({ id: input.id, projectId: input.projectId,
        sessionId: input.sessionId, version, evidenceDigest: input.evidenceDigest, machineVerdict: verdict,
        redactionCount, truncationCount, expectations, createdAt: input.completedAt, completedAt: input.completedAt });
    }).immediate();
  }

  getEvidence(projectId: string, sessionId: string, version?: number): ValidationEvidenceVersion | null {
    const row = this.store.database.prepare(`SELECT id, project_id, session_id, version, evidence_digest,
      machine_verdict, redaction_count, truncation_count, created_at, completed_at
      FROM validation_evidence_versions WHERE project_id = ? AND session_id = ?
        ${version === undefined ? "ORDER BY version DESC LIMIT 1" : "AND version = ?"}`)
      .get(...(version === undefined ? [projectId, sessionId] : [projectId, sessionId, version])) as EvidenceRow | undefined;
    if (row === undefined) return null;
    const evidence = this.store.database.prepare(`SELECT id, expectation_local_id, machine_verdict,
      evidence_json, run_id, redaction_count, truncated FROM validation_expectation_evidence
      WHERE project_id = ? AND session_id = ? AND evidence_version = ? ORDER BY expectation_local_id`)
      .all(projectId, sessionId, row.version) as Array<Record<string, unknown>>;
    return validationEvidenceVersionSchema.parse({ id: row.id, projectId: row.project_id,
      sessionId: row.session_id, version: row.version, evidenceDigest: row.evidence_digest,
      machineVerdict: row.machine_verdict, redactionCount: row.redaction_count,
      truncationCount: row.truncation_count, expectations: evidence.map((item) => ({ id: item.id,
        expectationLocalId: item.expectation_local_id, verdict: item.machine_verdict,
        evidence: parseObject(String(item.evidence_json), "expectation evidence"), runId: item.run_id,
        redactionCount: item.redaction_count, truncated: item.truncated === 1 })),
      createdAt: row.created_at, completedAt: row.completed_at });
  }

  appendAssessment(input: { id: string; projectId: string; sessionId: string; evidenceDigest: string;
    idempotencyKey: string; requestHash: string; findings: AIAssessmentFinding[]; createdAt: string }): ValidationAIAssessment {
    return this.store.database.transaction(() => {
      const existing = this.store.database.prepare(`SELECT id, project_id, session_id, version,
        evidence_digest, request_hash, created_at FROM validation_ai_assessments
        WHERE project_id = ? AND session_id = ? AND idempotency_key = ?`)
        .get(input.projectId, input.sessionId, input.idempotencyKey) as AssessmentRow | undefined;
      if (existing !== undefined) {
        if (existing.request_hash !== input.requestHash) throw new ValidationSessionConflictError();
        return this.assessment(existing);
      }
      const session = this.row(input.projectId, input.sessionId);
      if (session.phase !== "COMPLETED" || session.evidence_digest !== input.evidenceDigest) {
        throw new ValidationSessionConflictError();
      }
      const findings = input.findings.map((finding) => aiAssessmentFindingSchema.parse(finding));
      const version = (this.store.database.prepare(`SELECT COALESCE(MAX(version), 0) + 1 AS version
        FROM validation_ai_assessments WHERE project_id = ? AND session_id = ?`)
        .get(input.projectId, input.sessionId) as { version: number }).version;
      this.store.database.prepare(`INSERT INTO validation_ai_assessments
        (id, project_id, session_id, version, evidence_digest, idempotency_key, request_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.id, input.projectId, input.sessionId, version, input.evidenceDigest,
          input.idempotencyKey, input.requestHash, input.createdAt);
      const insert = this.store.database.prepare(`INSERT INTO validation_ai_assessment_findings
        (id, project_id, session_id, assessment_version, expectation_local_id, verdict,
         confidence, explanation, suggested_classification)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const finding of findings) insert.run(this.createId(), input.projectId, input.sessionId, version,
        finding.expectationLocalId, finding.verdict, finding.confidence, finding.explanation,
        finding.suggestedClassification ?? null);
      return validationAIAssessmentSchema.parse({ id: input.id, projectId: input.projectId,
        sessionId: input.sessionId, version, evidenceDigest: input.evidenceDigest, findings, createdAt: input.createdAt });
    }).immediate();
  }

  interruptActive(projectId: string, timestamp: string): number {
    return this.store.database.prepare(`UPDATE validation_sessions
      SET phase = 'INTERRUPTED', review_state = 'NOT_READY', revision = revision + 1,
          completed_at = ?, updated_at = ?
      WHERE project_id = ? AND phase IN ('READY', 'RUNNING', 'EVALUATING')`)
      .run(timestamp, timestamp, projectId).changes;
  }

  private assessment(row: AssessmentRow): ValidationAIAssessment {
    const findings = this.store.database.prepare(`SELECT expectation_local_id, verdict, confidence,
      explanation, suggested_classification FROM validation_ai_assessment_findings
      WHERE project_id = ? AND session_id = ? AND assessment_version = ? ORDER BY expectation_local_id`)
      .all(row.project_id, row.session_id, row.version) as Array<Record<string, unknown>>;
    return validationAIAssessmentSchema.parse({ id: row.id, projectId: row.project_id,
      sessionId: row.session_id, version: row.version, evidenceDigest: row.evidence_digest,
      findings: findings.map((finding) => ({ expectationLocalId: finding.expectation_local_id,
        verdict: finding.verdict, confidence: finding.confidence, explanation: finding.explanation,
        ...(finding.suggested_classification === null ? {} : { suggestedClassification: finding.suggested_classification }) })),
      createdAt: row.created_at });
  }

  private row(projectId: string, sessionId: string): SessionRow {
    const row = this.store.database.prepare(`SELECT ${sessionColumns} FROM validation_sessions
      WHERE project_id = ? AND id = ?`).get(projectId, sessionId) as SessionRow | undefined;
    if (row === undefined) throw new ValidationSessionNotFoundError();
    return row;
  }
}

export class ValidationSessionNotFoundError extends Error {}
export class ValidationSessionConflictError extends Error {}
export class ValidationSessionActiveError extends Error {}
