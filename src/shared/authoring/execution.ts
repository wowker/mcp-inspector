import { z } from "zod";
import { jsonObjectSchema } from "../tool-definition.js";
import { assertionResultSchema } from "../testing/assertions.js";

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().datetime({ offset: true });
const executionErrorSchema = z.object({
  code: z.string().trim().min(1).max(128),
  message: z.string().min(1).max(2_000),
}).strict();

export const authoringDraftExecutionStatusSchema = z.enum([
  "QUEUED", "VALIDATING", "RUNNING_SETUP", "RUNNING_STEPS", "RUNNING_ASSERTIONS",
  "RUNNING_CLEANUP", "PASSED", "FAILED", "ERROR", "CANCELLED", "INTERRUPTED",
]);

export const startAuthoringDraftExecutionInputSchema = z.object({
  projectId: uuid,
  draftId: uuid,
  revision: z.number().int().positive(),
  validationDigest: sha256,
  idempotencyKey: z.string().min(1).max(200),
  inputs: z.record(z.string().trim().min(1).max(128), jsonObjectSchema).default({}),
}).strict();

export const getAuthoringDraftExecutionInputSchema = z.object({
  projectId: uuid,
  executionId: uuid,
}).strict();

export const cancelAuthoringDraftExecutionInputSchema = getAuthoringDraftExecutionInputSchema;

export const listAuthoringDraftExecutionsInputSchema = z.object({
  projectId: uuid,
  draftId: uuid.optional(),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();

const authoringDraftExecutionStepSchema = z.object({
  stepId: z.string().trim().min(1).max(128),
  position: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
  status: z.enum(["PASSED", "FAILED", "ERROR", "SKIPPED", "CANCELLED"]),
  arguments: jsonObjectSchema.nullable(),
  runId: uuid.nullable(),
  assertions: z.array(assertionResultSchema),
  error: executionErrorSchema.nullable(),
}).strict();

const authoringDraftExecutionTestCaseSchema = z.object({
  localId: z.string().trim().min(1).max(128),
  kind: z.enum(["tool", "scenario"]),
  status: z.enum(["PASSED", "FAILED", "ERROR", "CANCELLED"]),
  steps: z.array(authoringDraftExecutionStepSchema),
  assertions: z.array(assertionResultSchema),
  error: executionErrorSchema.nullable(),
}).strict();

export const authoringDraftExecutionSummarySchema = z.object({
  id: uuid,
  projectId: uuid,
  draftId: uuid,
  draftRevision: z.number().int().positive(),
  definitionDigest: sha256,
  validationDigest: sha256,
  status: authoringDraftExecutionStatusSchema,
  createdAt: timestamp,
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
}).strict();

export const authoringDraftExecutionDetailSchema = authoringDraftExecutionSummarySchema.extend({
  inputs: z.record(z.string(), jsonObjectSchema),
  testCases: z.array(authoringDraftExecutionTestCaseSchema),
  error: executionErrorSchema.nullable(),
}).strict();

export const authoringDraftExecutionPageSchema = z.object({
  items: z.array(authoringDraftExecutionSummarySchema),
}).strict();

export type AuthoringDraftExecutionStatus = z.output<typeof authoringDraftExecutionStatusSchema>;
export type StartAuthoringDraftExecutionInput = z.output<typeof startAuthoringDraftExecutionInputSchema>;
export type AuthoringDraftExecutionSummary = z.output<typeof authoringDraftExecutionSummarySchema>;
export type AuthoringDraftExecutionDetail = z.output<typeof authoringDraftExecutionDetailSchema>;
export type AuthoringDraftExecutionTestCase = z.output<typeof authoringDraftExecutionTestCaseSchema>;
