import { z } from "zod";
import { jsonObjectSchema, jsonValueSchema } from "./tool-definition.js";

export const SCRIPT_SOURCE_MAX_BYTES = 2_097_152;
export const SCRIPT_TIMEOUT_MIN_MS = 100;
export const SCRIPT_TIMEOUT_MAX_MS = 60_000;

const uuid = z.uuid();
const timestamp = z.string().datetime({ offset: true });
const toolName = z.string().max(512).refine((value) => value.trim().length > 0);
const scriptSource = z.string().max(SCRIPT_SOURCE_MAX_BYTES);

const scriptDefinitionSchema = z.object({
  enabled: z.boolean(),
  source: scriptSource,
}).strict();

export const toolWorkflowUpdateSchema = z.object({
  revision: z.number().int().positive(),
  before: scriptDefinitionSchema,
  after: scriptDefinitionSchema,
  timeoutMs: z.number().int().min(SCRIPT_TIMEOUT_MIN_MS).max(SCRIPT_TIMEOUT_MAX_MS),
}).strict().superRefine((workflow, context) => {
  for (const [phase, script] of [["before", workflow.before], ["after", workflow.after]] as const) {
    if (script.enabled && script.source.trim().length === 0) {
      context.addIssue({ code: "custom", path: [phase, "source"], message: "Enabled scripts require source" });
    }
  }
});

export type ToolWorkflowUpdate = z.output<typeof toolWorkflowUpdateSchema>;

