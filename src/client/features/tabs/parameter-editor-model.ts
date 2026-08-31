import type { SchemaIssue } from "../../../shared/json-schema.js";
import type { SchemaField } from "./schema-form.js";

export type ParameterFilter = "all" | "required" | "filled" | "errors";

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || value.length > 0;
}

function issueTargetsField(issue: SchemaIssue, field: SchemaField): boolean {
  return issue.path === field.path || issue.path.startsWith(`${field.path}/`);
}

export function parameterStatus(fields: readonly SchemaField[], issues: readonly SchemaIssue[]): {
  requiredCompleted: number;
  requiredTotal: number;
  errorCount: number;
} {
  const required = fields.filter((field) => field.required);
  return {
    requiredCompleted: required.filter((field) => hasValue(field.value)).length,
    requiredTotal: required.length,
    errorCount: issues.length,
  };
}

export function fieldMatchesFilter(
  field: SchemaField,
  issues: readonly SchemaIssue[],
  filter: ParameterFilter,
): boolean {
  if (filter === "required") return field.required;
  if (filter === "filled") return hasValue(field.value);
  if (filter === "errors") return issues.some((issue) => issueTargetsField(issue, field));
  return true;
}

function range(constraints: Readonly<Record<string, unknown>>, minimum: string, maximum: string): string | null {
  const min = constraints[minimum];
  const max = constraints[maximum];
  if (typeof min !== "number" && typeof max !== "number") return null;
  if (typeof min === "number" && typeof max === "number") return `${min}–${max}`;
  return typeof min === "number" ? `≥ ${min}` : `≤ ${String(max)}`;
}

export function summarizeConstraints(field: SchemaField): string[] {
  const result = [field.kind === "enum" ? "enum" : field.kind];
  const numericRange = range(field.constraints, "minimum", "maximum");
  const lengthRange = range(field.constraints, "minLength", "maxLength");
  if (numericRange !== null) result.push(numericRange);
  if (lengthRange !== null) result.push(lengthRange);
  if (typeof field.constraints.pattern === "string") result.push("pattern");
  if (typeof field.constraints.format === "string") result.push(String(field.constraints.format));
  return result;
}

function jsonType(value: unknown): string {
  if (value === null) return "Null";
  if (Array.isArray(value)) return "Array";
  if (typeof value === "object") return "Object";
  if (typeof value === "string") return "String";
  if (typeof value === "number") return "Number";
  if (typeof value === "boolean") return "Boolean";
  return "JSON";
}

export function summarizeJsonValue(value: unknown, locale: "zh-CN" | "en-US" = "zh-CN"): string {
  const item = locale === "zh-CN" ? "项" : "items";
  const fields = locale === "zh-CN" ? "个字段" : "fields";
  const unset = locale === "zh-CN" ? "未设置" : "not set";
  if (value === undefined) return `JSON · ${unset}`;
  if (Array.isArray(value)) {
    const itemType = value.length === 0 ? "Unknown" : jsonType(value[0]);
    return `Array<${itemType}> · ${value.length} ${item}`;
  }
  if (typeof value === "object" && value !== null) {
    return `Object · ${Object.keys(value).length} ${fields}`;
  }
  return jsonType(value);
}
