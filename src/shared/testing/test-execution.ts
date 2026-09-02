import { z } from "zod";
import { jsonObjectSchema } from "../tool-definition.js";
import { assertionResultSchema } from "./assertions.js";
import { testCaseDefinitionSchema } from "./test-case.js";

const uuid = z.uuid();
const timestamp = z.string().datetime({ offset: true });

export const testExecutionStatusSchema = z.enum([
  "QUEUED", "RUNNING", "PASSED", "FAILED", "ERROR", "CANCELLED", "INTERRUPTED",
]);

export const scenarioStepStatusSchema = z.enum([
  "PENDING", "RUNNING", "PASSED", "FAILED", "ERROR", "SKIPPED", "CANCELLED",
]);

const executionErrorSchema = z.object({
  code: z.string().trim().min(1).max(128),
  message: z.string().min(1).max(2_000),
}).strict();

export const testExecutionSchema = z.object({
  id: uuid,
  projectId: uuid,
  testCaseId: uuid,
  testCaseRevision: z.number().int().positive(),
  status: testExecutionStatusSchema,
  createdAt: timestamp,
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  error: executionErrorSchema.nullable(),
}).strict();

export const testExecutionStepSchema = z.object({
  id: uuid,
  executionId: uuid,
  stepId: z.string().trim().min(1).max(128),
  position: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
  status: scenarioStepStatusSchema,
  runId: uuid.nullable(),
  workflowExecutionId: uuid.nullable(),
  resolvedArguments: jsonObjectSchema.nullable(),
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  error: executionErrorSchema.nullable(),
}).strict();

export const testExecutionAssertionResultSchema = assertionResultSchema.extend({
  executionId: uuid,
  stepRecordId: uuid.nullable(),
  position: z.number().int().nonnegative(),
}).strict();

export const testExecutionDetailSchema = testExecutionSchema.extend({
  definitionSnapshot: testCaseDefinitionSchema,
  inputs: jsonObjectSchema,
  steps: z.array(testExecutionStepSchema),
  assertions: z.array(testExecutionAssertionResultSchema),
}).strict();

export const startTestExecutionRequestSchema = z.object({
  confirmDestructive: z.boolean().optional(),
  inputs: jsonObjectSchema.optional(),
}).strict();

export const testExecutionReportSummarySchema = testExecutionSchema.extend({
  testCaseName: z.string().trim().min(1).max(120),
  testCaseKind: z.enum(["tool", "scenario"]),
  assertionSummary: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export const testExecutionReportPageSchema = z.object({
  items: z.array(testExecutionReportSummarySchema),
  nextCursor: z.string().min(1).nullable(),
}).strict();

export const updateTestExecutionBaselineRequestSchema = z.object({
  revision: z.number().int().positive(),
  confirm: z.literal(true),
}).strict();

export const updateTestExecutionBaselineResultSchema = z.object({
  testCase: testCaseDefinitionSchema,
  updatedAssertions: z.number().int().positive(),
}).strict();

export type TestExecutionStatus = z.output<typeof testExecutionStatusSchema>;
export type ScenarioStepStatus = z.output<typeof scenarioStepStatusSchema>;
export type TestExecution = z.output<typeof testExecutionSchema>;
export type TestExecutionStep = z.output<typeof testExecutionStepSchema>;
export type TestExecutionAssertionResult = z.output<typeof testExecutionAssertionResultSchema>;
export type TestExecutionDetail = z.output<typeof testExecutionDetailSchema>;
export type StartTestExecutionRequest = z.output<typeof startTestExecutionRequestSchema>;
export type TestExecutionReportSummary = z.output<typeof testExecutionReportSummarySchema>;
export type TestExecutionReportPage = z.output<typeof testExecutionReportPageSchema>;
export type UpdateTestExecutionBaselineRequest = z.output<typeof updateTestExecutionBaselineRequestSchema>;
export type UpdateTestExecutionBaselineResult = z.output<typeof updateTestExecutionBaselineResultSchema>;

export function parseTestExecution(value: unknown): TestExecution {
  return testExecutionSchema.parse(value);
}

export function parseTestExecutionDetail(value: unknown): TestExecutionDetail {
  return testExecutionDetailSchema.parse(value);
}
