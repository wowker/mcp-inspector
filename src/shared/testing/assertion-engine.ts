import { validateJsonSchema } from "../json-schema.js";
import { jsonValueSchema, type JsonValue } from "../tool-definition.js";
import {
  assertionDefinitionSchema,
  assertionResultSchema,
  type AssertionDefinition,
  type AssertionResult,
} from "./assertions.js";
import { linearRegexTest, UnsupportedRegexError } from "./linear-regex.js";

export type AssertionSource = AssertionDefinition["source"];

export interface AssertionContext {
  sources: Partial<Record<AssertionSource, JsonValue>>;
  redactedSources?: ReadonlySet<AssertionSource>;
}

export interface AssertionEngineOptions {
  createId?: () => string;
  now?: () => number;
}

interface ResolvedValue {
  exists: boolean;
  value?: JsonValue;
  resolvedPath: string;
}

class AssertionInputError extends Error {}

const forbiddenSegments = new Set(["__proto__", "prototype", "constructor"]);
const MAX_PATH_SEGMENTS = 128;

function parsePath(path: string): Array<string | number> {
  if (path === "" || path === "$") return [];
  if (!path.startsWith("$")) throw new AssertionInputError("Assertion path must start with $");
  const segments: Array<string | number> = [];
  let cursor = 1;
  const push = (segment: string | number) => {
    if (typeof segment === "string" && forbiddenSegments.has(segment)) {
      throw new AssertionInputError("Assertion path contains a forbidden property");
    }
    segments.push(segment);
    if (segments.length > MAX_PATH_SEGMENTS) throw new AssertionInputError("Assertion path is too deep");
  };
  while (cursor < path.length) {
    if (path[cursor] === ".") {
      cursor += 1;
      const start = cursor;
      while (cursor < path.length && path[cursor] !== "." && path[cursor] !== "[") cursor += 1;
      const segment = path.slice(start, cursor);
      if (segment.length === 0) throw new AssertionInputError("Assertion path contains an empty property");
      push(segment);
      continue;
    }
    if (path[cursor] === "[") {
      const close = path.indexOf("]", cursor + 1);
      if (close === -1) throw new AssertionInputError("Assertion path has an unclosed bracket");
      const token = path.slice(cursor + 1, close).trim();
      if (/^(?:0|[1-9]\d*)$/.test(token)) {
        push(Number(token));
      } else if ((token.startsWith('"') && token.endsWith('"')) ||
                 (token.startsWith("'") && token.endsWith("'"))) {
        let property: string;
        try {
          property = token[0] === '"'
            ? JSON.parse(token) as string
            : token.slice(1, -1).replaceAll("\\'", "'").replaceAll("\\\\", "\\");
        } catch { throw new AssertionInputError("Assertion path has an invalid quoted property"); }
        push(property);
      } else {
        throw new AssertionInputError("Assertion path bracket must contain an index or quoted property");
      }
      cursor = close + 1;
      continue;
    }
    throw new AssertionInputError("Assertion path syntax is invalid");
  }
  return segments;
}

function resolve(source: JsonValue | undefined, path: string): ResolvedValue {
  const segments = parsePath(path);
  if (source === undefined) return { exists: false, resolvedPath: path || "$" };
  let value: JsonValue = source;
  for (const segment of segments) {
    if (typeof segment === "number") {
      if (!Array.isArray(value) || segment >= value.length) return { exists: false, resolvedPath: path };
      value = value[segment]!;
    } else {
      if (value === null || Array.isArray(value) || typeof value !== "object" ||
          !Object.prototype.hasOwnProperty.call(value, segment)) {
        return { exists: false, resolvedPath: path };
      }
      value = value[segment]!;
    }
  }
  return { exists: true, value, resolvedPath: path || "$" };
}

function valueType(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value;
}

function comparableString(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLocaleLowerCase();
}

function deepEqual(actual: JsonValue, expected: JsonValue, definition: AssertionDefinition, exactObject = true): boolean {
  if (typeof actual === "string" && typeof expected === "string") {
    return comparableString(actual, definition.options?.caseSensitive !== false) ===
      comparableString(expected, definition.options?.caseSensitive !== false);
  }
  if (actual === null || expected === null || typeof actual !== "object" || typeof expected !== "object") {
    return Object.is(actual, expected);
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return false;
    if (definition.options?.arrayOrder !== "UNORDERED") {
      return actual.every((value, index) => deepEqual(value, expected[index]!, definition, true));
    }
    const used = new Set<number>();
    return expected.every((expectedValue) => {
      const index = actual.findIndex((actualValue, candidate) =>
        !used.has(candidate) && deepEqual(actualValue, expectedValue, definition, true));
      if (index === -1) return false;
      used.add(index);
      return true;
    });
  }
  const actualObject = actual as Record<string, JsonValue>;
  const expectedObject = expected as Record<string, JsonValue>;
  const actualKeys = Object.keys(actualObject);
  const expectedKeys = Object.keys(expectedObject);
  if (exactObject && actualKeys.length !== expectedKeys.length) return false;
  return expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(actualObject, key) &&
    deepEqual(actualObject[key]!, expectedObject[key]!, definition, true));
}

