export const AUTHORING_PROTOCOL_VERSION = "1" as const;
export const AUTHORING_ENDPOINT_PATH = "/mcp/authoring" as const;

export interface AuthoringLimits {
  maxSessions: number;
  maxGlobalCalls: number;
  maxCallsPerConnection: number;
  maxExecutionsPerDraft: number;
  maxAppliesPerDraft: number;
  maxRequestBytes: number;
  maxStructuredResponseBytes: number;
  maxListItems: number;
}

export const AUTHORING_LIMITS: Readonly<AuthoringLimits> = Object.freeze({
  maxSessions: 8,
  maxGlobalCalls: 8,
  maxCallsPerConnection: 2,
  maxExecutionsPerDraft: 1,
  maxAppliesPerDraft: 1,
  maxRequestBytes: 2 * 1024 * 1024,
  maxStructuredResponseBytes: 1024 * 1024,
  maxListItems: 100,
});

export const AUTHORING_ASSET_TYPES = ["TOOL_TEST", "SCENARIO_TEST", "TEST_SUITE"] as const;

export interface AuthoringResponseMeta {
  requestId: string;
  protocolVersion: typeof AUTHORING_PROTOCOL_VERSION;
  warnings: string[];
}

export interface AuthoringSuccess<T> {
  [key: string]: unknown;
  ok: true;
  data: T;
  meta: AuthoringResponseMeta;
}

export type AuthoringErrorCategory =
  | "AUTHENTICATION" | "AUTHORIZATION" | "VALIDATION" | "NOT_FOUND"
  | "CONFLICT" | "RATE_LIMIT" | "CONNECTION" | "EXECUTION" | "INTERNAL";

export interface AuthoringFailure {
  [key: string]: unknown;
  ok: false;
  error: {
    code: string;
    category: AuthoringErrorCategory;
    message: string;
    retryable: boolean;
    resolution?: string;
  };
  meta: Omit<AuthoringResponseMeta, "warnings">;
}

export interface AuthoringCapabilities {
  appVersion: string;
  endpoint: string;
  assetTypes: typeof AUTHORING_ASSET_TYPES;
  permissionModes: readonly ["DISABLED", "READ_ONLY", "CUSTOM", "FULL_ACCESS"];
  features: {
    standaloneToolCalls: true;
    draftToolCalls: true;
    atomicApply: true;
    mandatoryRedaction: true;
  };
  limits: AuthoringLimits;
}
