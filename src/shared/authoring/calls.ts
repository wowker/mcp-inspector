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

export type AuthoringCallContext = z.output<typeof authoringCallContextSchema>;
export type AuthoringCallPurpose = z.output<typeof authoringCallPurposeSchema>;
export type AuthoringCallStatus = z.output<typeof authoringCallStatusSchema>;
export type AuthoringCallToolInput = z.output<typeof authoringCallToolInputSchema>;

export interface AuthoringToolCallDetail {
  id: string;
  projectId: string;
  connectionId: string;
  toolName: string;
  toolSnapshotId: string | null;
  toolSchemaHash: string;
  context: AuthoringCallContext;
  purpose: AuthoringCallPurpose;
  status: AuthoringCallStatus;
  runId: string | null;
  idempotencyKey: string;
  arguments: JsonObject;
  mayHaveSideEffects: boolean;
  response: JsonValue | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

export function isJsonValue(value: unknown): value is JsonValue {
  return jsonValueSchema.safeParse(value).success;
}
