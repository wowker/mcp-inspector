import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import AjvDraft7 from "ajv/dist/ajv.js";
import addFormats from "ajv-formats";

export interface SchemaIssue { path: string; keyword: string; message: string }
export interface SchemaValidation { issues: SchemaIssue[]; warning: string | null }

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function issue(error: ErrorObject): SchemaIssue {
  let path = error.instancePath;
  if (error.keyword === "required") {
    const missing = (error.params as { missingProperty?: unknown }).missingProperty;
    if (typeof missing === "string") path += `/${escapePointer(missing)}`;
  }
  return { path, keyword: error.keyword, message: error.message ?? "Schema validation failed" };
}

export function validateJsonSchema(
  schema: Record<string, unknown>, value: unknown,
): SchemaValidation {
  const dialect = typeof schema.$schema === "string" ? schema.$schema : null;
  const draft7 = dialect?.includes("draft-07") ?? false;
  const known = dialect === null || draft7 || dialect.includes("2020-12");
  const ajv = draft7
    ? new AjvDraft7({ allErrors: true, strict: false, validateFormats: true })
    : new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv);
  let validate: ValidateFunction;
  const compilable = known ? schema : Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$schema"));
  try { validate = ajv.compile(compilable); }
  catch (error) {
    const prefix = known ? "" : `未知 JSON Schema 方言：${dialect}；`;
    return { issues: [], warning: `${prefix}无法编译 Schema：${error instanceof Error ? error.message : "unknown error"}` };
  }
  validate(value);
  return {
    issues: (validate.errors ?? []).map(issue),
    warning: known ? null : `未知 JSON Schema 方言：${dialect}`,
  };
}

export function validateArguments(schema: Record<string, unknown>, value: Record<string, unknown>): SchemaIssue[] {
  return validateJsonSchema(schema, value).issues;
}
