import type { SchemaIssue } from "../../shared/json-schema.js";

export type RunStatus = "queued" | "connecting" | "authorizing" | "running" |
  "succeeded" | "failed" | "cancelled" | "interrupted";

export interface RunError { code: string; message: string }
export interface RunEvent {
  runId: string;
  sequence: number;
  kind: string;
  occurredAt: string;
  payload: unknown;
}
export interface RunSummary {
  id: string; projectId: string; connectionId: string; tabId: string | null;
  toolName: string; toolSnapshotId: string; idempotencyKey: string; status: RunStatus;
  createdAt: string; startedAt: string | null; completedAt: string | null;
  durationMs: number | null; networkDurationMs: number | null;
}
export interface RunDetail extends RunSummary {
  toolSnapshotHash: string;
  protocolVersion: string | null;
  serverInfo: Record<string, unknown> | null;
  clientInfo: Record<string, unknown>;
  request: { arguments: Record<string, unknown>; jsonrpc: unknown; http: unknown | null };
  response: { result: unknown | null; error: RunError | null; truncated: boolean; originalBytes: number | null } | null;
  events: RunEvent[];
}
export interface StartRunInput {
  projectId: string; tabId: string; idempotencyKey: string; arguments: Record<string, unknown>;
}
export interface RunPage { runs: RunSummary[]; nextCursor: string | null }
export interface RunService {
  start(input: StartRunInput): RunSummary;
  cancel(projectId: string, runId: string): boolean;
  list(projectId: string, cursor?: string, tabId?: string): RunPage;
  getSummary(projectId: string, runId: string): RunSummary;
  get(projectId: string, runId: string): RunDetail;
  events(projectId: string, runId: string, after?: number, limit?: number): RunEvent[];
}
export type { SchemaIssue };
