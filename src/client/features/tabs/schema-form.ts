export type SchemaFieldKind = "string" | "number" | "integer" | "boolean" | "enum" | "json";
export interface SchemaField {
  name: string; path: string; kind: SchemaFieldKind; required: boolean; description?: string;
  defaultValue?: unknown; enumValues?: unknown[]; constraints: Record<string, unknown>;
  schema: Record<string, unknown>; value: unknown; additional: boolean;
}

export interface ObjectBranchOption {
  title: string;
  value: unknown;
  schema: Record<string, unknown>;
  propertyNames: readonly string[];
}

export interface ObjectBranchModel {
  keyword: "oneOf" | "anyOf";
  propertyName: string;
  commonPropertyNames: readonly string[];
  branchPropertyNames: readonly string[];
  options: readonly ObjectBranchOption[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const prototypeKeys = new Set(["__proto__", "constructor", "prototype"]);

export function objectValueIsSafe(value: unknown): value is Record<string, unknown> {
  return isObject(value) && Object.keys(value).every((name) => !prototypeKeys.has(name));
}

function unescapeJsonPointerToken(value: string): string | null {
  if (/~(?:[^01]|$)/u.test(value)) return null;
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function escapeJsonPointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function appendJsonPointer(path: string, name: string): string {
  return `${path}/${escapeJsonPointerToken(name)}`;
}

export function valueAtJsonPointer(root: unknown, path: string): unknown {
  if (path === "") return root;
  if (!path.startsWith("/")) return undefined;
  let current = root;
  for (const rawToken of path.slice(1).split("/")) {
    const token = unescapeJsonPointerToken(rawToken);
    if (token === null || prototypeKeys.has(token) || current === null || typeof current !== "object") {
      return undefined;
    }
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(token)) return undefined;
      current = current[Number(token)];
      continue;
    }
    if (!Object.hasOwn(current, token)) return undefined;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

export function safeObjectEditorSchema(schema: Record<string, unknown>, value?: unknown): Record<string, unknown> | null {
  if (schema.type !== "object" || unsupported(schema)) return null;
  if (schema.properties !== undefined && !isObject(schema.properties)) return null;
  const properties = isObject(schema.properties) ? schema.properties : {};
  if (Object.keys(properties).length === 0) return null;
  if (Object.keys(properties).some((name) => prototypeKeys.has(name))) return null;
  if (isObject(value) && !objectValueIsSafe(value)) return null;
  if (["patternProperties", "dependentSchemas", "dependencies", "propertyNames", "unevaluatedProperties"]
    .some((keyword) => keyword in schema)) return null;
  return schema;
}

function branchLabel(schema: Record<string, unknown>, propertyName: string): unknown | undefined {
  const properties = isObject(schema.properties) ? schema.properties : null;
  const property = properties !== null && isObject(properties[propertyName]) ? properties[propertyName] : null;
  if (property === null) return undefined;
  const constValue = Object.hasOwn(property, "const") ? property.const : undefined;
  const enumValue = Array.isArray(property.enum) && property.enum.length === 1 ? property.enum[0] : undefined;
  const value = constValue !== undefined ? constValue : enumValue;
  if (constValue !== undefined && enumValue !== undefined && !Object.is(constValue, enumValue)) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function uniqueBranchLabels(branches: readonly Record<string, unknown>[], propertyName: string): unknown[] | null {
  const labels = branches.map((branch) => branchLabel(branch, propertyName));
  if (labels.some((label) => label === undefined)) return null;
  const identities = labels.map((label) => JSON.stringify(label));
  return new Set(identities).size === labels.length ? labels : null;
}

function mergedBranchSchema(parent: Record<string, unknown>, branch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...parent, ...branch, type: "object" };
  delete merged.oneOf;
  delete merged.anyOf;
  delete merged.discriminator;
  const parentProperties = isObject(parent.properties) ? parent.properties : {};
  const branchProperties = isObject(branch.properties) ? branch.properties : {};
  merged.properties = { ...parentProperties, ...branchProperties };
  const required = [...new Set([
    ...(Array.isArray(parent.required) ? parent.required.filter((name): name is string => typeof name === "string") : []),
    ...(Array.isArray(branch.required) ? branch.required.filter((name): name is string => typeof name === "string") : []),
  ])];
  if (required.length > 0) merged.required = required;
  else delete merged.required;
  return merged;
}

export function discriminatedObjectBranches(schema: Record<string, unknown>): ObjectBranchModel | null {
  if (schema.type !== "object" || ["$ref", "allOf", "if", "then", "else"].some((key) => key in schema)) return null;
  if (schema.properties !== undefined && !isObject(schema.properties)) return null;
  if (schema.required !== undefined && (!Array.isArray(schema.required) ||
    schema.required.some((name) => typeof name !== "string"))) return null;
  const keywords = (["oneOf", "anyOf"] as const).filter((keyword) => keyword in schema);
  if (keywords.length !== 1) return null;
  const keyword = keywords[0];
  const candidates = schema[keyword];
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 12) return null;
  const branches = candidates.every((candidate) => isObject(candidate) && candidate.type === "object" &&
    !["$ref", "allOf", "oneOf", "anyOf", "if", "then", "else"].some((key) => key in candidate) &&
    isObject(candidate.properties) &&
    (candidate.required === undefined || (Array.isArray(candidate.required) &&
      candidate.required.every((name) => typeof name === "string"))))
    ? candidates as Record<string, unknown>[] : null;
  if (branches === null) return null;
  const discriminator = isObject(schema.discriminator) && typeof schema.discriminator.propertyName === "string"
    ? schema.discriminator.propertyName : null;
  let propertyName: string;
  let labels: unknown[] | null;
  if (discriminator !== null) {
    if (prototypeKeys.has(discriminator)) return null;
    propertyName = discriminator;
    labels = uniqueBranchLabels(branches, propertyName);
  } else {
    const possible = Object.keys(branches[0].properties as Record<string, unknown>)
      .filter((name) => !prototypeKeys.has(name) && uniqueBranchLabels(branches, name) !== null);
    if (possible.length !== 1) return null;
    propertyName = possible[0];
    labels = uniqueBranchLabels(branches, propertyName);
  }
  if (labels === null) return null;
  const commonProperties = isObject(schema.properties) ? Object.keys(schema.properties) : [];
  if (commonProperties.some((name) => prototypeKeys.has(name))) return null;
  const branchPropertyNames = [...new Set(branches.flatMap((branch) => Object.keys(branch.properties as Record<string, unknown>)))];
  if (branchPropertyNames.some((name) => prototypeKeys.has(name))) return null;
  const options = branches.map((branch, index) => ({
    title: typeof branch.title === "string" && branch.title.trim() !== "" ? branch.title : String(labels[index]),
    value: labels[index],
    schema: mergedBranchSchema(schema, branch),
    propertyNames: Object.keys(branch.properties as Record<string, unknown>),
  }));
  return { keyword, propertyName, commonPropertyNames: commonProperties, branchPropertyNames, options };
}

export function selectedObjectBranch(model: ObjectBranchModel, value: Record<string, unknown>): number {
  return model.options.findIndex((option) => Object.is(option.value, value[model.propertyName]));
}

export function planObjectBranchSwitch(model: ObjectBranchModel, current: Record<string, unknown>, optionIndex: number): {
  value: Record<string, unknown>;
  removed: string[];
} {
  const option = model.options[optionIndex];
  if (option === undefined) return { value: current, removed: [] };
  const allowed = new Set([...model.commonPropertyNames, ...option.propertyNames]);
  const knownBranchProperties = new Set(model.branchPropertyNames);
  const removed = Object.keys(current).filter((name) => knownBranchProperties.has(name) && !allowed.has(name));
  const value = { ...current };
  for (const name of removed) delete value[name];
  value[model.propertyName] = option.value;
  return { value, removed };
}

export function arrayObjectItemSchema(schema: Record<string, unknown>): Record<string, unknown> | null {
  if (schema.type !== "array" || !isObject(schema.items) || schema.items.type !== "object") return null;
  return schema.items;
}

function unsupported(schema: Record<string, unknown>): boolean {
  return ["$ref", "allOf", "anyOf", "oneOf", "if", "then", "else"].some((key) => key in schema) ||
    (schema.type === "array" && Array.isArray(schema.items));
}

function rootConstraintUsesOnlyDeclaredFields(value: unknown, declared: ReadonlySet<string>): boolean {
  if (!isObject(value) || "$ref" in value) return false;
  if (value.type !== undefined && value.type !== "object") return false;
  if (value.required !== undefined && (!Array.isArray(value.required) ||
    value.required.some((name) => typeof name !== "string" || !declared.has(name)))) return false;
  if (value.properties !== undefined && (!isObject(value.properties) ||
    Object.keys(value.properties).some((name) => !declared.has(name)))) return false;
  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    if (!(keyword in value)) continue;
    const branches = value[keyword];
    if (!Array.isArray(branches) || branches.length === 0 ||
      branches.some((branch) => !rootConstraintUsesOnlyDeclaredFields(branch, declared))) return false;
  }
  for (const keyword of ["if", "then", "else"] as const) {
    if (keyword in value && !rootConstraintUsesOnlyDeclaredFields(value[keyword], declared)) return false;
  }
  return true;
}

export function requiresWholeArgumentsFallback(schema: Record<string, unknown>): boolean {
  if (schema.type !== "object" || ("properties" in schema && !isObject(schema.properties))) return true;
  const properties = isObject(schema.properties) ? schema.properties : {};
  if (Object.keys(properties).some((name) => prototypeKeys.has(name))) return true;
  const declared = new Set(Object.keys(properties));
  return !rootConstraintUsesOnlyDeclaredFields(schema, declared);
}

export function schemaHasEditableArguments(
  schema: Record<string, unknown>,
  value: Record<string, unknown>,
): boolean {
  return requiresWholeArgumentsFallback(schema) || fieldsFromSchema(schema, value).length > 0;
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
    return { name, path: appendJsonPointer("", name), kind: kind(fieldSchema),
      required: required.has(name), description: typeof fieldSchema.description === "string" ? fieldSchema.description : undefined,
      defaultValue: fieldSchema.default, enumValues: Array.isArray(fieldSchema.enum) ? fieldSchema.enum : undefined,
      constraints, schema: fieldSchema, value: value[name], additional: false } satisfies SchemaField;
  });
  for (const name of Object.keys(value).filter((name) => !Object.hasOwn(properties, name))) {
    fields.push({ name, path: appendJsonPointer("", name),
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
