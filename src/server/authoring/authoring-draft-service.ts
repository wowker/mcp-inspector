import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  automationDraftDefinitionSchema,
  createDraftFromCallInputSchema,
  createDraftInputSchema,
  getDraftInputSchema,
  listDraftsInputSchema,
  replaceDraftInputSchema,
  type AutomationDraft,
  type AutomationDraftDefinition,
  type AutomationDraftMutationResult,
  type AutomationDraftPage,
  type CreateDraftFromCallInput,
  type CreateDraftInput,
  type ListDraftsInput,
  type ReplaceDraftInput,
} from "../../shared/authoring/draft.js";
import type { TestCaseDefinition } from "../../shared/testing/test-case.js";
import type { TestSuiteDefinition } from "../../shared/testing/test-suite.js";
import type { ProjectService } from "../projects/project-service.js";
import type { TestCaseService } from "../testing/test-case-service.js";
import type { TestSuiteService } from "../testing/test-suite-service.js";
import { canonicalJson } from "../tools/tool-service.js";
import type { AuthoringCallService } from "./authoring-call-service.js";
import type { ValidationSourceGuard } from "./validation-source-guard.js";
import { ValidationSourceActiveError } from "./validation-source-guard.js";
import {
  AuthoringDraftIdempotencyConflictError,
  AuthoringDraftRepository,
  AuthoringDraftRepositoryConflictError,
} from "./authoring-draft-repository.js";

const uuid = z.string().uuid();

export class AuthoringDraftNotFoundError extends Error {
  constructor() { super("Authoring Draft not found"); this.name = "AuthoringDraftNotFoundError"; }
}
export class AuthoringDraftInvalidError extends Error {
  constructor(message = "Authoring Draft is invalid") { super(message); this.name = "AuthoringDraftInvalidError"; }
}
export class AuthoringDraftTooLargeError extends AuthoringDraftInvalidError {
  constructor() { super("Authoring Draft exceeds the size limit"); this.name = "AuthoringDraftTooLargeError"; }
}
export class AuthoringDraftRevisionConflictError extends Error {
  constructor() { super("Authoring Draft revision conflict"); this.name = "AuthoringDraftRevisionConflictError"; }
}
export class AuthoringDraftSourceRevisionConflictError extends Error {
  constructor() { super("Authoring Draft source revision conflict"); this.name = "AuthoringDraftSourceRevisionConflictError"; }
}
export class AuthoringDraftValidationActiveError extends Error {
  readonly code = "DRAFT_VALIDATION_ACTIVE";

  constructor() { super("Authoring Draft is frozen by an active Validation Session");
    this.name = "AuthoringDraftValidationActiveError"; }
}

export interface AuthoringDraftService {
  create(input: CreateDraftInput): AutomationDraftMutationResult;
  createFromCall(input: CreateDraftFromCallInput): AutomationDraftMutationResult;
  list(projectId: string, input?: Omit<ListDraftsInput, "projectId">): AutomationDraftPage;
  get(projectId: string, draftId: string): AutomationDraft;
  replace(input: ReplaceDraftInput): AutomationDraftMutationResult;
}

function emptyDefinition(): AutomationDraftDefinition {
  return { version: 1, testCases: [], suites: [], sourceAssets: [], evidence: [],
    sourceRefs: [], expectationClaims: [] };
}

function digest(definition: AutomationDraftDefinition): string {
  return createHash("sha256").update(canonicalJson(definition)).digest("hex");
}

function localTestCase(definition: TestCaseDefinition) {
  const { id, projectId, revision, isEnabled, createdAt, updatedAt, ...authored } = definition;
  void projectId; void isEnabled; void createdAt; void updatedAt;
  return { localId: `test-${id}`, ...authored, sourceRevision: revision };
}

function draftTestCase(definition: TestCaseDefinition) {
  const { sourceRevision, ...draft } = localTestCase(definition);
  return { draft, sourceRevision };
}

