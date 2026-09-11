import { z } from "zod";
import { jsonValueSchema } from "../tool-definition.js";
import {
  scenarioTestCaseMutationSchema,
  toolTestCaseMutationSchema,
} from "../testing/test-case.js";

export const AUTHORING_DRAFT_MAX_BYTES = 2_097_152;
export const AUTHORING_DRAFT_ASSET_MAX_COUNT = 1_000;
export const AUTHORING_DRAFT_SOURCE_MAX_COUNT = 500;
export const AUTHORING_DRAFT_EXPECTATION_MAX_COUNT = 500;

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const localId = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const idempotencyKey = z.string().min(1).max(200);

export const draftToolTestCaseSchema = toolTestCaseMutationSchema
  .omit({ isEnabled: true })
  .extend({ localId });

const { isEnabled: _scenarioEnablement, ...scenarioAuthoredShape } = scenarioTestCaseMutationSchema.shape;
export const draftScenarioTestCaseSchema = z.object({
  ...scenarioAuthoredShape,
  localId,
}).strict().superRefine((definition, context) => {
  const { localId: _localId, ...authored } = definition;
  const parsed = scenarioTestCaseMutationSchema.safeParse({ ...authored, isEnabled: false });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) context.addIssue({ ...issue, path: issue.path });
  }
});

export const draftTestCaseSchema = z.discriminatedUnion("kind", [
  draftToolTestCaseSchema,
  draftScenarioTestCaseSchema,
]);

export const draftTestSuiteMemberSchema = z.object({
  localId,
  testCaseLocalId: localId,
  position: z.number().int().nonnegative(),
  isEnabled: z.boolean().default(true),
}).strict();

export const draftTestSuiteSchema = z.object({
  localId,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000),
  tags: z.array(z.string().trim().min(1).max(80)).max(20),
  members: z.array(draftTestSuiteMemberSchema).max(1_000),
  executionPolicy: z.object({
    concurrency: z.number().int().min(1).max(8),
    stopOnFailure: z.boolean(),
  }).strict(),
}).strict().superRefine((suite, context) => {
  const unique = (values: string[], path: string, message: string) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: "custom", path: [path], message });
  };
  unique(suite.tags.map((tag) => tag.toLocaleLowerCase()), "tags", "Suite tags must be unique");
  unique(suite.members.map(({ localId: id }) => id), "members", "Suite member local IDs must be unique");
  unique(suite.members.map(({ testCaseLocalId }) => testCaseLocalId), "members", "Suite test cases must be unique");
  const positions = suite.members.map(({ position }) => String(position));
  unique(positions, "members", "Suite member positions must be unique");
});

export const draftSourceAssetSchema = z.object({
  draftLocalId: localId,
  kind: z.enum(["TEST_CASE", "TEST_SUITE"]),
  assetId: uuid,
  revision: z.number().int().positive(),
}).strict();

export const draftCallEvidenceSchema = z.object({
  callId: uuid,
  runId: uuid.nullable(),
  testCaseLocalId: localId,
  response: jsonValueSchema.nullable(),
}).strict();

export const sourceAuthoritySchema = z.enum(["AUTHORITATIVE", "INFORMATIVE", "OBSERVED"]);
export const sourceKindSchema = z.enum([
  "TOOL_DEFINITION", "PRODUCT_REQUIREMENT", "CODE_REFERENCE", "USER_EXPECTATION",
]);
export const sourceReferenceSchema = z.object({
  localId,
  kind: sourceKindSchema,
  authority: sourceAuthoritySchema,
  label: z.string().trim().min(1).max(300),
  locator: z.string().trim().min(1).max(2_000).optional(),
  digest: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  excerpt: z.string().max(4_000).optional(),
}).strict();

export const expectationTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TOOL_ASSERTION"), assertionId: localId }).strict(),
  z.object({ kind: z.literal("STEP_ASSERTION"), stepId: localId, assertionId: localId }).strict(),
  z.object({ kind: z.literal("SCENARIO_ASSERTION"), assertionId: localId }).strict(),
  z.object({ kind: z.literal("CLEANUP_ASSERTION"), stepId: localId, assertionId: localId }).strict(),
]);

export const expectationClaimSchema = z.object({
  localId,
  testCaseLocalId: localId,
  target: expectationTargetSchema,
  statement: z.string().trim().min(1).max(2_000),
  rationale: z.string().trim().min(1).max(4_000),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  sourceRefs: z.array(localId).max(100)
    .refine((values) => new Set(values).size === values.length, "Expectation source references must be unique"),
  reviewPriority: z.enum(["NORMAL", "REQUIRED"]),
}).strict();

