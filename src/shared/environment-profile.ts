import { z } from "zod";
import { jsonValueSchema } from "./tool-definition.js";

export const ENVIRONMENT_PROFILE_MAX_DEPTH = 8;
export const ENVIRONMENT_PROFILE_NAME_MAX_LENGTH = 80;
export const ENVIRONMENT_PROFILE_DESCRIPTION_MAX_LENGTH = 500;

const uuid = z.uuid();
const timestamp = z.string().datetime({ offset: true });
const variableName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/);

export const environmentProfileMutationSchema = z.object({
  name: z.string().trim().min(1).max(ENVIRONMENT_PROFILE_NAME_MAX_LENGTH),
  description: z.string().trim().max(ENVIRONMENT_PROFILE_DESCRIPTION_MAX_LENGTH),
  parentProfileId: uuid.nullable(),
}).strict();

export const environmentProfileUpdateSchema = environmentProfileMutationSchema.extend({
  revision: z.number().int().positive(),
}).strict();

export const environmentProfileSchema = z.object({
  id: uuid,
  projectId: uuid,
  name: z.string().trim().min(1).max(ENVIRONMENT_PROFILE_NAME_MAX_LENGTH),
  description: z.string().max(ENVIRONMENT_PROFILE_DESCRIPTION_MAX_LENGTH),
  parentProfileId: uuid.nullable(),
  revision: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export type EnvironmentProfile = z.output<typeof environmentProfileSchema>;
export type EnvironmentProfileMutation = z.output<typeof environmentProfileMutationSchema>;
export type EnvironmentProfileUpdate = z.output<typeof environmentProfileUpdateSchema>;

export function parseEnvironmentProfile(value: unknown): EnvironmentProfile {
  return environmentProfileSchema.parse(value);
}

const valueMutationSchema = z.object({
  mode: z.literal("value"),
  value: jsonValueSchema,
  secret: z.boolean(),
}).strict();

const unsetMutationSchema = z.object({
  mode: z.literal("unset"),
}).strict();

export const environmentProfileVariableMutationSchema = z.discriminatedUnion("mode", [
  valueMutationSchema,
  unsetMutationSchema,
]);

export type EnvironmentProfileVariableMutation = z.output<
  typeof environmentProfileVariableMutationSchema
>;

const commonProfileVariable = {
  id: uuid,
  projectId: uuid,
  profileId: uuid,
  connectionId: uuid.nullable(),
  name: variableName,
  createdAt: timestamp,
  updatedAt: timestamp,
};

export const environmentProfileVariableSchema = z.union([
  z.object({
    ...commonProfileVariable,
    mode: z.literal("unset"),
    secret: z.literal(false),
  }).strict(),
  z.object({
    ...commonProfileVariable,
    mode: z.literal("value"),
    secret: z.literal(false),
    value: jsonValueSchema,
  }).strict(),
  z.object({
    ...commonProfileVariable,
    mode: z.literal("value"),
    secret: z.literal(true),
  }).strict(),
]);

export type EnvironmentProfileVariable = z.output<typeof environmentProfileVariableSchema>;

export function parseEnvironmentProfileVariable(value: unknown): EnvironmentProfileVariable {
  return environmentProfileVariableSchema.parse(value);
}

export const environmentProfilePreviewVariableSchema = z.object({
  name: variableName,
  scope: z.enum(["project", "server"]),
  secret: z.boolean(),
  source: z.enum(["base", "profile"]),
  sourceProfileId: uuid.nullable(),
  value: jsonValueSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.secret && value.value !== undefined) {
    context.addIssue({
      code: "custom",
      message: "Secret preview variables must not expose values",
      path: ["value"],
    });
  }
});

export const environmentProfilePreviewSchema = z.object({
  profileId: uuid.nullable(),
  chain: z.array(environmentProfileSchema).max(ENVIRONMENT_PROFILE_MAX_DEPTH),
  variables: z.array(environmentProfilePreviewVariableSchema),
  references: z.array(z.object({
    location: z.string().min(1).max(256),
    variables: z.array(variableName),
    missing: z.array(variableName),
  }).strict()),
}).strict();

export type EnvironmentProfilePreview = z.output<typeof environmentProfilePreviewSchema>;

export function parseEnvironmentProfilePreview(value: unknown): EnvironmentProfilePreview {
  return environmentProfilePreviewSchema.parse(value);
}
