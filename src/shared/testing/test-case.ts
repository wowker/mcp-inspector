import { z } from "zod";
import { jsonObjectSchema, jsonValueSchema } from "../tool-definition.js";
import { assertionDefinitionSchema } from "./assertions.js";

export const TEST_CASE_NAME_MAX_LENGTH = 120;
export const TEST_CASE_DESCRIPTION_MAX_LENGTH = 2_000;
export const TEST_CASE_TAGS_MAX_COUNT = 20;
export const TEST_CASE_DEFINITION_MAX_BYTES = 2_097_152;
export const SCENARIO_STEPS_MAX_COUNT = 100;
export const SCENARIO_CLEANUP_STEPS_MAX_COUNT = 20;
export const STEP_COLLECTION_MAX_COUNT = 100;

const uuid = z.uuid();
const timestamp = z.string().datetime({ offset: true });
const nameSchema = z.string().trim().min(1).max(TEST_CASE_NAME_MAX_LENGTH);
const descriptionSchema = z.string().max(TEST_CASE_DESCRIPTION_MAX_LENGTH);
const tagsSchema = z.array(z.string().trim().min(1).max(80))
  .max(TEST_CASE_TAGS_MAX_COUNT)
  .refine((tags) => new Set(tags.map((tag) => tag.toLocaleLowerCase())).size === tags.length, {
    message: "Tags must be unique",
  });

export const toolTargetSchema = z.object({
  connectionId: uuid,
  toolName: z.string().trim().min(1).max(512),
}).strict();

export const valueSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LITERAL"), value: jsonValueSchema }).strict(),
  z.object({ kind: z.literal("SCENARIO_INPUT"), name: z.string().trim().min(1).max(128) }).strict(),
  z.object({
    kind: z.literal("ENVIRONMENT"),
    scope: z.enum(["PROJECT", "SERVER"]),
    name: z.string().trim().min(1).max(128),
  }).strict(),
  z.object({ kind: z.literal("VARIABLE"), name: z.string().trim().min(1).max(128) }).strict(),
  z.object({
    kind: z.literal("STEP_RESPONSE"),
    stepId: z.string().trim().min(1).max(128),
    path: z.string().max(1_024),
  }).strict(),
]);

export const argumentMappingSchema = z.object({
  targetPath: z.string().min(1).max(1_024),
  source: valueSourceSchema,
  isRequired: z.boolean(),
}).strict();

export const responseExtractorSchema = z.object({
  name: z.string().trim().min(1).max(128),
  source: z.enum(["RESULT", "ERROR", "HTTP"]),
  path: z.string().max(1_024),
  isRequired: z.boolean(),
}).strict();

export const scenarioInputDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().max(2_000),
  isRequired: z.boolean(),
  defaultValue: jsonValueSchema.optional(),
}).strict();

export const scenarioConditionSchema = assertionDefinitionSchema;

export const pollingPolicySchema = z.object({
  intervalMs: z.number().int().min(250).max(60_000),
  maxAttempts: z.number().int().min(1).max(100),
  timeoutMs: z.number().int().positive().max(3_600_000),
  until: z.array(assertionDefinitionSchema).max(STEP_COLLECTION_MAX_COUNT),
  failWhen: z.array(assertionDefinitionSchema).max(STEP_COLLECTION_MAX_COUNT),
}).strict();

export const scenarioStepDefinitionSchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: nameSchema,
  target: toolTargetSchema,
  fixedArguments: jsonObjectSchema,
  mappings: z.array(argumentMappingSchema).max(STEP_COLLECTION_MAX_COUNT),
  extractors: z.array(responseExtractorSchema).max(STEP_COLLECTION_MAX_COUNT),
  assertions: z.array(assertionDefinitionSchema).max(STEP_COLLECTION_MAX_COUNT),
  condition: scenarioConditionSchema.nullable(),
  polling: pollingPolicySchema.nullable(),
  onFailure: z.enum(["STOP", "CONTINUE", "SKIP_REMAINING"]),
}).strict();

