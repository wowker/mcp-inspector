import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  applyAuthoringDraftInputSchema,
  type ApplyAuthoringDraftInput,
  type AuthoringAppliedAsset,
  type AuthoringApplyResult,
} from "../../shared/authoring/apply.js";
import { testCaseDefinitionSchema, type TestCaseDefinition, type ToolTarget } from "../../shared/testing/test-case.js";
import { testSuiteDefinitionSchema, type TestSuiteDefinition } from "../../shared/testing/test-suite.js";
import type { ProjectService } from "../projects/project-service.js";
import { TestCaseRepository } from "../testing/test-case-repository.js";
import type { TestCaseService } from "../testing/test-case-service.js";
import { TestSuiteRepository } from "../testing/test-suite-repository.js";
import type { TestSuiteService } from "../testing/test-suite-service.js";
import { canonicalJson } from "../tools/tool-service.js";
import {
  AuthoringApplyRepository,
  AuthoringApplyRepositoryAlreadyAppliedError,
  AuthoringApplyRepositoryConflictError,
} from "./authoring-apply-repository.js";
import type { AuthoringDraftService } from "./authoring-draft-service.js";
import type { AuthoringDraftValidator } from "./authoring-draft-validator.js";

export class AuthoringApplyValidationError extends Error {
  constructor() { super("Authoring Draft validation is stale or invalid"); this.name = "AuthoringApplyValidationError"; }
}
export class AuthoringApplyConflictError extends Error {
  constructor() { super("Authoring Draft Apply conflicts with current state"); this.name = "AuthoringApplyConflictError"; }
}

export interface AuthoringApplyService {
  apply(input: ApplyAuthoringDraftInput): AuthoringApplyResult;
}

function targetsOf(definition: TestCaseDefinition): ToolTarget[] {
  return definition.kind === "tool" ? [definition.target]
    : [...definition.steps, ...definition.cleanupSteps].map(({ target }) => target);
}

export function createAuthoringApplyService(options: {
  projects: ProjectService;
  drafts: Pick<AuthoringDraftService, "get">;
  validator: Pick<AuthoringDraftValidator, "validate">;
  testCases: Pick<TestCaseService, "get">;
  testSuites: Pick<TestSuiteService, "get">;
  createId?: () => string;
  now?: () => Date;
  afterStage?(stage: string): void;
}): AuthoringApplyService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const generatedId = (label: string) => {
    const id = createId();
    if (!z.string().uuid().safeParse(id).success) throw new Error(`${label} ID generator returned an invalid UUID`);
    return id;
  };

  return {
    apply(rawInput) {
      const input = applyAuthoringDraftInputSchema.parse(rawInput);
      const store = options.projects.open(input.projectId);
      const repository = new AuthoringApplyRepository(store);
      const requestHash = createHash("sha256").update(canonicalJson(input)).digest("hex");
      try {
        const replay = repository.replay(input.projectId, input.idempotencyKey, requestHash);
        if (replay !== null) return replay;
        const draft = options.drafts.get(input.projectId, input.draftId);
        if (draft.state !== "ACTIVE" || draft.revision !== input.expectedRevision) throw new AuthoringApplyConflictError();
        const validation = options.validator.validate({ projectId: input.projectId,
          draftId: input.draftId, revision: input.expectedRevision });
        if (validation.status !== "VALID" || validation.validationDigest !== input.validationDigest ||
            validation.definitionDigest !== draft.definitionDigest) throw new AuthoringApplyValidationError();

        const existingCases = new Map<string, TestCaseDefinition>();
        const existingSuites = new Map<string, TestSuiteDefinition>();
        for (const source of draft.definition.sourceAssets) {
          if (source.kind === "TEST_CASE") {
            const current = options.testCases.get(input.projectId, source.assetId);
            if (current.revision !== source.revision) throw new AuthoringApplyValidationError();
            existingCases.set(source.draftLocalId, current);
          } else {
            const current = options.testSuites.get(input.projectId, source.assetId);
            if (current.revision !== source.revision) throw new AuthoringApplyValidationError();
            existingSuites.set(source.draftLocalId, current);
          }
        }
        const timestamp = now().toISOString();
        return repository.apply({ applyId: generatedId("Authoring Apply"), projectId: input.projectId,
          draftId: input.draftId, draftRevision: input.expectedRevision, validationId: validation.id,
          validationDigest: input.validationDigest, idempotencyKey: input.idempotencyKey, requestHash,
          timestamp, afterStage: options.afterStage,
          writeAssets: () => {
            const caseRepository = new TestCaseRepository(store);
            const suiteRepository = new TestSuiteRepository(store);
            const assets: AuthoringAppliedAsset[] = [];
            const formalCaseIds = new Map<string, string>();
            for (const authored of draft.definition.testCases) {
              const { localId, ...mutation } = authored;
              const existing = existingCases.get(localId);
              if (existing !== undefined && existing.kind !== mutation.kind) {
                throw new AuthoringApplyValidationError();
              }
              const definition = testCaseDefinitionSchema.parse({ ...mutation,
                id: existing?.id ?? generatedId("Test case"), projectId: input.projectId,
                revision: existing === undefined ? 1 : existing.revision + 1,
                isEnabled: existing?.isEnabled ?? false,
                createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp });
              const targets = targetsOf(definition);
              if (targets.some(({ connectionId }) => !caseRepository.hasConnection(input.projectId, connectionId))) {
                throw new AuthoringApplyValidationError();
              }
              if (existing === undefined) {
                caseRepository.insert(definition, generatedId("Test case revision"), targets);
              } else if (caseRepository.update(definition, existing.revision,
                generatedId("Test case revision"), targets) !== "updated") {
                throw new AuthoringApplyConflictError();
              }
              formalCaseIds.set(localId, definition.id);
              assets.push({ draftLocalId: localId, kind: "TEST_CASE",
                formalAssetId: definition.id, revision: definition.revision });
            }
            options.afterStage?.("TEST_CASES_WRITTEN");

            for (const authored of draft.definition.suites) {
              const existing = existingSuites.get(authored.localId);
              const existingMembers = new Map(existing?.members.map((member) => [member.testCaseId, member]) ?? []);
              const definition = testSuiteDefinitionSchema.parse({
                id: existing?.id ?? generatedId("Test suite"), projectId: input.projectId,
                name: authored.name, description: authored.description, tags: authored.tags,
                revision: existing === undefined ? 1 : existing.revision + 1,
                members: authored.members.map((member) => {
                  const testCaseId = formalCaseIds.get(member.testCaseLocalId);
                  if (testCaseId === undefined) throw new AuthoringApplyValidationError();
                  return { id: existingMembers.get(testCaseId)?.id ?? generatedId("Test suite member"),
                    testCaseId, position: member.position, isEnabled: member.isEnabled };
                }),
                executionPolicy: authored.executionPolicy,
                createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp,
              });
              if (existing === undefined) suiteRepository.insert(definition);
              else if (suiteRepository.update(definition, existing.revision) !== "updated") {
                throw new AuthoringApplyConflictError();
              }
              assets.push({ draftLocalId: authored.localId, kind: "TEST_SUITE",
                formalAssetId: definition.id, revision: definition.revision });
            }
            options.afterStage?.("SUITES_WRITTEN");
            return assets;
          } });
      } catch (error) {
        if (error instanceof AuthoringApplyRepositoryConflictError ||
            error instanceof AuthoringApplyRepositoryAlreadyAppliedError) throw new AuthoringApplyConflictError();
        throw error;
      }
    },
  };
}
