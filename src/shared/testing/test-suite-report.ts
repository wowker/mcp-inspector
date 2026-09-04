import { z } from "zod";
import { testExecutionStatusSchema, scenarioStepStatusSchema } from "./test-execution.js";
import {
  testSuiteExecutionDetailSchema,
  testSuiteExecutionItemSchema,
  testSuiteExecutionSummarySchema,
} from "./test-suite-execution.js";

const uuid = z.uuid();
const timestamp = z.string().datetime({ offset: true });
const executionErrorSchema = z.object({
  code: z.string().trim().min(1).max(128),
  message: z.string().min(1).max(2_000),
}).strict();

export const testSuiteExecutionReportSummarySchema = z.object({
  id: uuid,
  projectId: uuid,
  suiteId: uuid,
  suiteRevision: z.number().int().positive(),
  suiteName: z.string().trim().min(1).max(120),
  status: testExecutionStatusSchema,
  summary: testSuiteExecutionSummarySchema.nullable(),
  createdAt: timestamp,
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
}).strict();

export const testSuiteExecutionReportPageSchema = z.object({
  items: z.array(testSuiteExecutionReportSummarySchema).max(100),
  nextCursor: z.string().min(1).nullable(),
}).strict();

export const testSuiteReportTestExecutionSummarySchema = z.object({
  id: uuid,
  testCaseId: uuid,
  testCaseRevision: z.number().int().positive(),
  testCaseName: z.string().trim().min(1).max(120),
  testCaseKind: z.enum(["tool", "scenario"]),
  status: testExecutionStatusSchema,
  createdAt: timestamp,
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  error: executionErrorSchema.nullable(),
}).strict();

export const testSuiteReportCallSchema = z.object({
  stepRecordId: uuid,
  stepId: z.string().trim().min(1).max(128),
  stepKind: z.enum(["tool", "cleanup"]),
  position: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
  runId: uuid.nullable(),
  workflowExecutionId: uuid.nullable(),
  status: scenarioStepStatusSchema,
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  error: executionErrorSchema.nullable(),
}).strict();

export const testSuiteExecutionReportOutlineSchema = z.object({
  execution: testSuiteExecutionDetailSchema,
  members: z.array(z.object({
    item: testSuiteExecutionItemSchema,
    testExecution: testSuiteReportTestExecutionSummarySchema.nullable(),
    calls: z.array(testSuiteReportCallSchema).max(20_000),
  }).strict()).max(1_000),
}).strict();

const reportMetadataShape = {
  name: z.string().trim().min(1).max(120),
  versionLabel: z.string().trim().min(1).max(40),
  note: z.string().trim().max(500).nullable(),
};

export const createSavedTestSuiteReportRequestSchema = z.object({
  suiteId: uuid,
  suiteExecutionId: uuid,
  name: reportMetadataShape.name,
  versionLabel: reportMetadataShape.versionLabel,
  note: reportMetadataShape.note.optional(),
}).strict();

export const updateSavedTestSuiteReportRequestSchema = z.object({
  revision: z.number().int().positive(),
  name: reportMetadataShape.name.optional(),
  versionLabel: reportMetadataShape.versionLabel.optional(),
  note: reportMetadataShape.note.optional(),
}).strict().refine(({ name, versionLabel, note }) =>
  name !== undefined || versionLabel !== undefined || note !== undefined,
{ message: "At least one saved report metadata field is required" });

export const savedTestSuiteReportSchema = z.object({
  id: uuid,
  projectId: uuid,
  suiteId: uuid,
  suiteExecutionId: uuid,
  name: reportMetadataShape.name,
  versionLabel: reportMetadataShape.versionLabel,
  note: reportMetadataShape.note,
  revision: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const savedTestSuiteReportPageSchema = z.object({
  items: z.array(savedTestSuiteReportSchema).max(100),
  nextCursor: z.string().min(1).nullable(),
}).strict();

export type TestSuiteExecutionReportSummary = z.output<typeof testSuiteExecutionReportSummarySchema>;
export type TestSuiteExecutionReportPage = z.output<typeof testSuiteExecutionReportPageSchema>;
export type TestSuiteReportTestExecutionSummary = z.output<typeof testSuiteReportTestExecutionSummarySchema>;
export type TestSuiteReportCall = z.output<typeof testSuiteReportCallSchema>;
export type TestSuiteExecutionReportOutline = z.output<typeof testSuiteExecutionReportOutlineSchema>;
export type CreateSavedTestSuiteReportRequest = z.output<typeof createSavedTestSuiteReportRequestSchema>;
export type UpdateSavedTestSuiteReportRequest = z.output<typeof updateSavedTestSuiteReportRequestSchema>;
export type SavedTestSuiteReport = z.output<typeof savedTestSuiteReportSchema>;
export type SavedTestSuiteReportPage = z.output<typeof savedTestSuiteReportPageSchema>;

export function parseTestSuiteExecutionReportOutline(value: unknown): TestSuiteExecutionReportOutline {
  return testSuiteExecutionReportOutlineSchema.parse(value);
}

export function parseSavedTestSuiteReport(value: unknown): SavedTestSuiteReport {
  return savedTestSuiteReportSchema.parse(value);
}