function expectationTargetMatchCount(
  testCase: z.output<typeof draftTestCaseSchema>,
  target: z.output<typeof expectationTargetSchema>,
): number {
  if (testCase.kind === "tool") {
    return target.kind === "TOOL_ASSERTION"
      ? testCase.assertions.filter(({ id }) => id === target.assertionId).length
      : 0;
  }
  if (target.kind === "SCENARIO_ASSERTION") {
    return testCase.assertions.filter(({ id }) => id === target.assertionId).length;
  }
  if (target.kind === "STEP_ASSERTION" || target.kind === "CLEANUP_ASSERTION") {
    const steps = target.kind === "STEP_ASSERTION" ? testCase.steps : testCase.cleanupSteps;
    return steps.filter(({ id }) => id === target.stepId)
      .flatMap(({ assertions }) => assertions)
      .filter(({ id }) => id === target.assertionId).length;
  }
  return 0;
}

export const automationDraftDefinitionSchema = z.object({
  version: z.literal(1),
  testCases: z.array(draftTestCaseSchema).max(AUTHORING_DRAFT_ASSET_MAX_COUNT),
  suites: z.array(draftTestSuiteSchema).max(AUTHORING_DRAFT_ASSET_MAX_COUNT),
  sourceAssets: z.array(draftSourceAssetSchema).max(AUTHORING_DRAFT_ASSET_MAX_COUNT),
  evidence: z.array(draftCallEvidenceSchema).max(AUTHORING_DRAFT_ASSET_MAX_COUNT).default([]),
  sourceRefs: z.array(sourceReferenceSchema).max(AUTHORING_DRAFT_SOURCE_MAX_COUNT).default([]),
  expectationClaims: z.array(expectationClaimSchema).max(AUTHORING_DRAFT_EXPECTATION_MAX_COUNT).default([]),
}).strict().superRefine((definition, context) => {
  const testCases = new Set<string>();
  const suites = new Set<string>();
  definition.testCases.forEach((testCase, index) => {
    if (testCases.has(testCase.localId)) {
      context.addIssue({ code: "custom", path: ["testCases", index, "localId"], message: "Draft local IDs must be unique" });
    }
    testCases.add(testCase.localId);
  });
  definition.suites.forEach((suite, index) => {
    if (suites.has(suite.localId) || testCases.has(suite.localId)) {
      context.addIssue({ code: "custom", path: ["suites", index, "localId"], message: "Draft local IDs must be unique" });
    }
    suites.add(suite.localId);
    suite.members.forEach((member, memberIndex) => {
      if (!testCases.has(member.testCaseLocalId)) {
        context.addIssue({ code: "custom", path: ["suites", index, "members", memberIndex, "testCaseLocalId"],
          message: `Draft test case '${member.testCaseLocalId}' does not exist` });
      }
    });
  });
  definition.sourceAssets.forEach((source, index) => {
    const exists = source.kind === "TEST_CASE" ? testCases.has(source.draftLocalId) : suites.has(source.draftLocalId);
    if (!exists) context.addIssue({ code: "custom", path: ["sourceAssets", index, "draftLocalId"],
      message: `Draft source local ID '${source.draftLocalId}' does not exist` });
  });
  definition.evidence.forEach((evidence, index) => {
    if (!testCases.has(evidence.testCaseLocalId)) {
      context.addIssue({ code: "custom", path: ["evidence", index, "testCaseLocalId"],
        message: `Draft evidence test case '${evidence.testCaseLocalId}' does not exist` });
    }
  });
  const sourceIds = new Set<string>();
  definition.sourceRefs.forEach((source, index) => {
    if (sourceIds.has(source.localId)) {
      context.addIssue({ code: "custom", path: ["sourceRefs", index, "localId"],
        message: "Draft source reference local IDs must be unique" });
    }
    sourceIds.add(source.localId);
  });
  const claimIds = new Set<string>();
  definition.expectationClaims.forEach((claim, index) => {
    if (claimIds.has(claim.localId)) {
      context.addIssue({ code: "custom", path: ["expectationClaims", index, "localId"],
        message: "Draft expectation local IDs must be unique" });
    }
    claimIds.add(claim.localId);
    claim.sourceRefs.forEach((sourceId, sourceIndex) => {
      if (!sourceIds.has(sourceId)) {
        context.addIssue({ code: "custom", path: ["expectationClaims", index, "sourceRefs", sourceIndex],
          message: `Draft expectation source '${sourceId}' does not exist` });
      }
    });
    const testCase = definition.testCases.find(({ localId: id }) => id === claim.testCaseLocalId);
    if (testCase === undefined) {
      context.addIssue({ code: "custom", path: ["expectationClaims", index, "testCaseLocalId"],
        message: `Draft expectation test case '${claim.testCaseLocalId}' does not exist` });
      return;
    }
    if (expectationTargetMatchCount(testCase, claim.target) !== 1) {
      context.addIssue({ code: "custom", path: ["expectationClaims", index, "target"],
        message: "Draft expectation target does not resolve to exactly one assertion in its test case" });
    }
  });
  if (new TextEncoder().encode(JSON.stringify(definition)).byteLength > AUTHORING_DRAFT_MAX_BYTES) {
    context.addIssue({ code: "custom", message: "Draft definition exceeds 2 MiB" });
  }
});

