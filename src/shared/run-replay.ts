import { z } from "zod";
import { jsonObjectSchema } from "./tool-definition.js";

const uuid = z.uuid();
const timestamp = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const toolName = z.string().min(1).max(512).refine((value) => value.trim() === value);

export const runStatusSchema = z.enum([
  "queued", "connecting", "authorizing", "running", "succeeded", "failed", "cancelled", "interrupted",
]);

export const runErrorSchema = z.object({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(2_000),
}).strict();

export const runEventSchema = z.object({
  runId: uuid,
  sequence: z.number().int().positive(),
  kind: z.string().min(1).max(128),
  occurredAt: timestamp,
  payload: z.unknown(),
}).strict();

export const runSummarySchema = z.object({
  id: uuid,
  projectId: uuid,
  connectionId: uuid,
  tabId: uuid.nullable(),
  toolName,
  toolSnapshotId: uuid,
  idempotencyKey: z.string().min(1).max(200),
  status: runStatusSchema,
  createdAt: timestamp,
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  networkDurationMs: z.number().int().nonnegative().nullable(),
  pinned: z.boolean(),
  replayedFromRunId: uuid.nullable(),
}).strict().superRefine((value, context) => {
  if (value.replayedFromRunId === value.id) {
    context.addIssue({ code: "custom", path: ["replayedFromRunId"], message: "A Run cannot replay itself" });
  }
});

export const runDetailSchema = runSummarySchema.safeExtend({
  redactSensitiveInfo: z.boolean().optional(),
  toolSnapshotHash: sha256,
  protocolVersion: z.string().nullable(),
  serverInfo: jsonObjectSchema.nullable(),
  clientInfo: jsonObjectSchema,
  request: z.object({
    arguments: jsonObjectSchema,
    jsonrpc: z.unknown(),
    http: z.unknown().nullable(),
  }).strict(),
  response: z.object({
    result: z.unknown().nullable(),
    error: runErrorSchema.nullable(),
    truncated: z.boolean(),
    originalBytes: z.number().int().nonnegative().nullable(),
  }).strict().nullable(),
  events: z.array(runEventSchema),
}).strict();

export const runOriginSchema = z.enum(["ORIGINAL", "REPLAY"]);

export const runHistoryFilterSchema = z.object({
  tabId: uuid.optional(),
  connectionId: uuid.optional(),
  toolName: toolName.optional(),
  status: runStatusSchema.optional(),
  origin: runOriginSchema.optional(),
  pinned: z.boolean().optional(),
  createdFrom: timestamp.optional(),
  createdTo: timestamp.optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict().superRefine((value, context) => {
  if (value.createdFrom !== undefined && value.createdTo !== undefined && value.createdFrom > value.createdTo) {
    context.addIssue({ code: "custom", path: ["createdTo"], message: "Run history range is invalid" });
  }
});

export const runPinRequestSchema = z.object({ pinned: z.boolean() }).strict();

export const replaySchemaChangeSchema = z.object({
  path: z.string().min(1).max(2_048),
  kind: z.enum(["ADDED", "REMOVED", "CHANGED"]),
}).strict();

export const replayBlockerSchema = z.object({
  code: z.enum([
    "SOURCE_RUN_UNAVAILABLE",
    "SOURCE_ARGUMENTS_UNAVAILABLE",
    "CONNECTION_UNAVAILABLE",
    "TOOL_UNAVAILABLE",
    "SOURCE_RESPONSE_TRUNCATED",
  ]),
  message: z.string().min(1).max(2_000),
}).strict();

export const replayConfirmationSchema = z.enum(["SCHEMA_DRIFT", "SIDE_EFFECT_RISK"]);

export const replayPreflightSchema = z.object({
  projectId: uuid,
  sourceRunId: uuid,
  connectionId: uuid,
  toolName,
  arguments: jsonObjectSchema,
  sourceToolSnapshotId: uuid,
  sourceToolSnapshotHash: sha256,
  currentToolSnapshotId: uuid,
  currentToolSnapshotHash: sha256,
  annotations: jsonObjectSchema,
  schemaChanges: z.array(replaySchemaChangeSchema).max(2_000),
  sideEffectRisk: z.enum(["SAFE", "UNKNOWN", "DESTRUCTIVE"]),
  blockers: z.array(replayBlockerSchema).max(32),
  requiredConfirmations: z.array(replayConfirmationSchema).max(2),
  digest: sha256,
}).strict();

export const replayRequestSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  preflightDigest: sha256,
  confirmSchemaDrift: z.boolean(),
  confirmSideEffects: z.boolean(),
}).strict();

export const replayErrorCodeSchema = z.enum([
  "RUN_NOT_FOUND",
  "REPLAY_BLOCKED",
  "REPLAY_STALE_PREFLIGHT",
  "REPLAY_CONFIRMATION_REQUIRED",
  "REPLAY_IDEMPOTENCY_CONFLICT",
  "INVALID_REPLAY",
]);

export const replayErrorSchema = z.object({
  error: z.object({
    code: replayErrorCodeSchema,
    message: z.string().min(1).max(2_000),
  }).strict(),
}).strict();

export type RunStatus = z.output<typeof runStatusSchema>;
export type RunError = z.output<typeof runErrorSchema>;
export type RunEvent = z.output<typeof runEventSchema>;
export type RunSummary = z.output<typeof runSummarySchema>;
export type RunDetail = z.output<typeof runDetailSchema>;
export type RunHistoryFilter = z.output<typeof runHistoryFilterSchema>;
export type RunPinRequest = z.output<typeof runPinRequestSchema>;
export type ReplayPreflight = z.output<typeof replayPreflightSchema>;
export type ReplayRequest = z.output<typeof replayRequestSchema>;
export type ReplayErrorCode = z.output<typeof replayErrorCodeSchema>;
