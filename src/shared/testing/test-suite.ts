import { z } from "zod";

const uuid = z.uuid();
const timestamp = z.string().datetime({ offset: true });

const memberSchema = z.object({
  id: uuid,
  testCaseId: uuid,
  position: z.number().int().nonnegative(),
  isEnabled: z.boolean(),
}).strict();

const suiteShape = {
  id: uuid,
  projectId: uuid,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000),
  tags: z.array(z.string().trim().min(1).max(80)).max(20),
  revision: z.number().int().positive(),
  members: z.array(memberSchema).max(1_000),
  executionPolicy: z.object({
    concurrency: z.number().int().min(1).max(8).default(1),
    stopOnFailure: z.boolean(),
  }).strict(),
  createdAt: timestamp,
  updatedAt: timestamp,
};

function validateSuite(suite: { members: Array<z.output<typeof memberSchema>>; tags: string[] }, context: z.RefinementCtx) {
  if (new Set(suite.tags.map((tag) => tag.toLocaleLowerCase())).size !== suite.tags.length) {
    context.addIssue({ code: "custom", path: ["tags"], message: "Suite tags must be unique" });
  }
  if (new Set(suite.members.map(({ id }) => id)).size !== suite.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "Suite member IDs must be unique" });
  }
  if (new Set(suite.members.map(({ position }) => position)).size !== suite.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "Suite member positions must be unique" });
  }
  if (new Set(suite.members.map(({ testCaseId }) => testCaseId)).size !== suite.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "Suite test cases must be unique" });
  }
}

export const testSuiteDefinitionSchema = z.object({
  ...suiteShape,
}).strict().superRefine(validateSuite);

const generatedFields = { id: true, projectId: true, revision: true, createdAt: true, updatedAt: true } as const;
export const testSuiteMutationSchema = z.object(suiteShape).omit(generatedFields).superRefine(validateSuite);
export const createTestSuiteRequestSchema = testSuiteMutationSchema;
export const updateTestSuiteRequestSchema = z.object({
  revision: z.number().int().positive(),
  definition: testSuiteMutationSchema,
}).strict();

export const testSuiteSummarySchema = z.object({
  id: uuid,
  projectId: uuid,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000),
  tags: z.array(z.string().trim().min(1).max(80)).max(20),
  revision: z.number().int().positive(),
  memberCount: z.number().int().nonnegative().max(1_000),
  executionPolicy: suiteShape.executionPolicy,
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const testSuitePageSchema = z.object({
  items: z.array(testSuiteSummarySchema),
  nextCursor: z.string().min(1).nullable(),
}).strict();

export type TestSuiteDefinition = z.output<typeof testSuiteDefinitionSchema>;
export type TestSuiteMutation = z.output<typeof testSuiteMutationSchema>;
export type UpdateTestSuiteRequest = z.output<typeof updateTestSuiteRequestSchema>;
export type TestSuiteSummary = z.output<typeof testSuiteSummarySchema>;
export type TestSuitePage = z.output<typeof testSuitePageSchema>;

export function parseTestSuiteDefinition(value: unknown): TestSuiteDefinition {
  return testSuiteDefinitionSchema.parse(value);
}
