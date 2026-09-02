import { z } from "zod";
import { jsonValueSchema } from "../tool-definition.js";

export const assertionSourceSchema = z.enum([
  "RUN", "MCP_RESULT", "MCP_ERROR", "HTTP", "WORKFLOW", "VARIABLE",
]);

export const assertionOperatorSchema = z.enum([
  "EXISTS", "NOT_EXISTS", "IS_NULL", "NOT_NULL",
  "EQUALS", "NOT_EQUALS", "DEEP_EQUALS", "SUBSET",
  "CONTAINS", "STARTS_WITH", "ENDS_WITH", "MATCHES_REGEX",
  "GT", "GTE", "LT", "LTE", "BETWEEN",
  "LENGTH_EQUALS", "LENGTH_GTE", "ARRAY_CONTAINS",
  "TYPE_IS", "MATCHES_SCHEMA",
  "STATUS_IS", "IS_ERROR_IS", "DURATION_LTE", "NETWORK_DURATION_LTE",
]);

export const assertionDefinitionSchema = z.object({
  id: z.string().trim().min(1).max(128),
  source: assertionSourceSchema,
  path: z.string().max(1_024),
  operator: assertionOperatorSchema,
  expected: jsonValueSchema.optional(),
  options: z.object({
    isNegated: z.boolean().optional(),
    arrayOrder: z.enum(["ORDERED", "UNORDERED"]).optional(),
    objectMatch: z.enum(["SUBSET", "EXACT"]).optional(),
    caseSensitive: z.boolean().optional(),
  }).strict().optional(),
  message: z.string().max(2_000).optional(),
}).strict();

export type AssertionDefinition = z.output<typeof assertionDefinitionSchema>;

export const assertionResultStatusSchema = z.enum(["PASSED", "FAILED", "ERROR"]);

export const assertionResultSchema = z.object({
  id: z.uuid(),
  assertionId: z.string().trim().min(1).max(128),
  status: assertionResultStatusSchema,
  definition: assertionDefinitionSchema,
  resolvedPath: z.string().max(1_024).nullable(),
  actual: jsonValueSchema.optional(),
  expected: jsonValueSchema.optional(),
  errorCode: z.string().trim().min(1).max(128).nullable(),
  message: z.string().max(2_000).nullable(),
  durationMs: z.number().int().nonnegative(),
  isRedacted: z.boolean(),
}).strict();

export type AssertionResult = z.output<typeof assertionResultSchema>;
