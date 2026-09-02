import type { JsonObject, JsonValue } from "../../shared/tool-definition.js";
import { structuralDiffSchema, type StructuralChange, type StructuralDiff } from "../../shared/run-comparison.js";

export type SafePathToken =
  | { kind: "property"; value: string }
  | { kind: "index"; value: number }
  | { kind: "wildcard" };

const forbiddenProperties = new Set(["__proto__", "prototype", "constructor"]);

export class InvalidComparisonPathError extends Error {
  constructor() { super("Comparison ignore path is invalid"); this.name = "InvalidComparisonPathError"; }
}

function propertyToken(value: string): SafePathToken {
  if (value.length === 0 || forbiddenProperties.has(value)) throw new InvalidComparisonPathError();
  return { kind: "property", value };
}

export function parseSafeJsonPath(expression: string): SafePathToken[] {
  if (expression.length < 1 || expression.length > 512 || expression[0] !== "$") throw new InvalidComparisonPathError();
  const tokens: SafePathToken[] = [];
  let index = 1;
  while (index < expression.length) {
    if (tokens.length >= 64) throw new InvalidComparisonPathError();
    if (expression[index] === ".") {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expression.slice(index + 1));
      if (match === null) throw new InvalidComparisonPathError();
      tokens.push(propertyToken(match[0]));
      index += match[0].length + 1;
      continue;
    }
    if (expression[index] !== "[") throw new InvalidComparisonPathError();
    if (expression.slice(index, index + 3) === "[*]") {
      tokens.push({ kind: "wildcard" }); index += 3; continue;
    }
    const numeric = /^\[(0|[1-9]\d*)\]/.exec(expression.slice(index));
    if (numeric !== null) {
      const value = Number(numeric[1]);
      if (!Number.isSafeInteger(value)) throw new InvalidComparisonPathError();
      tokens.push({ kind: "index", value }); index += numeric[0].length; continue;
    }
    if (expression[index + 1] !== '"' && expression[index + 1] !== "'") throw new InvalidComparisonPathError();
    const quote = expression[index + 1]!;
    let cursor = index + 2;
    let raw = "";
    for (; cursor < expression.length; cursor += 1) {
      const character = expression[cursor]!;
      if (character === "\\") {
        const escaped = expression[cursor + 1];
        if (escaped === undefined || (escaped !== quote && escaped !== "\\")) throw new InvalidComparisonPathError();
        raw += escaped; cursor += 1; continue;
      }
      if (character === quote) break;
      if (character.charCodeAt(0) < 0x20) throw new InvalidComparisonPathError();
      raw += character;
    }
    if (expression[cursor] !== quote || expression[cursor + 1] !== "]") throw new InvalidComparisonPathError();
    tokens.push(propertyToken(raw));
    index = cursor + 2;
  }
  return tokens;
}

export function normalizeSafeJsonPath(expression: string): string {
  return `$${parseSafeJsonPath(expression).map((token) => token.kind === "property"
    ? `[${JSON.stringify(token.value)}]`
    : token.kind === "index" ? `[${token.value}]` : "[*]").join("")}`;
}

type ActualToken = { kind: "property"; value: string } | { kind: "index"; value: number };

function matches(rule: SafePathToken[], path: ActualToken[]): boolean {
  return rule.length === path.length && rule.every((token, index) => {
    const actual = path[index];
    if (actual === undefined) return false;
    if (token.kind === "wildcard") return actual.kind === "index";
    return token.kind === actual.kind && token.value === actual.value;
  });
}

