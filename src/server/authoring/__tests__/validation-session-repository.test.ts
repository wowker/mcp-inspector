import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../../projects/project-service.js";
import {
  ValidationSessionRepository,
  ValidationSessionActiveError,
  ValidationSessionConflictError,
} from "../validation-session-repository.js";

const projectId = "00000000-0000-4000-8000-000000008001";
const otherProjectId = "00000000-0000-4000-8000-000000008002";
const draftId = "00000000-0000-4000-8000-000000008003";
const sessionId = "00000000-0000-4000-8000-000000008004";
const digest = "a".repeat(64);
const evidenceDigest = "b".repeat(64);
const now = "2026-09-11T00:00:00.000Z";

describe("ValidationSessionRepository", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "validation-session-repository-"));
    roots.push(dataRoot);
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Validation");
    const repository = new ValidationSessionRepository(projects.open(projectId));
    return { projects, repository };
  }

  function start(repository: ValidationSessionRepository, overrides: Record<string, unknown> = {}) {
    return repository.create({ id: sessionId, projectId,
      source: { kind: "DRAFT", draftId, revision: 3, definitionDigest: digest },
      sourceSnapshot: { version: 1, testCases: [] }, sourceSnapshotDigest: digest,
      toolSchemaHashes: { [`${projectId}:read`]: digest }, mode: "AGENT_DRIVEN",
      idempotencyKey: "start-1", requestHash: digest, createdAt: now, ...overrides });
  }

  it("claims one active source, replays one intent, and isolates projects", () => {
    const { projects, repository } = fixture();
    try {
      const created = start(repository);
      expect(created).toMatchObject({ created: true, session: { id: sessionId, phase: "READY", revision: 1,
        source: { kind: "DRAFT", draftId, revision: 3, definitionDigest: digest } } });
      expect(start(repository)).toEqual({ created: false, session: created.session });
      expect(() => start(repository, { id: "00000000-0000-4000-8000-000000008005",
        idempotencyKey: "start-2", requestHash: "c".repeat(64) })).toThrow(ValidationSessionActiveError);
      expect(repository.get(otherProjectId, sessionId)).toBeNull();
    } finally { projects.close(); }
  });

  it("transitions optimistically, appends immutable evidence, and versions AI assessments", () => {
    const { projects, repository } = fixture();
    try {
      start(repository);
      expect(repository.transition({ projectId, sessionId, expectedRevision: 1,
        from: "READY", to: "RUNNING", timestamp: now }).revision).toBe(2);
      expect(repository.transition({ projectId, sessionId, expectedRevision: 2,
        from: "RUNNING", to: "EVALUATING", timestamp: now }).revision).toBe(3);
      const evidence = repository.completeEvidence({ projectId, sessionId, expectedRevision: 3,
        id: "00000000-0000-4000-8000-000000008006", evidenceDigest, machineVerdict: "PASS",
        expectations: [{ expectationLocalId: "claim-1", verdict: "PASS", evidence: { actual: 1, expected: 1 },
          runId: null, redactionCount: 0, truncated: false }], completedAt: now });
      expect(evidence).toMatchObject({ version: 1, evidenceDigest, machineVerdict: "PASS" });
      expect(repository.getEvidence(projectId, sessionId)).toEqual(evidence);
      expect(repository.get(projectId, sessionId)).toMatchObject({ phase: "COMPLETED", revision: 4,
        machineVerdict: "PASS", reviewState: "PENDING", evidenceVersion: 1, evidenceDigest });

      const assessment = repository.appendAssessment({ id: "00000000-0000-4000-8000-000000008007",
        projectId, sessionId, evidenceDigest, idempotencyKey: "assessment-1", requestHash: "c".repeat(64),
        findings: [{ expectationLocalId: "claim-1", verdict: "PASS", confidence: "HIGH",
          explanation: "Observed evidence matches the expectation." }], createdAt: now });
      expect(assessment).toMatchObject({ version: 1, evidenceDigest, findings: [{ expectationLocalId: "claim-1" }] });
      expect(repository.appendAssessment({ id: "00000000-0000-4000-8000-000000008008",
        projectId, sessionId, evidenceDigest, idempotencyKey: "assessment-1", requestHash: "c".repeat(64),
        findings: assessment.findings, createdAt: now })).toEqual(assessment);
      expect(() => repository.appendAssessment({ id: "00000000-0000-4000-8000-000000008012",
        projectId, sessionId, evidenceDigest, idempotencyKey: "assessment-2", requestHash: "e".repeat(64),
        findings: [assessment.findings[0]!, assessment.findings[0]!], createdAt: now })).toThrow();
      expect(projects.open(projectId).database.prepare(
        "SELECT count(*) AS count FROM validation_ai_assessments WHERE project_id = ? AND session_id = ?",
      ).get(projectId, sessionId)).toEqual({ count: 1 });
      expect(() => repository.transition({ projectId, sessionId, expectedRevision: 4,
        from: "COMPLETED", to: "RUNNING", timestamp: now })).toThrow(ValidationSessionConflictError);
      expect(() => projects.open(projectId).database.prepare(
        "UPDATE validation_evidence_versions SET evidence_digest = ? WHERE id = ?",
      ).run("d".repeat(64), evidence.id)).toThrow(/immutable/i);
      expect(() => projects.open(projectId).database.prepare(
        "DELETE FROM validation_evidence_versions WHERE id = ?",
      ).run(evidence.id)).toThrow(/append-only/i);
      expect(() => projects.open(projectId).database.prepare(
        "UPDATE validation_sessions SET source_revision = 4 WHERE project_id = ? AND id = ?",
      ).run(projectId, sessionId)).toThrow(/immutable/i);
    } finally { projects.close(); }
  });

  it("rolls back failed evidence completion and interrupts active sessions after restart", () => {
    const { projects, repository } = fixture();
    try {
      start(repository);
      repository.transition({ projectId, sessionId, expectedRevision: 1, from: "READY", to: "RUNNING", timestamp: now });
      repository.transition({ projectId, sessionId, expectedRevision: 2, from: "RUNNING", to: "EVALUATING", timestamp: now });
      expect(() => repository.completeEvidence({ projectId, sessionId, expectedRevision: 3,
        id: "00000000-0000-4000-8000-000000008009", evidenceDigest, machineVerdict: "PASS",
        expectations: [{ expectationLocalId: "claim-1", verdict: "PASS",
          evidence: { oversized: "x".repeat(1_048_577) }, runId: null, redactionCount: 0, truncated: false }],
        completedAt: now })).toThrow();
      expect(repository.get(projectId, sessionId)).toMatchObject({ phase: "EVALUATING", revision: 3,
        evidenceVersion: null });
      expect(repository.interruptActive(projectId, now)).toBe(1);
      expect(repository.get(projectId, sessionId)).toMatchObject({ phase: "INTERRUPTED", revision: 4,
        reviewState: "NOT_READY" });
    } finally { projects.close(); }
  });

  it("lists bounded pages with project-bound cursors", () => {
    const { projects, repository } = fixture();
    try {
      start(repository);
      repository.transition({ projectId, sessionId, expectedRevision: 1,
        from: "READY", to: "ERROR", timestamp: now });
      repository.create({ id: "00000000-0000-4000-8000-000000008010", projectId,
        source: { kind: "TEST_CASE", testCaseId: "00000000-0000-4000-8000-000000008011", revision: 2 },
        sourceSnapshot: { kind: "tool" }, sourceSnapshotDigest: "c".repeat(64), toolSchemaHashes: {},
        mode: "MANUAL_EXECUTION", idempotencyKey: "start-page-2", requestHash: "d".repeat(64),
        createdAt: "2026-09-11T00:00:01.000Z" });

      const first = repository.list(projectId, { limit: 1 });
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      expect(repository.list(projectId, { limit: 1, cursor: first.nextCursor! }).items)
        .toEqual([expect.objectContaining({ id: sessionId })]);
      expect(() => repository.list(otherProjectId, { cursor: first.nextCursor! }))
        .toThrow(ValidationSessionConflictError);
    } finally { projects.close(); }
  });
});
