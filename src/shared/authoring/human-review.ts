import { z } from "zod";
import { reviewStateSchema } from "./validation-session.js";

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().datetime({ offset: true });
const localId = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);

export const humanReviewDecisionKindSchema = z.enum([
  "CONFIRM_EXPECTATION", "CORRECT_EXPECTATION", "IMPLEMENTATION_DEFECT",
  "ENVIRONMENT_ISSUE", "MORE_EVIDENCE_REQUIRED", "REJECT_TEST",
]);

export const humanReviewDecisionSchema = z.object({
  id: uuid,
  expectationLocalId: localId.nullable(),
  decision: humanReviewDecisionKindSchema,
  explanation: z.string().max(4_000),
  reviewRevision: z.number().int().min(2),
  batchId: uuid.nullable(),
  decidedAt: timestamp,
}).strict();

export const humanReviewSchema = z.object({
  projectId: uuid,
  sessionId: uuid,
  evidenceDigest: sha256,
  state: reviewStateSchema.exclude(["NOT_READY"]),
  revision: z.number().int().positive(),
  decisions: z.array(humanReviewDecisionSchema).max(10_000),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const validatedAssetLinkSchema = z.object({
  id: uuid,
  projectId: uuid,
  assetKind: z.enum(["TEST_CASE", "TEST_SUITE"]),
  assetId: uuid,
  assetRevision: z.number().int().positive(),
  draftLocalId: localId.nullable(),
  sessionId: uuid,
  evidenceVersion: z.number().int().positive(),
  reviewRevision: z.number().int().min(2),
  verifiedAt: timestamp,
}).strict();

export type HumanReviewDecisionKind = z.output<typeof humanReviewDecisionKindSchema>;
export type HumanReviewDecision = z.output<typeof humanReviewDecisionSchema>;
export type HumanReview = z.output<typeof humanReviewSchema>;
export type ValidatedAssetLink = z.output<typeof validatedAssetLinkSchema>;