function expectedValue(definition: AssertionDefinition): JsonValue {
  if (!("expected" in definition) || definition.expected === undefined) {
    throw new AssertionInputError(`${definition.operator} requires an expected value`);
  }
  return definition.expected;
}

function expectedNumber(definition: AssertionDefinition): number {
  const expected = expectedValue(definition);
  if (typeof expected !== "number" || !Number.isFinite(expected)) {
    throw new AssertionInputError(`${definition.operator} requires a numeric expected value`);
  }
  return expected;
}

function actualNumber(actual: JsonValue | undefined, definition: AssertionDefinition): number {
  if (typeof actual !== "number" || !Number.isFinite(actual)) {
    throw new AssertionInputError(`${definition.operator} requires a numeric actual value`);
  }
  return actual;
}

function matches(definition: AssertionDefinition, resolved: ResolvedValue): boolean {
  const actual = resolved.value;
  const expected = () => expectedValue(definition);
  switch (definition.operator) {
    case "EXISTS": return resolved.exists;
    case "NOT_EXISTS": return !resolved.exists;
    case "IS_NULL": return resolved.exists && actual === null;
    case "NOT_NULL": return resolved.exists && actual !== null;
    case "EQUALS": {
      if (!resolved.exists) return false;
      const value = expected();
      const exact = definition.options?.objectMatch === "EXACT";
      return deepEqual(actual!, value, definition, exact || typeof value !== "object" || value === null || Array.isArray(value));
    }
    case "NOT_EQUALS": {
      if (!resolved.exists) return true;
      const value = expected();
      const exact = definition.options?.objectMatch === "EXACT";
      return !deepEqual(actual!, value, definition, exact || typeof value !== "object" || value === null || Array.isArray(value));
    }
    case "DEEP_EQUALS": return resolved.exists && deepEqual(actual!, expected(), definition, true);
    case "SUBSET": {
      if (!resolved.exists) return false;
      return deepEqual(actual!, expected(), definition, definition.options?.objectMatch === "EXACT");
    }
    case "CONTAINS": {
      if (!resolved.exists) return false;
      const value = expected();
      if (typeof actual === "string" && typeof value === "string") {
        return comparableString(actual, definition.options?.caseSensitive !== false)
          .includes(comparableString(value, definition.options?.caseSensitive !== false));
      }
      if (Array.isArray(actual)) return actual.some((item) => deepEqual(item, value, definition, true));
      throw new AssertionInputError("CONTAINS requires a string or array actual value");
    }
    case "STARTS_WITH":
    case "ENDS_WITH": {
      const value = expected();
      if (typeof actual !== "string" || typeof value !== "string") {
        throw new AssertionInputError(`${definition.operator} requires string values`);
      }
      const normalizedActual = comparableString(actual, definition.options?.caseSensitive !== false);
      const normalizedExpected = comparableString(value, definition.options?.caseSensitive !== false);
      return definition.operator === "STARTS_WITH"
        ? normalizedActual.startsWith(normalizedExpected)
        : normalizedActual.endsWith(normalizedExpected);
    }
    case "MATCHES_REGEX": {
      const value = expected();
      if (typeof actual !== "string" || typeof value !== "string") {
        throw new AssertionInputError("MATCHES_REGEX requires string values");
      }
      try {
        return linearRegexTest(value, actual, definition.options?.caseSensitive !== false);
      } catch (error) {
        if (error instanceof UnsupportedRegexError) throw new AssertionInputError(error.message);
        throw error;
      }
    }
    case "GT": return actualNumber(actual, definition) > expectedNumber(definition);
    case "GTE": return actualNumber(actual, definition) >= expectedNumber(definition);
    case "LT": return actualNumber(actual, definition) < expectedNumber(definition);
    case "LTE": return actualNumber(actual, definition) <= expectedNumber(definition);
    case "BETWEEN": {
      const value = expected();
      if (!Array.isArray(value) || value.length !== 2 || value.some((item) => typeof item !== "number")) {
        throw new AssertionInputError("BETWEEN requires [minimum, maximum]");
      }
      const [minimum, maximum] = value as [number, number];
      const number = actualNumber(actual, definition);
      return number >= minimum && number <= maximum;
    }
    case "LENGTH_EQUALS":
    case "LENGTH_GTE": {
      if (!Array.isArray(actual) && typeof actual !== "string") {
        throw new AssertionInputError(`${definition.operator} requires a string or array actual value`);
      }
      const length = actual.length;
      const value = expectedNumber(definition);
      return definition.operator === "LENGTH_EQUALS" ? length === value : length >= value;
    }
    case "ARRAY_CONTAINS":
      if (!Array.isArray(actual)) throw new AssertionInputError("ARRAY_CONTAINS requires an array actual value");
      return actual.some((item) => deepEqual(item, expected(), definition, true));
    case "TYPE_IS": {
      const value = expected();
      if (typeof value !== "string" || !["null", "boolean", "number", "integer", "string", "array", "object"].includes(value)) {
        throw new AssertionInputError("TYPE_IS requires a supported type name");
      }
      if (!resolved.exists) return false;
      const actualType = valueType(actual!);
      return value === "number" ? actualType === "number" || actualType === "integer" : actualType === value;
    }
    case "MATCHES_SCHEMA": {
      const schema = expected();
      if (schema === null || Array.isArray(schema) || typeof schema !== "object") {
        throw new AssertionInputError("MATCHES_SCHEMA requires a JSON object schema");
      }
      if (!resolved.exists) return false;
      const validation = validateJsonSchema(schema, actual);
      if (validation.warning !== null) throw new AssertionInputError("JSON Schema could not be compiled");
      return validation.issues.length === 0;
    }
    case "STATUS_IS": {
      const value = expected();
      if (typeof actual !== "string" || typeof value !== "string") throw new AssertionInputError("STATUS_IS requires string values");
      return actual === value;
    }
    case "IS_ERROR_IS": {
      const value = expected();
      if (typeof actual !== "boolean" || typeof value !== "boolean") throw new AssertionInputError("IS_ERROR_IS requires boolean values");
      return actual === value;
    }
    case "DURATION_LTE":
    case "NETWORK_DURATION_LTE": return actualNumber(actual, definition) <= expectedNumber(definition);
  }
}

