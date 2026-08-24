import { type ErrorObject, type ValidateFunction } from "ajv";
import { Ajv as AjvDraft7, addFormats } from "@modelcontextprotocol/client/validators/ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { resolveSchemaDialect } from "./schema-dialect.js";

export interface SchemaIssue { path: string; keyword: string; message: string }
export interface SchemaValidation { issues: SchemaIssue[]; warning: string | null }

const modern = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
const legacy = new AjvDraft7({ allErrors: true, strict: false, validateFormats: true });
addFormats(modern); addFormats(legacy);
const cache = new Map<string, ValidateFunction>();

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

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
  const resolution = resolveSchemaDialect(schema);
  if (resolution.dialect === "unknown") return { issues: [], warning: resolution.warning };
  const compile = (resolution.dialect === "draft-07" ? legacy.compile.bind(legacy) : modern.compile.bind(modern)) as unknown as
    (schema: Record<string, unknown>) => ValidateFunction;
  let validate: ValidateFunction;
  const key = `${resolution.dialect}:${canonical(schema)}`;
  try {
    validate = cache.get(key) ?? compile(schema);
    cache.set(key, validate);
  }
  catch (error) {
    return { issues: [], warning: `无法编译 Schema：${error instanceof Error ? error.message : "unknown error"}` };
  }
  validate(value);
  return {
    issues: (validate.errors ?? []).map(issue),
    warning: null,
  };
}

export function validateArguments(schema: Record<string, unknown>, value: Record<string, unknown>): SchemaIssue[] {
  return validateJsonSchema(schema, value).issues;
}
