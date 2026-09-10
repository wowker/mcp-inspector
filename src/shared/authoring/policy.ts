import { z } from "zod";

export const authoringAccessModeSchema = z.enum([
  "DISABLED",
  "READ_ONLY",
  "CUSTOM",
  "FULL_ACCESS",
]);

export type AuthoringAccessMode = z.infer<typeof authoringAccessModeSchema>;

export const authoringToolNameSchema = z.string().trim().min(1).max(256);

export const replaceAuthoringPolicyInputSchema = z.object({
  expectedRevision: z.number().int().min(0),
  mode: authoringAccessModeSchema,
  allowedTools: z.array(authoringToolNameSchema).max(1000),
  deniedTools: z.array(authoringToolNameSchema).max(1000),
  requireCleanupForDraftMutations: z.boolean(),
  maxCallsPerMinute: z.number().int().min(1).max(600),
  maxConcurrentCalls: z.number().int().min(1).max(2),
  maxCallDurationMs: z.number().int().min(100).max(600000),
}).strict();

export type ReplaceAuthoringPolicyInput = z.infer<typeof replaceAuthoringPolicyInputSchema>;

export const connectionAuthoringPolicySchema = replaceAuthoringPolicyInputSchema.omit({
  expectedRevision: true,
}).extend({
  projectId: z.string().uuid(),
  connectionId: z.string().uuid(),
  revision: z.number().int().min(0),
  createdAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
});

export type ConnectionAuthoringPolicy = z.infer<typeof connectionAuthoringPolicySchema>;

export function defaultConnectionAuthoringPolicy(
  projectId: string,
  connectionId: string,
): ConnectionAuthoringPolicy {
  return connectionAuthoringPolicySchema.parse({
    projectId,
    connectionId,
    mode: "DISABLED",
    allowedTools: [],
    deniedTools: [],
    requireCleanupForDraftMutations: true,
    maxCallsPerMinute: 60,
    maxConcurrentCalls: 1,
    maxCallDurationMs: 30000,
    revision: 0,
    createdAt: null,
    updatedAt: null,
  });
}