export const createDraftInputSchema = z.object({
  projectId: uuid,
  goal: z.string().max(2_000),
  idempotencyKey,
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("TEST_CASE"), assetId: uuid, revision: z.number().int().positive() }).strict(),
    z.object({ kind: z.literal("TEST_SUITE"), assetId: uuid, revision: z.number().int().positive() }).strict(),
  ]).optional(),
}).strict();

export const createDraftFromCallInputSchema = z.object({
  projectId: uuid,
  callId: uuid,
  goal: z.string().max(2_000),
  idempotencyKey,
}).strict();

export const replaceDraftInputSchema = z.object({
  projectId: uuid,
  draftId: uuid,
  expectedRevision: z.number().int().positive(),
  goal: z.string().max(2_000),
  definition: automationDraftDefinitionSchema,
  idempotencyKey,
}).strict();

export const listDraftsInputSchema = z.object({
  projectId: uuid,
  cursor: z.string().min(1).max(4_096).regex(/^[A-Za-z0-9_-]+$/u).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  state: z.enum(["ACTIVE", "APPLIED", "DISCARDED"]).optional(),
}).strict();

export const getDraftInputSchema = z.object({ projectId: uuid, draftId: uuid }).strict();

export const automationDraftStateSchema = z.enum(["ACTIVE", "APPLIED", "DISCARDED"]);
export const automationDraftSchema = z.object({
  version: z.literal(1), id: uuid, projectId: uuid, revision: z.number().int().positive(),
  state: automationDraftStateSchema, goal: z.string().max(2_000), definitionDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  definition: automationDraftDefinitionSchema, createdAt: timestamp, updatedAt: timestamp,
}).strict();
export const automationDraftSummarySchema = automationDraftSchema.pick({
  id: true, projectId: true, revision: true, state: true, goal: true, createdAt: true, updatedAt: true,
}).extend({ testCaseCount: z.number().int().nonnegative(), suiteCount: z.number().int().nonnegative() }).strict();
export const automationDraftPageSchema = z.object({
  items: z.array(automationDraftSummarySchema), nextCursor: z.string().min(1).nullable(),
}).strict();
export const automationDraftMutationResultSchema = z.object({
  draftId: uuid, revision: z.number().int().positive(), definitionDigest: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export type AutomationDraft = z.output<typeof automationDraftSchema>;
export type AutomationDraftSummary = z.output<typeof automationDraftSummarySchema>;
export type AutomationDraftPage = z.output<typeof automationDraftPageSchema>;
export type AutomationDraftMutationResult = z.output<typeof automationDraftMutationResultSchema>;

export type AutomationDraftDefinition = z.output<typeof automationDraftDefinitionSchema>;
export type SourceAuthority = z.output<typeof sourceAuthoritySchema>;
export type SourceKind = z.output<typeof sourceKindSchema>;
export type SourceReference = z.output<typeof sourceReferenceSchema>;
export type ExpectationTarget = z.output<typeof expectationTargetSchema>;
export type ExpectationClaim = z.output<typeof expectationClaimSchema>;
export type CreateDraftInput = z.output<typeof createDraftInputSchema>;
export type CreateDraftFromCallInput = z.output<typeof createDraftFromCallInputSchema>;
export type ReplaceDraftInput = z.output<typeof replaceDraftInputSchema>;
export type ListDraftsInput = z.output<typeof listDraftsInputSchema>;

export function expectationClaimHasAuthorityConflict(
  definition: Pick<AutomationDraftDefinition, "sourceRefs">,
  claim: Pick<ExpectationClaim, "sourceRefs">,
): boolean {
  const referenced = new Set(claim.sourceRefs);
  const digestsByLocator = new Map<string, Set<string>>();
  for (const source of definition.sourceRefs) {
    if (!referenced.has(source.localId) || source.authority !== "AUTHORITATIVE" ||
        source.locator === undefined || source.digest === undefined) continue;
    const digests = digestsByLocator.get(source.locator) ?? new Set<string>();
    digests.add(source.digest);
    digestsByLocator.set(source.locator, digests);
  }
  return [...digestsByLocator.values()].some(({ size }) => size > 1);
}
