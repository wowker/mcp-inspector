import { replayRequestSchema, type ReplayRequest } from "../../shared/run-replay.js";
import { RunIdempotencyConflictError, RunToolSnapshotChangedError, type RunServiceWithEvents } from "./run-service.js";
import type { RunSummary } from "./run-types.js";
import type { ReplayPreflightService } from "./replay-preflight-service.js";

export class InvalidReplayError extends Error {
  readonly code = "INVALID_REPLAY" as const;
  constructor() { super("Replay request is invalid"); this.name = "InvalidReplayError"; }
}
export class ReplayStalePreflightError extends Error {
  readonly code = "REPLAY_STALE_PREFLIGHT" as const;
  constructor() { super("Replay preflight is stale"); this.name = "ReplayStalePreflightError"; }
}
export class ReplayConfirmationRequiredError extends Error {
  readonly code = "REPLAY_CONFIRMATION_REQUIRED" as const;
  constructor() { super("Replay confirmation is required"); this.name = "ReplayConfirmationRequiredError"; }
}
export class ReplayIdempotencyConflictError extends Error {
  readonly code = "REPLAY_IDEMPOTENCY_CONFLICT" as const;
  constructor() { super("Replay idempotency conflict"); this.name = "ReplayIdempotencyConflictError"; }
}

export interface ReplayExecutionService {
  start(projectId: string, sourceRunId: string, request: ReplayRequest): RunSummary;
}

export function createReplayExecutionService(dependencies: {
  preflight: ReplayPreflightService;
  runs: Pick<RunServiceWithEvents, "startReplayInvocation">;
}): ReplayExecutionService {
  return {
    start(projectId, sourceRunId, request) {
      const parsed = replayRequestSchema.safeParse(request);
      if (!parsed.success) throw new InvalidReplayError();
      const preflight = dependencies.preflight.inspect(projectId, sourceRunId);
      if (preflight.digest !== parsed.data.preflightDigest) throw new ReplayStalePreflightError();
      if (preflight.requiredConfirmations.includes("SCHEMA_DRIFT") && !parsed.data.confirmSchemaDrift) {
        throw new ReplayConfirmationRequiredError();
      }
      if (preflight.requiredConfirmations.includes("SIDE_EFFECT_RISK") && !parsed.data.confirmSideEffects) {
        throw new ReplayConfirmationRequiredError();
      }
      try {
        return dependencies.runs.startReplayInvocation({
          projectId,
          connectionId: preflight.connectionId,
          toolName: preflight.toolName,
          idempotencyKey: parsed.data.idempotencyKey,
          arguments: preflight.arguments,
          replayedFromRunId: sourceRunId,
          expectedToolSnapshotId: preflight.currentToolSnapshotId,
        });
      } catch (error) {
        if (error instanceof RunIdempotencyConflictError) throw new ReplayIdempotencyConflictError();
        if (error instanceof RunToolSnapshotChangedError) {
          throw new ReplayStalePreflightError();
        }
        throw error;
      }
    },
  };
}
