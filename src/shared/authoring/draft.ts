import { z } from "zod";
import { jsonValueSchema } from "../tool-definition.js";
import {
  scenarioTestCaseMutationSchema,
  toolTestCaseMutationSchema,
} from "../testing/test-case.js";

export const AUTHORING_DRAFT_MAX_BYTES = 2_097_152;
export const AUTHORING_DRAFT_ASSET_MAX_COUNT = 1_000;

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
  const parsed = scenarioTestCaseMutationSchema.safeParse({ ...definition, isEnabled: false });
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

export const automationDraftDefinitionSchema = z.object({
  version: z.literal(1),
  testCases: z.array(draftTestCaseSchema).max(AUTHORING_DRAFT_ASSET_MAX_COUNT),
  suites: z.array(draftTestSuiteSchema).max(AUTHORING_DRAFT_ASSET_MAX_COUNT),
  sourceAssets: z.array(draftSourceAssetSchema).max(AUTHORING_DRAFT_ASSET_MAX_COUNT),
  evidence: z.array(draftCallEvidenceSchema).max(AUTHORING_DRAFT_ASSET_MAX_COUNT).default([]),
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

export interface AutomationDraft {
  version: 1;
  id: string;
  projectId: string;
  revision: number;
  state: "ACTIVE" | "APPLIED" | "DISCARDED";
  goal: string;
  definitionDigest: string;
  definition: z.output<typeof automationDraftDefinitionSchema>;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationDraftSummary {
  id: string;
  projectId: string;
  revision: number;
  state: AutomationDraft["state"];
  goal: string;
  testCaseCount: number;
  suiteCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationDraftPage { items: AutomationDraftSummary[]; nextCursor: string | null }
export interface AutomationDraftMutationResult {
  draftId: string;
  revision: number;
  definitionDigest: string;
}

export type AutomationDraftDefinition = z.output<typeof automationDraftDefinitionSchema>;
export type CreateDraftInput = z.output<typeof createDraftInputSchema>;
export type CreateDraftFromCallInput = z.output<typeof createDraftFromCallInputSchema>;
export type ReplaceDraftInput = z.output<typeof replaceDraftInputSchema>;
export type ListDraftsInput = z.output<typeof listDraftsInputSchema>;
