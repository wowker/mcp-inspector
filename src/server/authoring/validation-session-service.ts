import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  validationExecutionModeSchema,
  validationSourceSchema,
  type MachineVerdict,
  type ValidationEvidenceVersion,
  type ValidationExecutionMode,
  type ValidationPhase,
  type ValidationSessionDetail,
  type ValidationSessionPage,
  type ValidationSource,
} from "../../shared/authoring/validation-session.js";
import { jsonObjectSchema, type JsonObject } from "../../shared/tool-definition.js";
import type { ProjectService } from "../projects/project-service.js";
import type { TestCaseService } from "../testing/test-case-service.js";
import type { TestCaseDefinition, ToolTarget } from "../../shared/testing/test-case.js";
import type { TestSuiteService } from "../testing/test-suite-service.js";
import { canonicalJson } from "../tools/tool-service.js";
import type { AuthoringDraftService } from "./authoring-draft-service.js";
import {
  ValidationSessionConflictError,
  ValidationSessionNotFoundError,
  ValidationSessionRepository,
} from "./validation-session-repository.js";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const terminalPhases = new Set<ValidationPhase>(["COMPLETED", "CANCELLED", "INTERRUPTED", "ERROR"]);
const transitions: Readonly<Record<ValidationPhase, ReadonlySet<ValidationPhase>>> = {
  DRAFT: new Set(["VALIDATED", "ERROR"]),
  VALIDATED: new Set(["READY", "ERROR"]),
  READY: new Set(["RUNNING", "CANCELLED", "INTERRUPTED", "ERROR"]),
  RUNNING: new Set(["EVALUATING", "CANCELLED", "INTERRUPTED", "ERROR"]),
  EVALUATING: new Set(["CANCELLED", "INTERRUPTED", "ERROR"]),
  COMPLETED: new Set(), CANCELLED: new Set(), INTERRUPTED: new Set(), ERROR: new Set(),
};

interface ValidationStartInput {
  projectId: string;
  source: ValidationSource;
  mode: ValidationExecutionMode;
  validationDigest?: string;
  idempotencyKey: string;
}

interface ResolvedSource {
  snapshot: JsonObject;
  digest: string;
  toolSchemaHashes: Record<string, string>;
  assertCurrent(): void;
}

export interface ValidationSessionService {
  start(input: ValidationStartInput): { created: boolean; session: ValidationSessionDetail };
  get(projectId: string, sessionId: string): ValidationSessionDetail;
  list(projectId: string, input?: { cursor?: string; limit?: number; phase?: ValidationPhase }): ValidationSessionPage;
  transition(input: { projectId: string; sessionId: string; expectedRevision: number;
    to: ValidationPhase }): ValidationSessionDetail;
  completeEvidence(input: { projectId: string; sessionId: string; expectedRevision: number;
    evidenceDigest: string; machineVerdict: MachineVerdict; expectations: Array<{
      expectationLocalId: string; verdict: MachineVerdict; evidence: JsonObject; runId: string | null;
      redactionCount: number; truncated: boolean;
    }> }): ValidationEvidenceVersion;
  cancel(input: { projectId: string; sessionId: string; expectedRevision: number }): ValidationSessionDetail;
  cancellationRequested(projectId: string, sessionId: string): boolean;
  interruptActive(projectId: string): number;
  ensureInitialized(projectId: string): void;
}

function digest(value: JsonObject): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function sourceIdentity(source: ValidationSource): { kind: ValidationSource["kind"]; id: string; revision: number } {
  if (source.kind === "DRAFT") return { kind: source.kind, id: source.draftId, revision: source.revision };
  if (source.kind === "TEST_CASE") return { kind: source.kind, id: source.testCaseId, revision: source.revision };
  return { kind: source.kind, id: source.suiteId, revision: source.revision };
}

