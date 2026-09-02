import { z } from "zod";
import { testCaseDefinitionSchema } from "./test-case.js";
import { testSuiteDefinitionSchema } from "./test-suite.js";

const uuid = z.uuid();

export const testTransferConnectionSchema = z.object({
  alias: z.string().trim().min(1).max(128),
  sourceConnectionId: uuid,
  name: z.string().trim().min(1).max(120),
}).strict();

export const automatedTestsExportEnvelopeSchema = z.object({
  format: z.literal("mcp-inspector-automated-tests"),
  version: z.literal(1),
  exportedAt: z.string().datetime({ offset: true }),
  sourceProject: z.object({ id: uuid, name: z.string().trim().min(1).max(120) }).strict(),
  connections: z.array(testTransferConnectionSchema).max(1_000),
  data: z.object({
    testCases: z.array(testCaseDefinitionSchema).max(10_000),
    testSuites: z.array(testSuiteDefinitionSchema).max(10_000),
  }).strict(),
}).strict().superRefine((value, context) => {
  const unique = (values: string[], path: (string | number)[]) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: "custom", path, message: "Export identities must be unique" });
  };
  unique(value.connections.map(({ alias }) => alias), ["connections"]);
  unique(value.connections.map(({ sourceConnectionId }) => sourceConnectionId), ["connections"]);
  unique(value.data.testCases.map(({ id }) => id), ["data", "testCases"]);
  unique(value.data.testSuites.map(({ id }) => id), ["data", "testSuites"]);
});

export const importConflictPolicySchema = z.enum(["SKIP", "COPY", "OVERWRITE"]);

export const importAutomatedTestsRequestSchema = z.object({
  envelope: automatedTestsExportEnvelopeSchema,
  bindings: z.record(z.string().trim().min(1).max(128), uuid),
  conflictPolicy: importConflictPolicySchema,
  confirm: z.literal(true),
}).strict();

export const importAutomatedTestsResultSchema = z.object({
  importedTestCases: z.number().int().nonnegative(),
  importedTestSuites: z.number().int().nonnegative(),
  skippedTestCases: z.number().int().nonnegative(),
  skippedTestSuites: z.number().int().nonnegative(),
  testCaseIds: z.record(uuid, uuid),
  testSuiteIds: z.record(uuid, uuid),
}).strict();

export type AutomatedTestsExportEnvelope = z.output<typeof automatedTestsExportEnvelopeSchema>;
export type ImportAutomatedTestsRequest = z.output<typeof importAutomatedTestsRequestSchema>;
export type ImportAutomatedTestsResult = z.output<typeof importAutomatedTestsResultSchema>;
