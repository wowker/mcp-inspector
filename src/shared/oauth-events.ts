export const OAUTH_CHANNEL = "dsers-inspector-oauth";

export interface OAuthCompleteEvent {
  type: "oauth-complete";
  connectionId: string;
}

export interface OAuthReadyEvent {
  type: "oauth-ready";
  connectionId: string;
}

export function isOAuthCompleteEvent(value: unknown): value is OAuthCompleteEvent {
  return typeof value === "object" && value !== null &&
    (value as Record<string, unknown>).type === "oauth-complete" &&
    typeof (value as Record<string, unknown>).connectionId === "string";
}
