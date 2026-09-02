import { z } from "zod";
import { jsonValueSchema } from "./tool-definition.js";

const uuid = z.uuid();
const variableName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/);
const scope = z.enum(["project", "server"]);

const publicBaseVariableSchema = z.object({
  name: variableName,
  scope,
  secret: z.literal(false),
  value: jsonValueSchema,
}).strict();

const secretBaseVariableSchema = z.object({
  name: variableName,
  scope,
  secret: z.literal(true),
  redacted: z.literal(true),
}).strict();

export const serverExportBaseVariableSchema = z.union([
  publicBaseVariableSchema,
  secretBaseVariableSchema,
]);

const unsetProfileVariableSchema = z.object({
  name: variableName,
  scope,
  mode: z.literal("unset"),
  secret: z.literal(false),
}).strict();

const publicProfileVariableSchema = z.object({
  name: variableName,
  scope,
  mode: z.literal("value"),
  secret: z.literal(false),
  value: jsonValueSchema,
}).strict();

const secretProfileVariableSchema = z.object({
  name: variableName,
  scope,
  mode: z.literal("value"),
  secret: z.literal(true),
  redacted: z.literal(true),
}).strict();

export const serverExportProfileVariableSchema = z.union([
  unsetProfileVariableSchema,
  publicProfileVariableSchema,
  secretProfileVariableSchema,
]);

export const serverExportEnvironmentSchema = z.object({
  activeProfileId: uuid.nullable(),
  baseVariables: z.array(serverExportBaseVariableSchema).max(20_000),
  profiles: z.array(z.object({
    id: uuid,
    name: z.string().trim().min(1).max(80),
    description: z.string().max(500),
    parentProfileId: uuid.nullable(),
    revision: z.number().int().positive(),
    variables: z.array(serverExportProfileVariableSchema).max(20_000),
  }).strict()).max(10_000),
}).strict();

export type ServerExportEnvironment = z.output<typeof serverExportEnvironmentSchema>;

export function parseServerExportEnvironment(value: unknown): ServerExportEnvironment {
  return serverExportEnvironmentSchema.parse(value);
}
