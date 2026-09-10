import { randomUUID } from "node:crypto";

export type AuthoringAuditEventType =
  | "CALL"
  | "SERVICE_ENABLED"
  | "TOKEN_ROTATED"
  | "SERVICE_DISABLED"
  | "AUTHENTICATION_REJECTED"
  | "ORIGIN_REJECTED"
  | "POLICY_CHANGED";

export interface AuthoringAuditEvent {
  eventType: AuthoringAuditEventType;
  requestId: string;
  callId: string | null;
  runId: string | null;
  projectId: string | null;
  connectionId: string | null;
  toolName: string | null;
  policyDecision: string | null;
  status: string;
  durationMs: number | null;
  errorCode: string | null;
  redactionCount: number;
  truncated: boolean;
}

export type AuthoringAuditWriter = (event: AuthoringAuditEvent) => void;

export function authoringControlAudit(eventType: Exclude<AuthoringAuditEventType, "CALL">,
  status: string, options: Partial<Pick<AuthoringAuditEvent,
    "requestId" | "projectId" | "connectionId" | "policyDecision" | "errorCode">> = {}): AuthoringAuditEvent {
  return { eventType, requestId: options.requestId ?? randomUUID(), callId: null, runId: null,
    projectId: options.projectId ?? null, connectionId: options.connectionId ?? null, toolName: null,
    policyDecision: options.policyDecision ?? null, status, durationMs: 0,
    errorCode: options.errorCode ?? null, redactionCount: 0, truncated: false };
}
