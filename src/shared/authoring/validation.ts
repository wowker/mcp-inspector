import { z } from "zod";

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const validateDraftInputSchema = z.object({
  projectId: uuid,
  draftId: uuid,
  revision: z.number().int().positive(),
}).strict();

export const authoringValidationIssueSchema = z.object({
  code: z.string().trim().min(1).max(128),
  path: z.string().max(2_048),
  message: z.string().min(1).max(2_000),
  resolution: z.string().max(2_000).optional(),
  severity: z.enum(["ERROR", "WARNING"]).optional(),
}).strict();

export const draftValidationResultSchema = z.object({
  id: uuid,
  projectId: uuid,
  draftId: uuid,
  draftRevision: z.number().int().positive(),
  definitionDigest: sha256,
  toolSchemaHashes: z.record(z.string(), sha256),
  validationDigest: sha256,
  status: z.enum(["VALID", "INVALID"]),
  issues: z.array(authoringValidationIssueSchema).max(10_000),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export const listTestAssetsInputSchema = z.object({
  projectId: uuid,
  kind: z.enum(["TEST_CASE", "TEST_SUITE"]).optional(),
  cursor: z.string().min(1).max(4_096).regex(/^[A-Za-z0-9_-]+$/u).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict();

export const getTestAssetInputSchema = z.object({
  projectId: uuid,
  kind: z.enum(["TEST_CASE", "TEST_SUITE"]),
  assetId: uuid,
  revision: z.number().int().positive(),
}).strict();

export interface AuthoringValidationIssue extends z.output<typeof authoringValidationIssueSchema> {}
export interface DraftValidationResult extends z.output<typeof draftValidationResultSchema> {}
export type ValidateDraftInput = z.output<typeof validateDraftInputSchema>;
export type ListTestAssetsInput = z.output<typeof listTestAssetsInputSchema>;

export interface AuthoringTestAssetSummary {
  id: string;
  projectId: string;
  kind: "TEST_CASE" | "TEST_SUITE";
  name: string;
  description: string;
  revision: number;
  updatedAt: string;
}

export interface AuthoringTestAssetPage {
  items: AuthoringTestAssetSummary[];
  nextCursor: string | null;
}
