import { z } from "zod";

export const authoringSettingsStatusSchema = z.object({
  enabled: z.boolean(),
  configured: z.boolean(),
  tokenHint: z.string().max(64).nullable(),
  tokenCreatedAt: z.iso.datetime().nullable(),
  tokenRotatedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime().nullable(),
}).strict();

export const authoringSettingsResponseSchema = z.object({
  settings: authoringSettingsStatusSchema,
  endpoint: z.string().min(1).max(2_048),
}).strict();

export const authoringTokenIssueResponseSchema = authoringSettingsResponseSchema.extend({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).nullable(),
}).strict();

export type AuthoringSettingsStatus = z.infer<typeof authoringSettingsStatusSchema>;
export type AuthoringTokenIssue = z.infer<typeof authoringTokenIssueResponseSchema>;