const testCaseBaseShape = {
  id: uuid,
  projectId: uuid,
  name: nameSchema,
  description: descriptionSchema,
  tags: tagsSchema,
  revision: z.number().int().positive(),
  isEnabled: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
};

export const toolTestCaseDefinitionSchema = z.object({
  ...testCaseBaseShape,
  kind: z.literal("tool"),
  target: toolTargetSchema,
  arguments: jsonObjectSchema,
  assertions: z.array(assertionDefinitionSchema).max(STEP_COLLECTION_MAX_COUNT),
  timeoutMs: z.number().int().positive().max(3_600_000),
}).strict();

const scenarioTestCaseDefinitionBaseSchema = z.object({
  ...testCaseBaseShape,
  kind: z.literal("scenario"),
  inputs: z.array(scenarioInputDefinitionSchema).max(STEP_COLLECTION_MAX_COUNT),
  steps: z.array(scenarioStepDefinitionSchema).min(1).max(SCENARIO_STEPS_MAX_COUNT),
  cleanupSteps: z.array(scenarioStepDefinitionSchema).max(SCENARIO_CLEANUP_STEPS_MAX_COUNT),
  assertions: z.array(assertionDefinitionSchema).max(STEP_COLLECTION_MAX_COUNT),
  failurePolicy: z.enum(["STOP", "CONTINUE"]),
}).strict();

function validateScenarioDefinition(
  definition: Pick<z.output<typeof scenarioTestCaseDefinitionBaseSchema>, "steps" | "cleanupSteps" | "inputs">,
  context: z.RefinementCtx,
) {
  const stepIds = [...definition.steps, ...definition.cleanupSteps].map(({ id }) => id);
  if (new Set(stepIds).size !== stepIds.length) {
    context.addIssue({ code: "custom", path: ["steps"], message: "Scenario step IDs must be unique" });
  }
  const inputNames = definition.inputs.map(({ name }) => name.toLocaleLowerCase());
  if (new Set(inputNames).size !== inputNames.length) {
    context.addIssue({ code: "custom", path: ["inputs"], message: "Scenario input names must be unique" });
  }
  const inputSet = new Set(definition.inputs.map(({ name }) => name));
  const priorStepIds = new Set<string>();
  const priorVariables = new Set<string>();
  const extractorOwners = new Map<string, string>();
  const ordered = [...definition.steps.map((step, index) => ({ step, section: "steps" as const, index })),
    ...definition.cleanupSteps.map((step, index) => ({ step, section: "cleanupSteps" as const, index }))];
  for (const { step, section, index } of ordered) {
    step.mappings.forEach((mapping, mappingIndex) => {
      const source = mapping.source;
      const path = [section, index, "mappings", mappingIndex, "source"];
      if (source.kind === "SCENARIO_INPUT" && !inputSet.has(source.name)) {
        context.addIssue({ code: "custom", path, message: `Scenario input '${source.name}' does not exist` });
      }
      if (source.kind === "STEP_RESPONSE" && !priorStepIds.has(source.stepId)) {
        context.addIssue({ code: "custom", path, message: `Step '${source.stepId}' must precede '${step.id}'` });
      }
      if (source.kind === "VARIABLE" && !priorVariables.has(source.name)) {
        context.addIssue({ code: "custom", path, message: `Variable '${source.name}' must be extracted by a previous step` });
      }
    });
    step.extractors.forEach((extractor, extractorIndex) => {
      const normalized = extractor.name.toLocaleLowerCase();
      const owner = extractorOwners.get(normalized);
      if (owner !== undefined) {
        context.addIssue({ code: "custom", path: [section, index, "extractors", extractorIndex, "name"],
          message: `Scenario variable '${extractor.name}' is already extracted by step '${owner}'` });
      } else {
        extractorOwners.set(normalized, step.id);
        priorVariables.add(extractor.name);
      }
    });
    priorStepIds.add(step.id);
  }
}

