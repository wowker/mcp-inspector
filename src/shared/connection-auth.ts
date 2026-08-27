export type ConnectionAuthMode = "none" | "bearer" | "oauth";

export const MAX_BEARER_TOKEN_LENGTH = 8_192;
const bearerTokenPattern = /^[A-Za-z0-9\-._~+/]+=*$/;

export function isValidBearerToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_BEARER_TOKEN_LENGTH && bearerTokenPattern.test(value);
}

export function isValidBearerTokenConfiguration(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_BEARER_TOKEN_LENGTH) return false;
  if (!value.includes("{{") && !value.includes("}}")) return isValidBearerToken(value);

  const withoutReferences = value.replace(/\{\{[A-Za-z_][A-Za-z0-9_.-]{0,127}\}\}/g, "TEMPLATE");
  return !withoutReferences.includes("{{") && !withoutReferences.includes("}}") &&
    bearerTokenPattern.test(withoutReferences);
}
