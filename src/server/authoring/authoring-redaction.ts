import { createHash } from "node:crypto";
import type { JsonObject, JsonValue } from "../../shared/tool-definition.js";

export interface AuthoringRedactionResult {
  value: JsonValue;
  redactionCount: number;
  truncated: boolean;
}

const sensitiveNames = new Set(["authorization", "token", "secret", "password", "passwd", "cookie", "apikey"]);

function sensitiveKey(key: string): boolean {
  const normalized = key.replaceAll("-", "").replaceAll("_", "").toLocaleLowerCase();
  return sensitiveNames.has(normalized) || [...sensitiveNames].some((name) => normalized.endsWith(name));
}

function redactText(value: string, secrets: readonly string[], count: () => void): string {
  let result = value.replace(/Bearer\s+[^\s"']+/giu, () => { count(); return "Bearer [REDACTED]"; });
  result = result.replace(/((?:authorization|token|secret|password|passwd|cookie|api[-_]?key)\s*[:=]\s*["']?)[^,\s"'}]+/giu,
    (_match, prefix: string) => { count(); return `${prefix}[REDACTED]`; });
  result = result.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, () => { count(); return "[REDACTED]"; });
  for (const secret of secrets) {
    if (secret.length > 0 && result.includes(secret)) {
      const matches = result.split(secret).length - 1;
      for (let index = 0; index < matches; index += 1) count();
      result = result.replaceAll(secret, "[REDACTED]");
    }
  }
  return result;
}

export function sanitizeAuthoringValue(value: unknown, secrets: readonly string[] = []): AuthoringRedactionResult {
  let redactionCount = 0;
  let truncated = false;
  const count = () => { redactionCount += 1; };
  const visit = (item: unknown, depth: number): JsonValue => {
    if (depth > 50) { truncated = true; return "[TRUNCATED]"; }
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) ? item : "[INVALID_NUMBER]";
    if (typeof item === "string") return redactText(item, secrets, count);
    if (Array.isArray(item)) {
      if (item.length > 10_000) truncated = true;
      return item.slice(0, 10_000).map((child) => visit(child, depth + 1));
    }
    if (typeof item !== "object") return "[UNAVAILABLE]";
    const result = Object.create(null) as JsonObject;
    const entries = Object.entries(item as Record<string, unknown>);
    if (entries.length > 10_000) truncated = true;
    for (const [key, child] of entries.slice(0, 10_000)) {
      let sanitized: JsonValue;
      if (sensitiveKey(key)) { count(); sanitized = "[REDACTED]"; }
      else sanitized = visit(child, depth + 1);
      Object.defineProperty(result, key, { enumerable: true, configurable: true, writable: true,
        value: sanitized });
    }
    return result;
  };
  return { value: visit(value, 0), redactionCount, truncated };
}

export function boundAuthoringValue(value: JsonValue, maximumBytes: number): AuthoringRedactionResult {
  const json = JSON.stringify(value);
  const originalBytes = Buffer.byteLength(json, "utf8");
  if (originalBytes <= maximumBytes) return { value, redactionCount: 0, truncated: false };
  const previewLength = Math.max(0, Math.min(512, maximumBytes - 180));
  const descriptor: JsonValue = { truncated: true, originalBytes,
    sha256: createHash("sha256").update(json).digest("hex"),
    preview: Array.from(json).slice(0, previewLength).join("") };
  return { value: Buffer.byteLength(JSON.stringify(descriptor), "utf8") <= maximumBytes
    ? descriptor : "[TRUNCATED]", redactionCount: 0, truncated: true };
}

export function sanitizeAuthoringError(error: { code: string; message: string } | null,
  secrets: readonly string[] = []): { code: string; message: string } | null {
  if (error === null) return null;
  const code = /^[A-Z0-9_]{1,128}$/u.test(error.code) ? error.code : "CALL_FAILED";
  return { code, message: redactText(error.message, secrets, () => undefined).slice(0, 2_000) };
}
