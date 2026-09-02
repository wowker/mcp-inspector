import type { SchemaIssue } from "../../shared/json-schema.js";
import type {
  RunDetail,
  RunError,
  RunEvent,
  RunHistoryFilter,
  RunStatus,
  RunSummary,
} from "../../shared/run-replay.js";

export type { RunDetail, RunError, RunEvent, RunStatus, RunSummary } from "../../shared/run-replay.js";
export interface StartRunInput {
  projectId: string; connectionId?: string; tabId: string; idempotencyKey: string; arguments: Record<string, unknown>;
}
export interface StartReplayInvocationInput {
  projectId: string;
  connectionId: string;
  toolName: string;
  idempotencyKey: string;
  arguments: Record<string, unknown>;
  replayedFromRunId: string;
  expectedToolSnapshotId: string;
}
export interface RunPage { runs: RunSummary[]; nextCursor: string | null }
export type RunListFilter = RunHistoryFilter;
export interface RunService {
  start(input: StartRunInput): RunSummary;
  cancel(projectId: string, runId: string): boolean;
  list(projectId: string, cursor?: string, filter?: RunListFilter): RunPage;
  setPinned(projectId: string, runId: string, pinned: boolean): RunSummary;
  getSummary(projectId: string, runId: string): RunSummary;
  get(projectId: string, runId: string): RunDetail;
  events(projectId: string, runId: string, after?: number, limit?: number): RunEvent[];
}
export type { SchemaIssue };