export function evaluateAssertion(
  input: AssertionDefinition,
  context: AssertionContext,
  options: AssertionEngineOptions = {},
): AssertionResult {
  const startedAt = (options.now ?? (() => performance.now()))();
  const createId = options.createId ?? (() => globalThis.crypto.randomUUID());
  const parsed = assertionDefinitionSchema.safeParse(input);
  const definition = parsed.success ? parsed.data : input;
  const redacted = parsed.success && context.redactedSources?.has(parsed.data.source) === true;
  let resolvedPath: string | null = parsed.success ? parsed.data.path || "$" : null;
  let actual: JsonValue | undefined;
  let status: AssertionResult["status"] = "ERROR";
  let errorCode: string | null = "ASSERTION_INVALID";
  let message: string | null = null;
  try {
    if (!parsed.success) throw new AssertionInputError(parsed.error.issues[0]?.message ?? "Assertion is invalid");
    const resolved = resolve(context.sources[parsed.data.source], parsed.data.path);
    resolvedPath = resolved.resolvedPath;
    actual = resolved.value;
    let passed = matches(parsed.data, resolved);
    if (parsed.data.options?.isNegated === true) passed = !passed;
    status = passed ? "PASSED" : "FAILED";
    errorCode = null;
    message = passed ? null : parsed.data.message ?? `Assertion ${parsed.data.id} failed`;
  } catch (error) {
    status = "ERROR";
    errorCode = error instanceof AssertionInputError ? "ASSERTION_INVALID" : "ASSERTION_EVALUATION_ERROR";
    message = error instanceof Error ? error.message : "Assertion evaluation failed";
  }
  const finishedAt = (options.now ?? (() => performance.now()))();
  const result = {
    id: createId(),
    assertionId: definition.id,
    status,
    definition,
    resolvedPath,
    ...(!redacted && actual !== undefined && jsonValueSchema.safeParse(actual).success ? { actual } : {}),
    ...(!redacted && parsed.success && parsed.data.expected !== undefined ? { expected: parsed.data.expected } : {}),
    errorCode,
    message,
    durationMs: Math.max(0, Math.ceil(finishedAt - startedAt)),
    isRedacted: redacted,
  };
  return assertionResultSchema.parse(result);
}
