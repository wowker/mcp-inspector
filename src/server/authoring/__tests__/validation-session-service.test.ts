import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationDraftDefinition } from "../../../shared/authoring/draft.js";
import { createProjectService } from "../../projects/project-service.js";
import { createTestCaseService } from "../../testing/test-case-service.js";
import { createTestSuiteService } from "../../testing/test-suite-service.js";
import {
  AuthoringDraftValidationActiveError,
  createAuthoringDraftService,
  type AuthoringDraftService,
} from "../authoring-draft-service.js";
import { createValidationSourceGuard } from "../validation-source-guard.js";
import {
  ValidationSessionTransitionError,
  ValidationSourceRevisionConflictError,
  createValidationSessionService,
  type ValidationSessionService,
} from "../validation-session-service.js";

const projectId = "00000000-0000-4000-8000-000000009001";
const validationDigest = "c".repeat(64);
const now = "2026-09-11T00:00:00.000Z";

function emptyDefinition(): AutomationDraftDefinition {
  return { version: 1, testCases: [], suites: [], sourceAssets: [], evidence: [],
    sourceRefs: [], expectationClaims: [] };
}

describe("ValidationSessionService", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-validation-service-"));
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Validation service");
    const testCases = createTestCaseService(projects);
    const testSuites = createTestSuiteService(projects);
    let sessions: ValidationSessionService;
    const guard = createValidationSourceGuard({ projects, beforeAccess: (id) => sessions.ensureInitialized(id) });
    const drafts = createAuthoringDraftService({ projects, calls: { get: vi.fn() }, testCases, testSuites,
      sourceGuard: guard, createId: randomUUID, now: () => new Date(now) });
    sessions = createValidationSessionService({ projects, drafts, testCases, testSuites,
      createId: randomUUID, now: () => new Date(now) });
    const created = drafts.create({ projectId, goal: "Validate", idempotencyKey: randomUUID() });
    const draft = drafts.get(projectId, created.draftId);
    projects.open(projectId).database.prepare(`INSERT INTO authoring_draft_validations
      (id, project_id, draft_id, draft_revision, definition_digest, tool_schema_hashes_json,
       validation_digest, status, issues_json, created_at)
      VALUES (?, ?, ?, ?, ?, '{}', ?, 'VALID', '[]', ?)`)
      .run(randomUUID(), projectId, draft.id, draft.revision, draft.definitionDigest, validationDigest, now);
    cleanups.push(() => { projects.close(); rmSync(dataRoot, { recursive: true, force: true }); });
    const source = { kind: "DRAFT" as const, draftId: draft.id, revision: draft.revision,
      definitionDigest: draft.definitionDigest };
    return { projects, testCases, testSuites, drafts, guard, get sessions() { return sessions; },
      set sessions(value: ValidationSessionService) { sessions = value; }, draft, source };
  }

  it("atomically freezes an exact Draft revision and deduplicates the same start", () => {
    const context = fixture();
    const input = { projectId, source: context.source, mode: "AGENT_DRIVEN" as const,
      validationDigest, idempotencyKey: "validate-once" };

    const started = context.sessions.start(input);

    expect(started.created).toBe(true);
    expect(started.session).toMatchObject({ phase: "READY", source: context.source,
      sourceSnapshot: emptyDefinition() });
    expect(context.sessions.start(input)).toEqual({ created: false, session: started.session });
    expect(() => context.sessions.start({ ...input, idempotencyKey: "competing-start" })).toThrow();
    expect(() => context.drafts.replace({ projectId, draftId: context.draft.id, expectedRevision: 1,
      goal: "Blocked edit", definition: emptyDefinition(), idempotencyKey: "blocked-edit" }))
      .toThrow(AuthoringDraftValidationActiveError);
  });

  it("allows ordinary revision changes before execution has claimed a source", () => {
    const context = fixture();

    expect(context.drafts.replace({ projectId, draftId: context.draft.id, expectedRevision: 1,
      goal: "Static validation did not freeze me", definition: emptyDefinition(), idempotencyKey: "edit" }))
      .toMatchObject({ revision: 2 });
  });

  it("rejects a source that changes between resolution and the immediate claim", () => {
    const context = fixture();
    let changed = false;
    const racingDrafts: Pick<AuthoringDraftService, "get"> = { get: (...args) => {
      const snapshot = context.drafts.get(...args);
      if (!changed) {
        changed = true;
        context.drafts.replace({ projectId, draftId: snapshot.id, expectedRevision: snapshot.revision,
          goal: "Won the race", definition: emptyDefinition(), idempotencyKey: "race-edit" });
      }
      return snapshot;
    } };
    const service = createValidationSessionService({ projects: context.projects, drafts: racingDrafts,
      testCases: context.testCases, testSuites: context.testSuites, now: () => new Date(now) });

    expect(() => service.start({ projectId, source: context.source, mode: "AGENT_DRIVEN",
      validationDigest, idempotencyKey: "racing-start" })).toThrow(ValidationSourceRevisionConflictError);
    expect(service.list(projectId).items).toHaveLength(0);
  });

  it("enforces the transition table, completes evidence, unlocks, and reruns an unchanged revision", () => {
    const context = fixture();
    const first = context.sessions.start({ projectId, source: context.source, mode: "AGENT_DRIVEN",
      validationDigest, idempotencyKey: "first" }).session;
    expect(() => context.sessions.transition({ projectId, sessionId: first.id,
      expectedRevision: first.revision, to: "COMPLETED" })).toThrow(ValidationSessionTransitionError);
    const running = context.sessions.transition({ projectId, sessionId: first.id,
      expectedRevision: first.revision, to: "RUNNING" });
    const evaluating = context.sessions.transition({ projectId, sessionId: first.id,
      expectedRevision: running.revision, to: "EVALUATING" });

    context.sessions.completeEvidence({ projectId, sessionId: first.id,
      expectedRevision: evaluating.revision, evidenceDigest: "e".repeat(64), machineVerdict: "PASS",
      expectations: [] });

    context.guard.assertMutable(projectId, { kind: "DRAFT", id: context.draft.id });
    const rerun = context.sessions.start({ projectId, source: context.source, mode: "AGENT_DRIVEN",
      validationDigest, idempotencyKey: "rerun" });
    expect(rerun).toMatchObject({ created: true, session: { phase: "READY", source: context.source } });
    context.sessions.transition({ projectId, sessionId: rerun.session.id,
      expectedRevision: rerun.session.revision, to: "ERROR" });
    context.drafts.replace({ projectId, draftId: context.draft.id, expectedRevision: 1,
      goal: "Continue editing", definition: emptyDefinition(), idempotencyKey: "after-validation" });
    expect(context.sessions.start({ projectId, source: context.source, mode: "AGENT_DRIVEN",
      validationDigest, idempotencyKey: "first" })).toMatchObject({ created: false,
      session: { id: first.id, phase: "COMPLETED" } });
  });

  it("records cancellation intent but keeps the source frozen until cleanup reaches a terminal phase", () => {
    const context = fixture();
    const ready = context.sessions.start({ projectId, source: context.source, mode: "AGENT_DRIVEN",
      validationDigest, idempotencyKey: "cancel" }).session;
    const running = context.sessions.transition({ projectId, sessionId: ready.id,
      expectedRevision: ready.revision, to: "RUNNING" });

    expect(context.sessions.cancel({ projectId, sessionId: ready.id,
      expectedRevision: running.revision }).phase).toBe("RUNNING");
    expect(context.sessions.cancellationRequested(projectId, ready.id)).toBe(true);
    expect(() => context.guard.assertMutable(projectId, { kind: "DRAFT", id: context.draft.id }))
      .toThrow();
    const evaluating = context.sessions.transition({ projectId, sessionId: ready.id,
      expectedRevision: running.revision, to: "EVALUATING" });
    context.sessions.transition({ projectId, sessionId: ready.id,
      expectedRevision: evaluating.revision, to: "CANCELLED" });

    expect(context.sessions.cancellationRequested(projectId, ready.id)).toBe(false);
    expect(() => context.guard.assertMutable(projectId, { kind: "DRAFT", id: context.draft.id })).not.toThrow();
  });

  it("interrupts persisted active sessions on first access after restart before unlocking", () => {
    const context = fixture();
    const started = context.sessions.start({ projectId, source: context.source, mode: "AGENT_DRIVEN",
      validationDigest, idempotencyKey: "before-restart" }).session;
    const restarted = createValidationSessionService({ projects: context.projects, drafts: context.drafts,
      testCases: context.testCases, testSuites: context.testSuites, now: () => new Date(now) });
    context.sessions = restarted;

    expect(restarted.get(projectId, started.id).phase).toBe("INTERRUPTED");
    expect(context.drafts.replace({ projectId, draftId: context.draft.id, expectedRevision: 1,
      goal: "Editable after interruption", definition: emptyDefinition(), idempotencyKey: "after-restart" }))
      .toMatchObject({ revision: 2 });
  });
});
