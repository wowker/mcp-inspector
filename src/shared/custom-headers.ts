import type { ConnectionAuthMode } from "./connection-auth.js";

export const MAX_CUSTOM_HEADERS = 32;
export const MAX_CUSTOM_HEADER_VALUE_LENGTH = 8_192;
export const MAX_CUSTOM_HEADERS_BYTES = 32 * 1_024;

const headerNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const managedHeaders = new Set([
  "accept",
  "connection",
  "content-length",
  "content-type",
  "host",
  "last-event-id",
  "mcp-session-id",
  "origin",
  "proxy-authorization",
  "referer",
  "transfer-encoding",
  "upgrade",
]);

export function normalizeCustomHeaders(
  value: unknown,
  authMode: ConnectionAuthMode,
): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_CUSTOM_HEADERS) return null;
  const seen = new Set<string>();
  const normalized: Array<[string, string]> = [];
  for (const [name, headerValue] of entries) {
    const lowerName = name.toLowerCase();
    if (
      !headerNamePattern.test(name) || name.length > 256 ||
      managedHeaders.has(lowerName) ||
      (authMode !== "none" && lowerName === "authorization") ||
      seen.has(lowerName) ||
      typeof headerValue !== "string" ||
      headerValue.length > MAX_CUSTOM_HEADER_VALUE_LENGTH ||
      /[\r\n\0]/.test(headerValue)
    ) return null;
    seen.add(lowerName);
    normalized.push([name, headerValue]);
  }
  normalized.sort(([left], [right]) => left.toLowerCase().localeCompare(right.toLowerCase()));
  const result = Object.fromEntries(normalized);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_CUSTOM_HEADERS_BYTES) return null;
  return result;
}

export function isSensitiveHeaderName(name: string): boolean {
  const normalized = name.toLowerCase().replaceAll("_", "-");
  return normalized === "authorization" || normalized === "proxy-authorization" ||
    normalized === "cookie" || normalized === "set-cookie" ||
    normalized.includes("api-key") || normalized.includes("apikey") ||
    normalized.split("-").some((part) => part === "token" || part === "secret");
}
