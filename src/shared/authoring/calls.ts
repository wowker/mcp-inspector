import { z } from "zod";
import { jsonObjectSchema, jsonValueSchema, type JsonObject, type JsonValue } from "../tool-definition.js";

export const authoringCallContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("STANDALONE"), label: z.string().trim().min(1).max(200).optional() }).strict(),
  z.object({ kind: z.literal("DRAFT"), draftId: z.string().uuid(), draftRevision: z.number().int().min(1) }).strict(),
]);

export const authoringCallPurposeSchema = z.enum([
  "DIAGNOSTIC", "DISCOVERY", "SETUP", "ACTION", "POLL", "CLEANUP",
]);

export const authoringCallStatusSchema = z.enum([
  "PENDING", "RUNNING", "SUCCEEDED", "FAILED", "UNKNOWN", "BLOCKED", "CANCELLED",
]);

export const authoringCallToolInputSchema = z.object({
  projectId: z.string().uuid(),
  connectionId: z.string().uuid(),
  toolName: z.string().trim().min(1).max(256),
  toolSchemaHash: z.string().regex(/^[a-f0-9]{64}$/u),
  arguments: jsonObjectSchema,
  context: authoringCallContextSchema,
  purpose: authoringCallPurposeSchema,
  idempotencyKey: z.string().min(1).max(200),
  cleanupForCallId: z.string().uuid().optional(),
}).strict();

export const authoringListToolCallsInputSchema = z.object({
  projectId: z.string().uuid(),
  cursor: z.string().min(1).max(4_096).regex(/^[A-Za-z0-9_-]+$/u).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  connectionId: z.string().uuid().optional(),
  toolName: z.string().trim().min(1).max(256).optional(),
  status: authoringCallStatusSchema.optional(),
  contextKind: z.enum(["STANDALONE", "DRAFT"]).optional(),
}).strict();

export const authoringGetToolCallInputSchema = z.object({
  projectId: z.string().uuid(),
  callId: z.string().uuid(),
}).strict();

export type AuthoringCallContext = z.output<typeof authoringCallContextSchema>;
export type AuthoringCallPurpose = z.output<typeof authoringCallPurposeSchema>;
export type AuthoringCallStatus = z.output<typeof authoringCallStatusSchema>;
export type AuthoringCallToolInput = z.output<typeof authoringCallToolInputSchema>;
export type AuthoringListToolCallsInput = z.output<typeof authoringListToolCallsInputSchema>;

const callTimestamp = z.string().datetime({ offset: true });
export const authoringToolCallSummarySchema = z.object({
  callId: z.string().uuid(), projectId: z.string().uuid(), connectionId: z.string().uuid(),
  toolName: z.string().trim().min(1).max(256), context: authoringCallContextSchema,
  purpose: authoringCallPurposeSchema, status: authoringCallStatusSchema, runId: z.string().uuid().nullable(),
  mayHaveSideEffects: z.boolean(), createdAt: callTimestamp, startedAt: callTimestamp.nullable(),
  completedAt: callTimestamp.nullable(), durationMs: z.number().int().nonnegative().nullable(),
}).strict();
export const authoringToolCallPageSchema = z.object({
  items: z.array(authoringToolCallSummarySchema), nextCursor: z.string().min(1).nullable(),
}).strict();
export const authoringToolCallDetailSchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid(), connectionId: z.string().uuid(),
  toolName: z.string().trim().min(1).max(256), toolSnapshotId: z.string().uuid().nullable(),
  toolSchemaHash: z.string().regex(/^[a-f0-9]{64}$/u), context: authoringCallContextSchema,
  purpose: authoringCallPurposeSchema, status: authoringCallStatusSchema, runId: z.string().uuid().nullable(),
  idempotencyKey: z.string().min(1).max(200), arguments: jsonObjectSchema, mayHaveSideEffects: z.boolean(),
  response: jsonValueSchema.nullable(), error: z.object({ code: z.string(), message: z.string() }).strict().nullable(),
  createdAt: callTimestamp, startedAt: callTimestamp.nullable(), completedAt: callTimestamp.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
}).strict();

export type AuthoringToolCallSummary = z.output<typeof authoringToolCallSummarySchema>;
export type AuthoringToolCallPage = z.output<typeof authoringToolCallPageSchema>;
export type AuthoringToolCallDetail = z.output<typeof authoringToolCallDetailSchema>;

export function isJsonValue(value: unknown): value is JsonValue {
  return jsonValueSchema.safeParse(value).success;
}
