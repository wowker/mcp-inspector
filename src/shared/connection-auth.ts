export type ConnectionAuthMode = "none" | "bearer" | "oauth";

export const MAX_BEARER_TOKEN_LENGTH = 8_192;
const bearerTokenPattern = /^[A-Za-z0-9\-._~+/]+=*$/;

export function isValidBearerToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_BEARER_TOKEN_LENGTH && bearerTokenPattern.test(value);
}
