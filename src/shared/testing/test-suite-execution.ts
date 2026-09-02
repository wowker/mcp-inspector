import { z } from "zod";
import { jsonObjectSchema } from "../tool-definition.js";
import { testExecutionStatusSchema } from "./test-execution.js";
import { testSuiteDefinitionSchema } from "./test-suite.js";

const uuid = z.uuid();
const timestamp = z.string().datetime({ offset: true });
const terminalStatusSchema = z.enum(["PASSED", "FAILED", "ERROR", "CANCELLED", "INTERRUPTED"]);

export const startTestSuiteExecutionRequestSchema = z.object({
  confirmDestructive: z.boolean().optional(),
  inputsByMember: z.record(uuid, jsonObjectSchema).optional(),
}).strict();

export const testSuiteExecutionItemSchema = z.object({
  id: uuid,
  suiteExecutionId: uuid,
  memberId: uuid,
  testCaseId: uuid,
  testExecutionId: uuid.nullable(),
  position: z.number().int().nonnegative(),
  status: testExecutionStatusSchema,
}).strict();

export const testSuiteExecutionSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
}).strict();

export const testSuiteExecutionDetailSchema = z.object({
  id: uuid,
  projectId: uuid,
  suiteId: uuid,
  suiteRevision: z.number().int().positive(),
  status: testExecutionStatusSchema,
  suiteSnapshot: testSuiteDefinitionSchema,
  summary: testSuiteExecutionSummarySchema.nullable(),
  error: z.object({ code: z.string().min(1).max(128), message: z.string().max(2_000) }).strict().nullable(),
  createdAt: timestamp,
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  items: z.array(testSuiteExecutionItemSchema).max(1_000),
}).strict();

export type StartTestSuiteExecutionRequest = z.output<typeof startTestSuiteExecutionRequestSchema>;
export type TestSuiteExecutionItem = z.output<typeof testSuiteExecutionItemSchema>;
export type TestSuiteExecutionSummary = z.output<typeof testSuiteExecutionSummarySchema>;
export type TestSuiteExecutionDetail = z.output<typeof testSuiteExecutionDetailSchema>;
export type TestSuiteExecutionTerminalStatus = z.output<typeof terminalStatusSchema>;

export function parseTestSuiteExecutionDetail(value: unknown): TestSuiteExecutionDetail {
  return testSuiteExecutionDetailSchema.parse(value);
}