function parseDefinition(value: unknown): AutomationDraftDefinition {
  const parsed = automationDraftDefinitionSchema.safeParse(value);
  if (!parsed.success) {
    if (parsed.error.issues.some(({ message }) => message.includes("exceeds 2 MiB"))) {
      throw new AuthoringDraftTooLargeError();
    }
    throw new AuthoringDraftInvalidError(parsed.error.issues[0]?.message);
  }
  return parsed.data;
}

export function createAuthoringDraftService(options: {
  projects: ProjectService;
  calls: Pick<AuthoringCallService, "get">;
  testCases: Pick<TestCaseService, "get">;
  testSuites: Pick<TestSuiteService, "get">;
  sourceGuard?: Pick<ValidationSourceGuard, "assertMutable">;
  createId?: () => string;
  now?: () => Date;
}): AuthoringDraftService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const repository = (projectId: string) => new AuthoringDraftRepository(options.projects.open(projectId));

  function generatedId(label: string): string {
    const id = createId();
    if (!uuid.safeParse(id).success) throw new Error(`${label} ID generator returned an invalid UUID`);
    return id;
  }

  function create(input: CreateDraftInput | CreateDraftFromCallInput, operation: string,
    definition: AutomationDraftDefinition): AutomationDraftMutationResult {
    const parsedDefinition = parseDefinition(definition);
    const definitionDigest = digest(parsedDefinition);
    const timestamp = now().toISOString();
    return repository(input.projectId).create({
      id: generatedId("Authoring Draft"), revisionId: generatedId("Authoring Draft revision"),
      projectId: input.projectId, goal: input.goal, definition: parsedDefinition, definitionDigest,
      idempotencyKey: input.idempotencyKey, operation,
      requestHash: createHash("sha256").update(canonicalJson(input)).digest("hex"), createdAt: timestamp,
    });
  }

  function definitionFromTestCase(projectId: string, assetId: string,
    revision: number): AutomationDraftDefinition {
    const formal = options.testCases.get(projectId, assetId);
    if (formal.revision !== revision) throw new AuthoringDraftSourceRevisionConflictError();
    const { draft, sourceRevision } = draftTestCase(formal);
    return parseDefinition({
      ...emptyDefinition(),
      testCases: [draft],
      sourceAssets: [{ draftLocalId: draft.localId, kind: "TEST_CASE", assetId, revision: sourceRevision }],
    });
  }

  function definitionFromSuite(projectId: string, assetId: string,
    revision: number): AutomationDraftDefinition {
    const formalSuite = options.testSuites.get(projectId, assetId);
    if (formalSuite.revision !== revision) throw new AuthoringDraftSourceRevisionConflictError();
    const copiedCases = formalSuite.members.map((member) => draftTestCase(options.testCases.get(projectId, member.testCaseId)));
    const byFormalId = new Map(copiedCases.map(({ draft }) => [draft.localId.slice("test-".length), draft.localId]));
    const suite = {
      localId: `suite-${formalSuite.id}`,
      name: formalSuite.name,
      description: formalSuite.description,
      tags: formalSuite.tags,
      members: formalSuite.members.map((member) => ({
        localId: `member-${member.id}`,
        testCaseLocalId: byFormalId.get(member.testCaseId)!,
        position: member.position,
        isEnabled: member.isEnabled,
      })),
      executionPolicy: formalSuite.executionPolicy,
    };
    return parseDefinition({
      ...emptyDefinition(),
      testCases: copiedCases.map(({ draft }) => draft),
      suites: [suite],
      sourceAssets: [
        ...copiedCases.map(({ draft, sourceRevision }) => ({
          draftLocalId: draft.localId, kind: "TEST_CASE" as const,
          assetId: draft.localId.slice("test-".length), revision: sourceRevision,
        })),
        { draftLocalId: suite.localId, kind: "TEST_SUITE" as const, assetId, revision: formalSuite.revision },
      ],
    });
  }

  return {
    create(rawInput) {
      const parsed = createDraftInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new AuthoringDraftInvalidError(parsed.error.issues[0]?.message);
      const requestHash = createHash("sha256").update(canonicalJson(parsed.data)).digest("hex");
      const replay = repository(parsed.data.projectId).replay(
        parsed.data.projectId, parsed.data.idempotencyKey, "CREATE_DRAFT", requestHash,
      );
      if (replay !== null) return replay;
      let definition = emptyDefinition();
      if (parsed.data.source?.kind === "TEST_CASE") {
        definition = definitionFromTestCase(parsed.data.projectId, parsed.data.source.assetId, parsed.data.source.revision);
      } else if (parsed.data.source?.kind === "TEST_SUITE") {
        definition = definitionFromSuite(parsed.data.projectId, parsed.data.source.assetId, parsed.data.source.revision);
      }
      return create(parsed.data, "CREATE_DRAFT", definition);
    },
    createFromCall(rawInput) {
      const parsed = createDraftFromCallInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new AuthoringDraftInvalidError(parsed.error.issues[0]?.message);
      const requestHash = createHash("sha256").update(canonicalJson(parsed.data)).digest("hex");
      const replay = repository(parsed.data.projectId).replay(
        parsed.data.projectId, parsed.data.idempotencyKey, "CREATE_DRAFT_FROM_CALL", requestHash,
      );
      if (replay !== null) return replay;
      const call = options.calls.get(parsed.data.projectId, parsed.data.callId);
      const localId = `call-${call.id}`;
      const definition = parseDefinition({
        ...emptyDefinition(),
        testCases: [{
          localId,
          kind: "tool",
          name: `Draft ${call.toolName}`.slice(0, 120),
          description: "Created from a sanitized Authoring Tool call.",
          tags: [],
          target: { connectionId: call.connectionId, toolName: call.toolName },
          arguments: call.arguments,
          assertions: [],
          timeoutMs: 30_000,
        }],
        evidence: [{ callId: call.id, runId: call.runId, testCaseLocalId: localId, response: call.response }],
      });
      return create(parsed.data, "CREATE_DRAFT_FROM_CALL", definition);
    },
    list(projectId, rawInput = {}) {
      const parsed = listDraftsInputSchema.safeParse({ projectId, ...rawInput });
      if (!parsed.success) throw new AuthoringDraftInvalidError(parsed.error.issues[0]?.message);
      const { projectId: _projectId, ...input } = parsed.data;
      return repository(projectId).list(projectId, input);
    },
    get(projectId, draftId) {
      const parsed = getDraftInputSchema.safeParse({ projectId, draftId });
      if (!parsed.success) throw new AuthoringDraftNotFoundError();
      const draft = repository(parsed.data.projectId).get(parsed.data.projectId, parsed.data.draftId);
      if (draft === null) throw new AuthoringDraftNotFoundError();
      return { ...draft, definition: parseDefinition(draft.definition) };
    },
    replace(rawInput) {
      const parsed = replaceDraftInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new AuthoringDraftInvalidError(parsed.error.issues[0]?.message);
      const definition = parseDefinition(parsed.data.definition);
      const current = repository(parsed.data.projectId).get(parsed.data.projectId, parsed.data.draftId);
      if (current === null) throw new AuthoringDraftNotFoundError();
      try {
        return repository(parsed.data.projectId).replace({
          revisionId: generatedId("Authoring Draft revision"), projectId: parsed.data.projectId,
          draftId: parsed.data.draftId, expectedRevision: parsed.data.expectedRevision,
          goal: parsed.data.goal, definition, definitionDigest: digest(definition),
          idempotencyKey: parsed.data.idempotencyKey, operation: "REPLACE_DRAFT",
          requestHash: createHash("sha256").update(canonicalJson(parsed.data)).digest("hex"),
          updatedAt: now().toISOString(),
          assertMutable: () => options.sourceGuard?.assertMutable(parsed.data.projectId,
            { kind: "DRAFT", id: parsed.data.draftId }),
        });
      } catch (error) {
        if (error instanceof ValidationSourceActiveError) throw new AuthoringDraftValidationActiveError();
        if (error instanceof AuthoringDraftRepositoryConflictError) throw new AuthoringDraftRevisionConflictError();
        throw error;
      }
    },
  };
}

export { AuthoringDraftIdempotencyConflictError };
