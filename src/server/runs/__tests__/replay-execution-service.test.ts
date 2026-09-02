import { describe, expect, it, vi } from "vitest";
import type { ReplayPreflight, ReplayRequest } from "../../../shared/run-replay.js";
import {
  createReplayExecutionService,
  InvalidReplayError,
  ReplayConfirmationRequiredError,
  ReplayIdempotencyConflictError,
  ReplayStalePreflightError,
} from "../replay-execution-service.js";
import { RunIdempotencyConflictError, RunToolSnapshotChangedError } from "../run-service.js";
import type { RunSummary } from "../run-types.js";

const projectId = "00000000-0000-4000-8000-000000000821";
const sourceRunId = "00000000-0000-4000-8000-000000000822";
const connectionId = "00000000-0000-4000-8000-000000000823";
const snapshotId = "00000000-0000-4000-8000-000000000824";
const replayRunId = "00000000-0000-4000-8000-000000000825";
const digest = "d".repeat(64);
const preflight: ReplayPreflight = {
  projectId, sourceRunId, connectionId, toolName: "update_item", arguments: { id: "exact", nested: [1, 2] },
  sourceToolSnapshotId: snapshotId, sourceToolSnapshotHash: "a".repeat(64),
  currentToolSnapshotId: snapshotId, currentToolSnapshotHash: "a".repeat(64), annotations: {}, schemaChanges: [],
  sideEffectRisk: "UNKNOWN", blockers: [], requiredConfirmations: ["SIDE_EFFECT_RISK"], digest,
};
const request: ReplayRequest = {
  idempotencyKey: "replay-1", preflightDigest: digest,
  confirmSchemaDrift: false, confirmSideEffects: true,
};
const summary = {
  id: replayRunId, projectId, connectionId, tabId: null, toolName: "update_item", toolSnapshotId: snapshotId,
  idempotencyKey: "replay-1", status: "queued", createdAt: "2026-09-01T00:00:00.000Z", startedAt: null,
  completedAt: null, durationMs: null, networkDurationMs: null, pinned: false, replayedFromRunId: sourceRunId,
} satisfies RunSummary;

function fixture(overrides: { preflight?: ReplayPreflight; start?: () => RunSummary } = {}) {
  const inspect = vi.fn(() => structuredClone(overrides.preflight ?? preflight));
  const startReplayInvocation = vi.fn(overrides.start ?? (() => summary));
  return {
    service: createReplayExecutionService({ preflight: { inspect }, runs: { startReplayInvocation } }),
    inspect,
    startReplayInvocation,
  };
}

describe("replay execution service", () => {
  it("starts exactly one lineage-aware invocation from server-owned preflight values", () => {
    const { service, startReplayInvocation } = fixture();
    expect(service.start(projectId, sourceRunId, request)).toEqual(summary);
    expect(startReplayInvocation).toHaveBeenCalledWith({
      projectId, connectionId, toolName: "update_item", idempotencyKey: "replay-1",
      arguments: { id: "exact", nested: [1, 2] }, replayedFromRunId: sourceRunId,
      expectedToolSnapshotId: snapshotId,
    });
  });

  it("rejects invalid, stale, and unconfirmed requests before creating a Run", () => {
    const invalid = fixture();
    expect(() => invalid.service.start(projectId, sourceRunId, { ...request, preflightDigest: "bad" } as ReplayRequest))
      .toThrow(InvalidReplayError);
    expect(invalid.startReplayInvocation).not.toHaveBeenCalled();

    const stale = fixture();
    expect(() => stale.service.start(projectId, sourceRunId, { ...request, preflightDigest: "e".repeat(64) }))
      .toThrow(ReplayStalePreflightError);
    expect(stale.startReplayInvocation).not.toHaveBeenCalled();

    const confirmation = fixture();
    expect(() => confirmation.service.start(projectId, sourceRunId, { ...request, confirmSideEffects: false }))
      .toThrow(ReplayConfirmationRequiredError);
    expect(confirmation.startReplayInvocation).not.toHaveBeenCalled();
  });

  it("requires drift and side-effect confirmations independently", () => {
    const both = fixture({ preflight: { ...preflight, requiredConfirmations: ["SCHEMA_DRIFT", "SIDE_EFFECT_RISK"] } });
    expect(() => both.service.start(projectId, sourceRunId, { ...request, confirmSchemaDrift: false }))
      .toThrow(ReplayConfirmationRequiredError);
    expect(() => both.service.start(projectId, sourceRunId, { ...request, confirmSchemaDrift: true, confirmSideEffects: false }))
      .toThrow(ReplayConfirmationRequiredError);
    expect(both.startReplayInvocation).not.toHaveBeenCalled();
  });

  it("maps idempotency and catalog races to stable replay errors", () => {
    expect(() => fixture({ start: () => { throw new RunIdempotencyConflictError(); } })
      .service.start(projectId, sourceRunId, request)).toThrow(ReplayIdempotencyConflictError);
    expect(() => fixture({ start: () => { throw new RunToolSnapshotChangedError(); } })
      .service.start(projectId, sourceRunId, request)).toThrow(ReplayStalePreflightError);
  });
});
