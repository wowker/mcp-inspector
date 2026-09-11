import { z } from "zod";
import { jsonObjectSchema } from "../tool-definition.js";

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().datetime({ offset: true });
const localId = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);

export const validationSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DRAFT"), draftId: uuid, revision: z.number().int().positive(),
    definitionDigest: sha256 }).strict(),
  z.object({ kind: z.literal("TEST_CASE"), testCaseId: uuid, revision: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("TEST_SUITE"), suiteId: uuid, revision: z.number().int().positive() }).strict(),
]);

export const validationExecutionModeSchema = z.enum(["MANUAL_EXECUTION", "AGENT_DRIVEN"]);
export const validationPhaseSchema = z.enum([
  "DRAFT", "VALIDATED", "READY", "RUNNING", "EVALUATING",
  "COMPLETED", "CANCELLED", "INTERRUPTED", "ERROR",
]);
export const machineVerdictSchema = z.enum(["PASS", "FAIL", "INCONCLUSIVE", "ERROR"]);
export const reviewStateSchema = z.enum(["NOT_READY", "PENDING", "APPROVED", "NEEDS_CHANGE", "REJECTED"]);

export const validationSessionSummarySchema = z.object({
  id: uuid,
  projectId: uuid,
  source: validationSourceSchema,
  sourceSnapshotDigest: sha256,
  mode: validationExecutionModeSchema,
  phase: validationPhaseSchema,
  machineVerdict: machineVerdictSchema.nullable(),
  reviewState: reviewStateSchema,
  revision: z.number().int().positive(),
  evidenceVersion: z.number().int().positive().nullable(),
  evidenceDigest: sha256.nullable(),
  createdAt: timestamp,
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  updatedAt: timestamp,
}).strict();

export const validationSessionDetailSchema = validationSessionSummarySchema.extend({
  sourceSnapshot: jsonObjectSchema,
  toolSchemaHashes: z.record(z.string().trim().min(1).max(1_024), sha256),
  executionIds: z.object({
    draftExecutionId: uuid.nullable(),
    testExecutionId: uuid.nullable(),
    suiteExecutionId: uuid.nullable(),
  }).strict(),
}).strict();

export const validationSessionPageSchema = z.object({
  items: z.array(validationSessionSummarySchema).max(100),
  nextCursor: z.string().min(1).nullable(),
}).strict();

export const listValidationSessionsInputSchema = z.object({
  projectId: uuid,
  cursor: z.string().min(1).max(4_096).regex(/^[A-Za-z0-9_-]+$/u).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  phase: validationPhaseSchema.optional(),
}).strict();

export const getValidationSessionInputSchema = z.object({ projectId: uuid, sessionId: uuid }).strict();

export const validationExpectationEvidenceSchema = z.object({
  id: uuid,
  expectationLocalId: localId,
  verdict: machineVerdictSchema,
  evidence: jsonObjectSchema,
  runId: uuid.nullable(),
  redactionCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
}).strict();

export const projectedExpectationEvidenceSchema = z.object({
  claimLocalId: localId,
  testCaseLocalId: localId,
  target: z.record(z.string(), z.unknown()),
  statement: z.string().max(2_000),
  sourceRefs: z.array(localId).max(100),
  connectionId: uuid.nullable(),
  toolName: z.string().max(512).nullable(),
  toolSchemaHash: sha256.nullable(),
  runId: uuid.nullable(),
  arguments: jsonObjectSchema.nullable(),
  executionTiming: z.object({
    startedAt: timestamp.nullable(), completedAt: timestamp.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
  }).strict(),
  assertion: z.object({
    status: z.enum(["PASSED", "FAILED", "ERROR"]).nullable(),
    resolvedPath: z.string().max(1_024).nullable(),
    actual: z.unknown().optional(),
    expected: z.unknown().optional(),
    absenceReason: z.string().max(2_000).nullable(),
    errorCode: z.string().max(128).nullable(),
    message: z.string().max(2_000).nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
  }).strict(),
}).strict();

export const validationEvidenceVersionSchema = z.object({
  id: uuid,
  projectId: uuid,
  sessionId: uuid,
  version: z.number().int().positive(),
  evidenceDigest: sha256,
  machineVerdict: machineVerdictSchema,
  redactionCount: z.number().int().nonnegative(),
  truncationCount: z.number().int().nonnegative(),
  expectations: z.array(validationExpectationEvidenceSchema).max(500),
  createdAt: timestamp,
  completedAt: timestamp,
}).strict();

export const aiAssessmentFindingSchema = z.object({
  expectationLocalId: localId,
  verdict: z.enum(["PASS", "FAIL", "INCONCLUSIVE"]),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  explanation: z.string().trim().min(1).max(4_000),
  suggestedClassification: z.enum([
    "IMPLEMENTATION_DEFECT", "EXPECTATION_DEFECT", "REQUIREMENT_CONFLICT",
    "ENVIRONMENT_ISSUE", "MORE_EVIDENCE_REQUIRED",
  ]).optional(),
}).strict();

export const validationAIAssessmentSchema = z.object({
  id: uuid,
  projectId: uuid,
  sessionId: uuid,
  version: z.number().int().positive(),
  evidenceDigest: sha256,
  findings: z.array(aiAssessmentFindingSchema).min(1).max(500),
  createdAt: timestamp,
}).strict();

export type ValidationSource = z.output<typeof validationSourceSchema>;
export type ValidationExecutionMode = z.output<typeof validationExecutionModeSchema>;
export type ValidationPhase = z.output<typeof validationPhaseSchema>;
export type MachineVerdict = z.output<typeof machineVerdictSchema>;
export type ReviewState = z.output<typeof reviewStateSchema>;
export type ValidationSessionSummary = z.output<typeof validationSessionSummarySchema>;
export type ValidationSessionDetail = z.output<typeof validationSessionDetailSchema>;
export type ValidationSessionPage = z.output<typeof validationSessionPageSchema>;
export type ValidationExpectationEvidence = z.output<typeof validationExpectationEvidenceSchema>;
export type ValidationEvidenceVersion = z.output<typeof validationEvidenceVersionSchema>;
export type AIAssessmentFinding = z.output<typeof aiAssessmentFindingSchema>;
export type ValidationAIAssessment = z.output<typeof validationAIAssessmentSchema>;