export const toolWorkflowSchema = z.object({
  projectId: uuid,
  connectionId: uuid,
  toolName,
  revision: z.number().int().positive(),
  before: scriptDefinitionSchema,
  after: scriptDefinitionSchema,
  timeoutMs: z.number().int().min(SCRIPT_TIMEOUT_MIN_MS).max(SCRIPT_TIMEOUT_MAX_MS),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export type ToolWorkflow = z.output<typeof toolWorkflowSchema>;

export function parseToolWorkflow(value: unknown): ToolWorkflow {
  return toolWorkflowSchema.parse(value);
}

const publicEnvironmentVariableSchema = z.object({
  id: uuid,
  projectId: uuid,
  connectionId: uuid.nullable(),
  name: z.string().trim().min(1).max(128),
  secret: z.literal(false),
  value: jsonValueSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

const secretEnvironmentVariableSchema = z.object({
  id: uuid,
  projectId: uuid,
  connectionId: uuid.nullable(),
  name: z.string().trim().min(1).max(128),
  secret: z.literal(true),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const environmentVariableSchema = z.discriminatedUnion("secret", [
  publicEnvironmentVariableSchema,
  secretEnvironmentVariableSchema,
]);

export type EnvironmentVariable = z.output<typeof environmentVariableSchema>;

export function parseEnvironmentVariable(value: unknown): EnvironmentVariable {
  return environmentVariableSchema.parse(value);
}

export const workflowExecutionStatusSchema = z.enum([
  "queued",
  "before",
  "main",
  "after",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]);

export const workflowExecutionSummarySchema = z.object({
  id: uuid,
  projectId: uuid,
  connectionId: uuid,
  tabId: uuid.nullable(),
  toolName,
  status: workflowExecutionStatusSchema,
  createdAt: timestamp,
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
}).strict();

export type WorkflowExecutionSummary = z.output<typeof workflowExecutionSummarySchema>;

export function parseWorkflowExecutionSummary(value: unknown): WorkflowExecutionSummary {
  return workflowExecutionSummarySchema.parse(value);
}

const workflowExecutionRunSchema = z.object({
  runId: uuid,
  phase: z.enum(["helper-before", "main", "helper-after"]),
  ordinal: z.number().int().nonnegative(),
  sourceLine: z.number().int().positive().nullable(),
}).strict();

const workflowExecutionEventSchema = z.object({
  executionId: uuid,
  sequence: z.number().int().positive(),
  kind: z.string().trim().min(1).max(128),
  occurredAt: timestamp,
  payload: jsonValueSchema,
}).strict();

export const workflowExecutionDetailSchema = workflowExecutionSummarySchema.extend({
  toolSnapshotId: uuid,
  idempotencyKey: z.string().min(1).max(200),
  initialArguments: jsonObjectSchema,
  finalArguments: jsonObjectSchema.nullable(),
  workflowSnapshot: jsonObjectSchema,
  response: jsonValueSchema.nullable(),
  error: z.object({
    code: z.string().trim().min(1).max(128),
    message: z.string().min(1).max(2_000),
  }).strict().nullable(),
  runs: z.array(workflowExecutionRunSchema),
  events: z.array(workflowExecutionEventSchema),
}).strict();

export type WorkflowExecutionDetail = z.output<typeof workflowExecutionDetailSchema>;

export function parseWorkflowExecutionDetail(value: unknown): WorkflowExecutionDetail {
  return workflowExecutionDetailSchema.parse(value);
}

export const scriptErrorCodeSchema = z.enum([
  "SYNTAX_ERROR",
  "RUNTIME_ERROR",
  "TIMEOUT",
  "CANCELLED",
  "MEMORY_LIMIT",
  "STACK_LIMIT",
  "FORBIDDEN_CAPABILITY",
  "IPC_INVALID",
  "CALL_LIMIT",
  "OUTPUT_LIMIT",
  "ASSERTION_FAILED",
  "HOST_CALL_FAILED",
  "INTERNAL",
]);

export const scriptErrorSchema = z.object({
  code: scriptErrorCodeSchema,
  message: z.string().min(1).max(2_000),
  phase: z.enum(["before", "after"]),
  line: z.number().int().positive().nullable(),
  column: z.number().int().positive().nullable(),
  excerpt: z.string().max(4_096).nullable(),
}).strict();

export const workflowValidationResultSchema = z.object({
  valid: z.boolean(),
  error: scriptErrorSchema.nullable(),
}).strict().superRefine((result, context) => {
  if (result.valid && result.error !== null) {
    context.addIssue({ code: "custom", message: "Valid scripts cannot include an error" });
  }
  if (!result.valid && result.error === null) {
    context.addIssue({ code: "custom", message: "Invalid scripts require an error" });
  }
});

export type WorkflowValidationResult = z.output<typeof workflowValidationResultSchema>;

export const workflowDebugInputSchema = z.object({
  phase: z.enum(["before", "after"]),
  source: scriptSource,
  arguments: jsonObjectSchema,
  response: jsonValueSchema.nullable(),
  timeoutMs: z.number().int().min(SCRIPT_TIMEOUT_MIN_MS).max(SCRIPT_TIMEOUT_MAX_MS),
  allowDestructiveHelpers: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.source.trim().length === 0) context.addIssue({ code: "custom", path: ["source"], message: "Script source is required" });
  if (value.phase === "before" && value.response !== null) context.addIssue({ code: "custom", path: ["response"], message: "Before debug cannot include a response" });
});

export type WorkflowDebugInput = z.output<typeof workflowDebugInputSchema>;

const workflowDebugLogSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string().max(64 * 1024),
  data: jsonValueSchema.optional(),
  line: z.number().int().positive().nullable(),
  column: z.number().int().positive().nullable(),
}).strict();

export const workflowDebugResultSchema = z.object({
  phase: z.enum(["before", "after"]),
  arguments: jsonObjectSchema,
  variables: jsonObjectSchema,
  stagedEnvironment: z.array(z.object({
    scope: z.enum(["project", "server"]),
    name: z.string().trim().min(1).max(128),
    value: jsonValueSchema,
    secret: z.boolean(),
  }).strict()),
  logs: z.array(workflowDebugLogSchema).max(100),
}).strict();

export type WorkflowDebugResult = z.output<typeof workflowDebugResultSchema>;

const limitsSchema = z.object({
  timeoutMs: z.number().int().min(SCRIPT_TIMEOUT_MIN_MS).max(SCRIPT_TIMEOUT_MAX_MS),
  memoryBytes: z.number().int().min(1_048_576).max(268_435_456),
  stackBytes: z.number().int().min(65_536).max(8_388_608),
  maxLogs: z.number().int().min(0).max(1_000),
  maxLogBytes: z.number().int().min(1_024).max(1_048_576),
  maxToolCalls: z.number().int().min(0).max(100),
}).strict();

const startMessageSchema = z.object({
  version: z.literal(1),
  type: z.literal("start"),
  operation: z.enum(["execute", "validate"]),
  evaluationId: uuid,
  phase: z.enum(["before", "after"]),
  source: scriptSource,
  arguments: jsonObjectSchema,
  response: jsonValueSchema.nullable(),
  variables: jsonObjectSchema,
  environment: jsonObjectSchema,
  limits: limitsSchema,
}).strict();

const hostCallMessageSchema = z.object({
  version: z.literal(1),
  type: z.literal("host-call"),
  requestId: uuid,
  capability: z.literal("tools.call"),
  input: z.object({
    server: z.string().trim().min(1).max(512),
    name: toolName,
    arguments: jsonObjectSchema,
  }).strict(),
}).strict();

const hostResultMessageSchema = z.object({
  version: z.literal(1),
  type: z.literal("host-result"),
  requestId: uuid,
  ok: z.boolean(),
  value: jsonValueSchema.optional(),
  error: scriptErrorSchema.optional(),
}).strict().superRefine((message, context) => {
  if (message.ok && message.value === undefined) {
    context.addIssue({ code: "custom", message: "Successful host results require a value" });
  }
  if (!message.ok && message.error === undefined) {
    context.addIssue({ code: "custom", message: "Failed host results require an error" });
  }
  if (message.ok && message.error !== undefined) {
    context.addIssue({ code: "custom", message: "Successful host results cannot include an error" });
  }
});

const logMessageSchema = z.object({
  version: z.literal(1),
  type: z.literal("log"),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string().max(64 * 1024),
  data: jsonValueSchema.optional(),
  line: z.number().int().positive().nullable(),
  column: z.number().int().positive().nullable(),
}).strict();

const completedMessageSchema = z.object({
  version: z.literal(1),
  type: z.literal("completed"),
  arguments: jsonObjectSchema,
  variables: jsonObjectSchema,
  stagedEnvironment: z.array(z.object({
    scope: z.enum(["project", "server"]),
    name: z.string().trim().min(1).max(128),
    value: jsonValueSchema,
    secret: z.boolean(),
  }).strict()).max(1_000),
}).strict();

const failedMessageSchema = z.object({
  version: z.literal(1),
  type: z.literal("failed"),
  error: scriptErrorSchema,
}).strict();

const cancelMessageSchema = z.object({
  version: z.literal(1),
  type: z.literal("cancel"),
  evaluationId: uuid,
}).strict();

export const sandboxMessageSchema = z.union([
  startMessageSchema,
  hostCallMessageSchema,
  hostResultMessageSchema,
  logMessageSchema,
  completedMessageSchema,
  failedMessageSchema,
  cancelMessageSchema,
]);

export type SandboxMessage = z.output<typeof sandboxMessageSchema>;

export function parseSandboxMessage(value: unknown): SandboxMessage {
  return sandboxMessageSchema.parse(value);
}