export const scenarioTestCaseDefinitionSchema = scenarioTestCaseDefinitionBaseSchema
  .superRefine(validateScenarioDefinition);

export const testCaseDefinitionSchema = z.discriminatedUnion("kind", [
  toolTestCaseDefinitionSchema,
  scenarioTestCaseDefinitionSchema,
]).superRefine((definition, context) => {
  if (new TextEncoder().encode(JSON.stringify(definition)).byteLength > TEST_CASE_DEFINITION_MAX_BYTES) {
    context.addIssue({ code: "custom", message: "Test case definition exceeds 2 MiB" });
  }
});

const generatedTestCaseFields = {
  id: true,
  projectId: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const toolTestCaseMutationSchema = toolTestCaseDefinitionSchema.omit(generatedTestCaseFields);
export const scenarioTestCaseMutationSchema = scenarioTestCaseDefinitionBaseSchema
  .omit(generatedTestCaseFields)
  .superRefine(validateScenarioDefinition);
export const testCaseMutationSchema = z.discriminatedUnion("kind", [
  toolTestCaseMutationSchema,
  scenarioTestCaseMutationSchema,
]);

export const createTestCaseRequestSchema = testCaseMutationSchema;
export const updateTestCaseRequestSchema = z.object({
  revision: z.number().int().positive(),
  definition: testCaseMutationSchema,
}).strict();

export const testCaseSummarySchema = z.object({
  id: uuid,
  projectId: uuid,
  kind: z.enum(["tool", "scenario"]),
  name: nameSchema,
  description: descriptionSchema,
  tags: tagsSchema,
  revision: z.number().int().positive(),
  isEnabled: z.boolean(),
  targetConnectionIds: z.array(uuid).max(SCENARIO_STEPS_MAX_COUNT + SCENARIO_CLEANUP_STEPS_MAX_COUNT),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const testCasePageSchema = z.object({
  items: z.array(testCaseSummarySchema),
  nextCursor: z.string().min(1).nullable(),
}).strict();

export type ToolTarget = z.output<typeof toolTargetSchema>;
export type ValueSource = z.output<typeof valueSourceSchema>;
export type ArgumentMapping = z.output<typeof argumentMappingSchema>;
export type ResponseExtractor = z.output<typeof responseExtractorSchema>;
export type ScenarioInputDefinition = z.output<typeof scenarioInputDefinitionSchema>;
export type ScenarioStepDefinition = z.output<typeof scenarioStepDefinitionSchema>;
export type ToolTestCaseDefinition = z.output<typeof toolTestCaseDefinitionSchema>;
export type ScenarioTestCaseDefinition = z.output<typeof scenarioTestCaseDefinitionSchema>;
export type TestCaseDefinition = z.output<typeof testCaseDefinitionSchema>;
export type TestCaseMutation = z.output<typeof testCaseMutationSchema>;
export type UpdateTestCaseRequest = z.output<typeof updateTestCaseRequestSchema>;
export type TestCaseSummary = z.output<typeof testCaseSummarySchema>;
export type TestCasePage = z.output<typeof testCasePageSchema>;

export interface ScenarioStepDependent {
  stepId: string;
  stepName: string;
  mappingTargetPath: string;
}

export function findScenarioStepDependents(
  steps: readonly ScenarioStepDefinition[],
  cleanupSteps: readonly ScenarioStepDefinition[],
  stepId: string,
): ScenarioStepDependent[] {
  return [...steps, ...cleanupSteps].flatMap((step) => step.mappings
    .filter(({ source }) => source.kind === "STEP_RESPONSE" && source.stepId === stepId)
    .map(({ targetPath }) => ({ stepId: step.id, stepName: step.name, mappingTargetPath: targetPath })));
}

export function parseTestCaseDefinition(value: unknown): TestCaseDefinition {
  return testCaseDefinitionSchema.parse(value);
}