export function createValidationSessionService(options: {
  projects: ProjectService;
  drafts: Pick<AuthoringDraftService, "get">;
  testCases: Pick<TestCaseService, "get">;
  testSuites: Pick<TestSuiteService, "get">;
  createId?: () => string;
  now?: () => Date;
  onCancel?: (projectId: string, sessionId: string) => void;
}): ValidationSessionService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const initializedProjects = new Set<string>();
  const cancellationRequests = new Set<string>();
  const repository = (projectId: string) => new ValidationSessionRepository(options.projects.open(projectId));

  function cancellationKey(projectId: string, sessionId: string): string {
    return `${projectId}\0${sessionId}`;
  }

  function targetsOf(testCase: TestCaseDefinition): ToolTarget[] {
    return testCase.kind === "tool" ? [testCase.target]
      : [...testCase.steps, ...testCase.cleanupSteps].map(({ target }) => target);
  }

  function currentToolSchemaHashes(projectId: string, testCases: TestCaseDefinition[]): Record<string, string> {
    const store = options.projects.open(projectId);
    const targets = new Map<string, ToolTarget>();
    for (const testCase of testCases) for (const target of targetsOf(testCase)) {
      targets.set(`${target.connectionId}:${target.toolName}`, target);
    }
    const hashes: Record<string, string> = {};
    for (const [key, target] of [...targets].sort(([left], [right]) => left.localeCompare(right))) {
      const tool = store.database.prepare(`SELECT snapshot.content_hash
        FROM tools tool JOIN tool_snapshots snapshot ON snapshot.id = tool.current_snapshot_id
        WHERE tool.project_id = ? AND tool.connection_id = ? AND tool.name = ? AND tool.status <> 'removed'`)
        .get(projectId, target.connectionId, target.toolName) as { content_hash: string } | undefined;
      if (tool === undefined) throw new ValidationSourceRevisionConflictError("Validation source Tool is unavailable");
      hashes[key] = sha256.parse(tool.content_hash);
    }
    return hashes;
  }

  function interruptActive(projectId: string): number {
    initializedProjects.add(projectId);
    return repository(projectId).interruptActive(projectId, now().toISOString());
  }

  function ensureInitialized(projectId: string): void {
    if (initializedProjects.has(projectId)) return;
    interruptActive(projectId);
  }

  function resolveSource(projectId: string, rawSource: ValidationSource,
    validationDigest: string | undefined): ResolvedSource {
    const source = validationSourceSchema.parse(rawSource);
    const store = options.projects.open(projectId);
    const identity = sourceIdentity(source);
    if (source.kind === "DRAFT") {
      if (validationDigest === undefined || !sha256.safeParse(validationDigest).success) {
        throw new ValidationSourceRevisionConflictError("A valid Draft validation digest is required");
      }
      const draft = options.drafts.get(projectId, source.draftId);
      if (draft.state !== "ACTIVE" || draft.revision !== source.revision ||
          draft.definitionDigest !== source.definitionDigest) throw new ValidationSourceRevisionConflictError();
      const validation = store.database.prepare(`SELECT tool_schema_hashes_json FROM authoring_draft_validations
        WHERE project_id = ? AND draft_id = ? AND draft_revision = ? AND definition_digest = ?
          AND validation_digest = ? AND status = 'VALID'`).get(projectId, source.draftId, source.revision,
        source.definitionDigest, validationDigest) as { tool_schema_hashes_json: string } | undefined;
      if (validation === undefined) throw new ValidationSourceRevisionConflictError("Draft validation is stale or invalid");
      const snapshot = jsonObjectSchema.parse(draft.definition);
      const toolSchemaHashes = z.record(z.string(), sha256).parse(JSON.parse(validation.tool_schema_hashes_json));
      return { snapshot, digest: source.definitionDigest, toolSchemaHashes,
        assertCurrent() {
          const current = store.database.prepare(`SELECT revision, state, definition_digest FROM authoring_drafts
            WHERE project_id = ? AND id = ?`).get(projectId, source.draftId) as
            { revision: number; state: string; definition_digest: string } | undefined;
          const valid = store.database.prepare(`SELECT 1 FROM authoring_draft_validations
            WHERE project_id = ? AND draft_id = ? AND draft_revision = ? AND definition_digest = ?
              AND validation_digest = ? AND status = 'VALID'`).get(projectId, source.draftId,
            source.revision, source.definitionDigest, validationDigest);
          if (current?.revision !== source.revision || current.state !== "ACTIVE" ||
              current.definition_digest !== source.definitionDigest || valid === undefined) {
            throw new ValidationSourceRevisionConflictError();
          }
        } };
    }
    if (validationDigest !== undefined) throw new ValidationSourceRevisionConflictError("Validation digest is Draft-only");
    if (source.kind === "TEST_CASE") {
      const testCase = options.testCases.get(projectId, source.testCaseId);
      if (testCase.revision !== source.revision) throw new ValidationSourceRevisionConflictError();
      const snapshot = jsonObjectSchema.parse(testCase);
      const snapshotDigest = digest(snapshot);
      const toolSchemaHashes = currentToolSchemaHashes(projectId, [testCase]);
      return { snapshot, digest: snapshotDigest, toolSchemaHashes, assertCurrent() {
        const current = options.testCases.get(projectId, identity.id);
        const currentSnapshot = jsonObjectSchema.parse(current);
        if (current.revision !== identity.revision || digest(currentSnapshot) !== snapshotDigest ||
            canonicalJson(currentToolSchemaHashes(projectId, [current])) !== canonicalJson(toolSchemaHashes)) {
          throw new ValidationSourceRevisionConflictError();
        }
      } };
    }
    const suite = options.testSuites.get(projectId, source.suiteId);
    if (suite.revision !== source.revision) throw new ValidationSourceRevisionConflictError();
    const cases = suite.members.map(({ testCaseId }) => options.testCases.get(projectId, testCaseId));
    const snapshot = jsonObjectSchema.parse({ suite, testCases: cases });
    const snapshotDigest = digest(snapshot);
    const toolSchemaHashes = currentToolSchemaHashes(projectId, cases);
    return { snapshot, digest: snapshotDigest, toolSchemaHashes, assertCurrent() {
      const currentSuite = options.testSuites.get(projectId, identity.id);
      const currentCases = currentSuite.members.map(({ testCaseId }) => options.testCases.get(projectId, testCaseId));
      const currentSnapshot = jsonObjectSchema.parse({ suite: currentSuite, testCases: currentCases });
      if (currentSuite.revision !== identity.revision || digest(currentSnapshot) !== snapshotDigest ||
          canonicalJson(currentToolSchemaHashes(projectId, currentCases)) !== canonicalJson(toolSchemaHashes)) {
        throw new ValidationSourceRevisionConflictError();
      }
    } };
  }

  function required(projectId: string, sessionId: string): ValidationSessionDetail {
    const session = repository(projectId).get(projectId, sessionId);
    if (session === null) throw new ValidationSessionNotFoundError();
    return session;
  }

  function assertSessionSourceCurrent(session: ValidationSessionDetail): void {
    const source = session.source;
    if (source.kind === "DRAFT") {
      const draft = options.drafts.get(session.projectId, source.draftId);
      if (draft.state !== "ACTIVE" || draft.revision !== source.revision ||
          draft.definitionDigest !== source.definitionDigest) throw new ValidationSourceRevisionConflictError();
      return;
    }
    if (source.kind === "TEST_CASE") {
      const testCase = options.testCases.get(session.projectId, source.testCaseId);
      const snapshot = jsonObjectSchema.parse(testCase);
      if (testCase.revision !== source.revision || digest(snapshot) !== session.sourceSnapshotDigest) {
        throw new ValidationSourceRevisionConflictError();
      }
      return;
    }
    const suite = options.testSuites.get(session.projectId, source.suiteId);
    const cases = suite.members.map(({ testCaseId }) => options.testCases.get(session.projectId, testCaseId));
    const snapshot = jsonObjectSchema.parse({ suite, testCases: cases });
    if (suite.revision !== source.revision || digest(snapshot) !== session.sourceSnapshotDigest) {
      throw new ValidationSourceRevisionConflictError();
    }
  }

  return {
    ensureInitialized,
    start(rawInput) {
      ensureInitialized(rawInput.projectId);
      const source = validationSourceSchema.parse(rawInput.source);
      const mode = validationExecutionModeSchema.parse(rawInput.mode);
      const requestHash = createHash("sha256").update(canonicalJson({ source, mode,
        validationDigest: rawInput.validationDigest ?? null })).digest("hex");
      const replay = repository(rawInput.projectId).replay(rawInput.projectId, rawInput.idempotencyKey, requestHash);
      if (replay !== null) return { created: false, session: replay };
      const resolved = resolveSource(rawInput.projectId, source, rawInput.validationDigest);
      return repository(rawInput.projectId).create({ id: createId(), projectId: rawInput.projectId,
        source, sourceSnapshot: resolved.snapshot, sourceSnapshotDigest: resolved.digest,
        toolSchemaHashes: resolved.toolSchemaHashes, mode, idempotencyKey: rawInput.idempotencyKey,
        requestHash, createdAt: now().toISOString(), assertSourceCurrent: resolved.assertCurrent });
    },
    get(projectId, sessionId) { ensureInitialized(projectId); return required(projectId, sessionId); },
    list(projectId, input = {}) { ensureInitialized(projectId); return repository(projectId).list(projectId, input); },
    transition(input) {
      ensureInitialized(input.projectId);
      const current = required(input.projectId, input.sessionId);
      if (current.revision !== input.expectedRevision || !transitions[current.phase].has(input.to)) {
        throw new ValidationSessionTransitionError();
      }
      if (current.phase === "READY" && input.to === "RUNNING") {
        assertSessionSourceCurrent(current);
      }
      const transitioned = repository(input.projectId).transition({ ...input, from: current.phase,
        timestamp: now().toISOString() });
      if (terminalPhases.has(transitioned.phase)) cancellationRequests.delete(cancellationKey(input.projectId, input.sessionId));
      return transitioned;
    },
    completeEvidence(input) {
      ensureInitialized(input.projectId);
      const evidence = repository(input.projectId).completeEvidence({ ...input, id: createId(),
        completedAt: now().toISOString() });
      cancellationRequests.delete(cancellationKey(input.projectId, input.sessionId));
      return evidence;
    },
    cancel(input) {
      ensureInitialized(input.projectId);
      const session = required(input.projectId, input.sessionId);
      if (session.revision !== input.expectedRevision || terminalPhases.has(session.phase)) {
        throw new ValidationSessionConflictError();
      }
      cancellationRequests.add(cancellationKey(input.projectId, input.sessionId));
      options.onCancel?.(input.projectId, input.sessionId);
      return session;
    },
    cancellationRequested(projectId, sessionId) {
      ensureInitialized(projectId);
      return cancellationRequests.has(cancellationKey(projectId, sessionId));
    },
    interruptActive,
  };
}

export class ValidationSourceRevisionConflictError extends Error {
  constructor(message = "Validation source revision or digest is stale") {
    super(message); this.name = "ValidationSourceRevisionConflictError";
  }
}

export class ValidationSessionTransitionError extends Error {
  constructor() { super("Validation Session phase transition is invalid"); this.name = "ValidationSessionTransitionError"; }
}