function pointer(path: ActualToken[]): string | undefined {
  if (path.length === 0) return "/";
  const value = `/${path.map((token) => token.kind === "index" ? String(token.value)
    : token.value.replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
  return value.length <= 4_096 ? value : undefined;
}

function valueType(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function diffJsonValues(source: JsonValue, replay: JsonValue, expressions: string[] = [], limits: {
  maxNodes?: number; maxChanges?: number; maxBytes?: number;
} = {}): StructuralDiff {
  const maxNodes = limits.maxNodes ?? 10_000;
  const maxChanges = limits.maxChanges ?? 2_000;
  const maxBytes = limits.maxBytes ?? 1_000_000;
  if (![maxNodes, maxChanges, maxBytes].every((value) => Number.isSafeInteger(value) && value > 0) || maxChanges > 2_000) {
    throw new Error("Structural diff limits are invalid");
  }
  const rules = expressions.map(parseSafeJsonPath);
  const stack: Array<{ source: JsonValue; replay: JsonValue; path: ActualToken[] }> = [{ source, replay, path: [] }];
  const changes: StructuralChange[] = [];
  let visitedNodes = 0;
  let serializedBytes = 0;
  let truncated = false;
  const add = (change: StructuralChange): boolean => {
    const bytes = Buffer.byteLength(JSON.stringify(change), "utf8");
    if (changes.length >= maxChanges || serializedBytes + bytes > maxBytes) { truncated = true; return false; }
    changes.push(change); serializedBytes += bytes; return true;
  };
  while (stack.length > 0) {
    if (visitedNodes >= maxNodes) { truncated = true; break; }
    const item = stack.pop()!; visitedNodes += 1;
    const itemPath = pointer(item.path);
    if (itemPath === undefined) { truncated = true; break; }
    if (Object.is(item.source, item.replay)) continue;
    const sourceType = valueType(item.source); const replayType = valueType(item.replay);
    if (sourceType !== replayType) {
      if (!add({ path: itemPath, kind: "TYPE_CHANGED", source: item.source, replay: item.replay,
        ignored: rules.some((rule) => matches(rule, item.path)) })) break;
      continue;
    }
    if (Array.isArray(item.source) && Array.isArray(item.replay)) {
      const length = Math.max(item.source.length, item.replay.length);
      for (let index = length - 1; index >= 0; index -= 1) {
        const path = [...item.path, { kind: "index", value: index } as const];
        const childPath = pointer(path);
        if (childPath === undefined) { truncated = true; break; }
        if (index >= item.source.length) {
          if (!add({ path: childPath, kind: "ADDED", replay: item.replay[index]!,
            ignored: rules.some((rule) => matches(rule, path)) })) break;
        } else if (index >= item.replay.length) {
          if (!add({ path: childPath, kind: "REMOVED", source: item.source[index]!,
            ignored: rules.some((rule) => matches(rule, path)) })) break;
        } else stack.push({ source: item.source[index]!, replay: item.replay[index]!, path });
      }
      if (truncated) break;
      continue;
    }
    if (isObject(item.source) && isObject(item.replay)) {
      const keys = [...new Set([...Object.keys(item.source), ...Object.keys(item.replay)])].sort().reverse();
      for (const key of keys) {
        const path = [...item.path, { kind: "property", value: key } as const];
        const childPath = pointer(path);
        if (childPath === undefined) { truncated = true; break; }
        if (!Object.hasOwn(item.source, key)) {
          if (!add({ path: childPath, kind: "ADDED", replay: item.replay[key]!,
            ignored: rules.some((rule) => matches(rule, path)) })) break;
        } else if (!Object.hasOwn(item.replay, key)) {
          if (!add({ path: childPath, kind: "REMOVED", source: item.source[key]!,
            ignored: rules.some((rule) => matches(rule, path)) })) break;
        } else stack.push({ source: item.source[key]!, replay: item.replay[key]!, path });
      }
      if (truncated) break;
      continue;
    }
    if (!add({ path: itemPath, kind: "CHANGED", source: item.source, replay: item.replay,
      ignored: rules.some((rule) => matches(rule, item.path)) })) break;
  }
  changes.sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind));
  return structuralDiffSchema.parse({ changes, truncated, visitedNodes, serializedBytes });
}
