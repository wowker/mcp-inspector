export type SchemaFieldKind = "string" | "number" | "integer" | "boolean" | "enum" | "json";
export interface SchemaField {
  name: string; path: string; kind: SchemaFieldKind; required: boolean; description?: string;
  defaultValue?: unknown; enumValues?: unknown[]; constraints: Record<string, unknown>;
  schema: Record<string, unknown>; value: unknown; additional: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unsupported(schema: Record<string, unknown>): boolean {
  return ["$ref", "allOf", "anyOf", "oneOf", "if", "then", "else"].some((key) => key in schema) ||
    (schema.type === "array" && Array.isArray(schema.items));
}

function kind(schema: Record<string, unknown>): SchemaFieldKind {
  if (unsupported(schema)) return "json";
  if (Array.isArray(schema.enum)) return "enum";
  if (schema.type === "string") return "string";
  if (schema.type === "number") return "number";
  if (schema.type === "integer") return "integer";
  if (schema.type === "boolean") return "boolean";
  return "json";
}

export function fieldsFromSchema(schema: Record<string, unknown>, value: Record<string, unknown>): SchemaField[] {
  const properties = isObject(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
  const fields: SchemaField[] = Object.entries(properties).map(([name, candidate]) => {
    const fieldSchema = isObject(candidate) ? candidate : {};
    const constraints = Object.fromEntries(["minLength", "maxLength", "minimum", "maximum", "pattern", "format"]
      .filter((key) => key in fieldSchema).map((key) => [key, fieldSchema[key]]));
    return { name, path: `/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`, kind: kind(fieldSchema),
      required: required.has(name), description: typeof fieldSchema.description === "string" ? fieldSchema.description : undefined,
      defaultValue: fieldSchema.default, enumValues: Array.isArray(fieldSchema.enum) ? fieldSchema.enum : undefined,
      constraints, schema: fieldSchema, value: value[name], additional: false } satisfies SchemaField;
  });
  for (const name of Object.keys(value).filter((name) => !(name in properties))) {
    fields.push({ name, path: `/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      kind: "json", required: false, schema: {}, value: value[name], additional: true, constraints: {} });
  }
  return fields;
}

export function valueFromInput(field: SchemaField, text: string, checked?: boolean): { ok: true; value: unknown } | { ok: false } {
  if (field.kind === "boolean") return { ok: true, value: Boolean(checked) };
  if (field.kind === "string") return { ok: true, value: text };
  if (field.kind === "number" || field.kind === "integer") {
    if (text.trim() === "") return { ok: false };
    const value = Number(text);
    if (!Number.isFinite(value) || (field.kind === "integer" && !Number.isInteger(value))) return { ok: false };
    return { ok: true, value };
  }
  if (field.kind === "enum") {
    const index = Number(text); return Number.isInteger(index) && field.enumValues?.[index] !== undefined
      ? { ok: true, value: field.enumValues[index] } : { ok: false };
  }
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; }
}
