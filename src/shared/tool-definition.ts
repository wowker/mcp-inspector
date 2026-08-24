import { z } from "zod";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(jsonValueSchema),
  jsonObjectSchema,
]));

const jsonObjectSchema: z.ZodType<JsonObject> = z.lazy(() =>
  z.record(z.string(), jsonValueSchema));

const jsonSchemaObject = z.object({
  $schema: z.string().optional(),
  type: z.literal("object"),
  properties: z.record(z.string(), jsonValueSchema).optional(),
  required: z.array(z.string()).optional(),
}).catchall(jsonValueSchema);

const toolAnnotationsSchema = z.object({
  title: z.string().optional(),
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
}).catchall(jsonValueSchema);

const toolExecutionSchema = z.object({
  taskSupport: z.enum(["required", "optional", "forbidden"]).optional(),
}).catchall(jsonValueSchema);

const iconSchema = z.object({
  src: z.string(),
  mimeType: z.string().optional(),
  sizes: z.array(z.string()).optional(),
  theme: z.enum(["light", "dark"]).optional(),
}).catchall(jsonValueSchema);

const metaSchema = z.object({}).catchall(jsonValueSchema);

/**
 * Runtime counterpart of the installed MCP SDK's Tool schema. Known fields stay
 * constrained while every object layer retains JSON-valued protocol extensions.
 */
export const toolDefinitionSchema = z.object({
  name: z.string().refine((name) => name.trim().length > 0),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: jsonSchemaObject,
  outputSchema: jsonSchemaObject.optional(),
  annotations: toolAnnotationsSchema.optional(),
  execution: toolExecutionSchema.optional(),
  icons: z.array(iconSchema).optional(),
  _meta: metaSchema.optional(),
}).catchall(jsonValueSchema);

export type ToolDefinition = z.output<typeof toolDefinitionSchema>;

export function parseToolDefinition(value: unknown): ToolDefinition {
  return toolDefinitionSchema.parse(value);
}
