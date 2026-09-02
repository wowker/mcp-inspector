import { z } from "zod";
import { jsonValueSchema, type JsonValue } from "./tool-definition.js";
import { runErrorSchema, runStatusSchema } from "./run-replay.js";

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });

export const comparisonIgnoreExpressionSchema = z.string().min(1).max(512);

export const comparisonIgnoreRuleSchema = z.object({
  id: uuid,
  projectId: uuid,
  expression: comparisonIgnoreExpressionSchema,
  position: z.number().int().nonnegative(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const comparisonRuleSetSchema = z.object({
  rules: z.array(comparisonIgnoreRuleSchema).max(100),
}).strict();

export const replaceComparisonRulesSchema = z.object({
  expressions: z.array(comparisonIgnoreExpressionSchema).max(100),
}).strict();

export const structuralChangeSchema = z.object({
  path: z.string().min(1).max(4_096),
  kind: z.enum(["ADDED", "REMOVED", "CHANGED", "TYPE_CHANGED"]),
  source: jsonValueSchema.optional(),
  replay: jsonValueSchema.optional(),
  ignored: z.boolean(),
}).strict();

export const structuralDiffSchema = z.object({
  changes: z.array(structuralChangeSchema).max(2_000),
  truncated: z.boolean(),
  visitedNodes: z.number().int().nonnegative(),
  serializedBytes: z.number().int().nonnegative(),
}).strict();

export const comparisonUnavailableReasonSchema = z.enum([
  "REPLAY_NOT_FOUND",
  "NOT_DIRECT_REPLAY",
  "SOURCE_NOT_FOUND",
  "REPLAY_ACTIVE",
  "SOURCE_ACTIVE",
  "REPLAY_NOT_SUCCEEDED",
  "SOURCE_NOT_SUCCEEDED",
  "REPLAY_RESPONSE_MISSING",
  "SOURCE_RESPONSE_MISSING",
  "REPLAY_RESPONSE_TRUNCATED",
  "SOURCE_RESPONSE_TRUNCATED",
  "REPLAY_RESPONSE_INVALID",
  "SOURCE_RESPONSE_INVALID",
]);

export const comparisonRunMetadataSchema = z.object({
  id: uuid,
  connectionId: uuid,
  toolName: z.string().min(1).max(512),
  toolSnapshotId: uuid,
  status: runStatusSchema,
  error: runErrorSchema.nullable(),
  truncated: z.boolean().nullable(),
  originalBytes: z.number().int().nonnegative().nullable(),
}).strict();

export const runComparisonSchema = z.object({
  projectId: uuid,
  replayRunId: uuid,
  sourceRunId: uuid.nullable(),
  comparable: z.boolean(),
  unavailableReason: comparisonUnavailableReasonSchema.nullable(),
  source: comparisonRunMetadataSchema.nullable(),
  replay: comparisonRunMetadataSchema.nullable(),
  ruleExpressions: z.array(comparisonIgnoreExpressionSchema).max(100),
  diff: structuralDiffSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.comparable !== (value.diff !== null) || value.comparable !== (value.unavailableReason === null)) {
    context.addIssue({ code: "custom", message: "Comparison availability is inconsistent" });
  }
  if (value.replay !== null && value.replay.id !== value.replayRunId) {
    context.addIssue({ code: "custom", path: ["replay"], message: "Replay identity is inconsistent" });
  }
  if (value.source !== null && value.source.id !== value.sourceRunId) {
    context.addIssue({ code: "custom", path: ["source"], message: "Source identity is inconsistent" });
  }
});

export type ComparisonIgnoreRule = z.output<typeof comparisonIgnoreRuleSchema>;
export type ComparisonRuleSet = z.output<typeof comparisonRuleSetSchema>;
export type StructuralChange = z.output<typeof structuralChangeSchema>;
export type StructuralDiff = z.output<typeof structuralDiffSchema>;
export type ComparisonUnavailableReason = z.output<typeof comparisonUnavailableReasonSchema>;
export type ComparisonRunMetadata = z.output<typeof comparisonRunMetadataSchema>;
export type RunComparison = z.output<typeof runComparisonSchema>;
export type ComparableJson = JsonValue;
