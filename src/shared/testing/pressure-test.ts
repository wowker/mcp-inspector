import { z } from "zod";
import { jsonObjectSchema } from "../tool-definition.js";
import { testCaseKindSchema } from "./test-case.js";

const uuid = z.uuid();
const timestamp = z.string().datetime({ offset: true });
const safeErrorSchema = z.object({
  code: z.string().trim().min(1).max(128),
  message: z.string().min(1).max(2_000),
}).strict();

export const pressureTestLoadSchema = z.object({
  virtualUsers: z.number().int().min(1).max(20),
  rampUpMs: z.number().int().min(0).max(120_000),
  durationMs: z.number().int().min(1_000).max(600_000),
  thinkTimeMs: z.number().int().min(0).max(10_000),
  maxIterations: z.number().int().min(1).max(1_000),
}).strict();

export const pressureTestThresholdsSchema = z.object({
  maxErrorRate: z.number().min(0).max(1),
  maxP95DurationMs: z.number().int().min(1).max(300_000),
  minRequestsPerSecond: z.number().min(0).max(10_000),
  stopOnErrorRate: z.boolean(),
}).strict();

const pressureTestShape = {
  id: uuid,
  projectId: uuid,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000),
  revision: z.number().int().positive(),
  target: z.object({ testCaseId: uuid }).strict(),
  inputs: jsonObjectSchema,
  load: pressureTestLoadSchema,
  thresholds: pressureTestThresholdsSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
};

export const pressureTestDefinitionSchema = z.object(pressureTestShape).strict();
export const pressureTestMutationSchema = z.object(pressureTestShape).omit({
  id: true, projectId: true, revision: true, createdAt: true, updatedAt: true,
}).strict();
export const updatePressureTestRequestSchema = z.object({
  revision: z.number().int().positive(),
  definition: pressureTestMutationSchema,
}).strict();
export const pressureTestPageSchema = z.object({
  items: z.array(pressureTestDefinitionSchema).max(100),
  nextCursor: z.string().min(1).nullable(),
}).strict();

export const pressureTestExecutionStatusSchema = z.enum([
  "QUEUED", "RUNNING", "PASSED", "FAILED", "ERROR", "CANCELLED", "INTERRUPTED",
]);
export const pressureTestSampleStatusSchema = z.enum(["PASSED", "FAILED", "ERROR", "CANCELLED"]);
export const pressureTestThresholdMetricSchema = z.enum(["ERROR_RATE", "P95_DURATION", "REQUESTS_PER_SECOND"]);

export const pressureTestExecutionSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  errorRate: z.number().min(0).max(1),
  averageRequestsPerSecond: z.number().nonnegative(),
  peakRequestsPerSecond: z.number().nonnegative(),
  duration: z.object({
    minMs: z.number().nonnegative(),
    maxMs: z.number().nonnegative(),
    averageMs: z.number().nonnegative(),
    p50Ms: z.number().nonnegative(),
    p90Ms: z.number().nonnegative(),
    p95Ms: z.number().nonnegative(),
    p99Ms: z.number().nonnegative(),
  }).strict(),
  thresholds: z.array(z.object({
    metric: pressureTestThresholdMetricSchema,
    target: z.number().nonnegative(),
    actual: z.number().nonnegative(),
    passed: z.boolean(),
  }).strict()).length(3),
}).strict();

export const pressureTestTargetSnapshotSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(120),
  kind: testCaseKindSchema,
  revision: z.number().int().positive(),
}).strict();

export const pressureTestExecutionSchema = z.object({
  id: uuid,
  projectId: uuid,
  pressureTestId: uuid,
  pressureTestRevision: z.number().int().positive(),
  definitionSnapshot: pressureTestDefinitionSchema,
  targetSnapshot: pressureTestTargetSnapshotSchema,
  status: pressureTestExecutionStatusSchema,
  summary: pressureTestExecutionSummarySchema.nullable(),
  error: safeErrorSchema.nullable(),
  createdAt: timestamp,
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
}).strict();

export const pressureTestExecutionPageSchema = z.object({
  items: z.array(pressureTestExecutionSchema).max(100),
  nextCursor: z.string().min(1).nullable(),
}).strict();

export const pressureTestSampleSchema = z.object({
  id: uuid,
  projectId: uuid,
  pressureTestExecutionId: uuid,
  testExecutionId: uuid,
  virtualUser: z.number().int().positive().max(20),
  iteration: z.number().int().positive().max(1_000),
  status: pressureTestSampleStatusSchema,
  startedAt: timestamp,
  completedAt: timestamp,
  durationMs: z.number().int().nonnegative(),
  error: safeErrorSchema.nullable(),
}).strict();

export const pressureTestSamplePageSchema = z.object({
  items: z.array(pressureTestSampleSchema).max(100),
  nextCursor: z.string().min(1).nullable(),
}).strict();

export const startPressureTestExecutionRequestSchema = z.object({
  confirmDestructive: z.boolean().optional(),
}).strict();

export type PressureTestLoad = z.output<typeof pressureTestLoadSchema>;
export type PressureTestThresholds = z.output<typeof pressureTestThresholdsSchema>;
export type PressureTestDefinition = z.output<typeof pressureTestDefinitionSchema>;
export type PressureTestMutation = z.output<typeof pressureTestMutationSchema>;
export type UpdatePressureTestRequest = z.output<typeof updatePressureTestRequestSchema>;
export type PressureTestPage = z.output<typeof pressureTestPageSchema>;
export type PressureTestExecutionStatus = z.output<typeof pressureTestExecutionStatusSchema>;
export type PressureTestSampleStatus = z.output<typeof pressureTestSampleStatusSchema>;
export type PressureTestExecutionSummary = z.output<typeof pressureTestExecutionSummarySchema>;
export type PressureTestTargetSnapshot = z.output<typeof pressureTestTargetSnapshotSchema>;
export type PressureTestExecution = z.output<typeof pressureTestExecutionSchema>;
export type PressureTestExecutionPage = z.output<typeof pressureTestExecutionPageSchema>;
export type PressureTestSample = z.output<typeof pressureTestSampleSchema>;
export type PressureTestSamplePage = z.output<typeof pressureTestSamplePageSchema>;
export type StartPressureTestExecutionRequest = z.output<typeof startPressureTestExecutionRequestSchema>;

export function parsePressureTestDefinition(value: unknown): PressureTestDefinition {
  return pressureTestDefinitionSchema.parse(value);
}

export function parsePressureTestExecution(value: unknown): PressureTestExecution {
  return pressureTestExecutionSchema.parse(value);
}
