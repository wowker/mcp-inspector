import { z } from "zod";

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const applyAuthoringDraftInputSchema = z.object({
  projectId: uuid,
  draftId: uuid,
  expectedRevision: z.number().int().positive(),
  validationDigest: sha256,
  idempotencyKey: z.string().min(1).max(200),
}).strict();

export const authoringAppliedAssetSchema = z.object({
  draftLocalId: z.string().trim().min(1).max(128),
  kind: z.enum(["TEST_CASE", "TEST_SUITE"]),
  formalAssetId: uuid,
  revision: z.number().int().positive(),
}).strict();

export const authoringApplyResultSchema = z.object({
  applyId: uuid,
  projectId: uuid,
  draftId: uuid,
  draftRevision: z.number().int().positive(),
  validationDigest: sha256,
  assets: z.array(authoringAppliedAssetSchema),
  appliedAt: z.string().datetime({ offset: true }),
}).strict();

export type ApplyAuthoringDraftInput = z.output<typeof applyAuthoringDraftInputSchema>;
export type AuthoringAppliedAsset = z.output<typeof authoringAppliedAssetSchema>;
export type AuthoringApplyResult = z.output<typeof authoringApplyResultSchema>;
