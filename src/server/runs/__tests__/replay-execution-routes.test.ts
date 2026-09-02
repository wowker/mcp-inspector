import { describe, expect, it } from "vitest";
import type { ReplayRequest } from "../../../shared/run-replay.js";
import {
  ReplayConfirmationRequiredError,
  ReplayIdempotencyConflictError,
  ReplayStalePreflightError,
  type ReplayExecutionService,
} from "../replay-execution-service.js";
import { createReplayExecutionRoutes } from "../replay-execution-routes.js";
import type { RunSummary } from "../run-types.js";

const projectId = "00000000-0000-4000-8000-000000000831";
const sourceRunId = "00000000-0000-4000-8000-000000000832";
const request: ReplayRequest = {
  idempotencyKey: "replay", preflightDigest: "d".repeat(64), confirmSchemaDrift: true, confirmSideEffects: true,
};
const run = {
  id: "00000000-0000-4000-8000-000000000833", projectId,
  connectionId: "00000000-0000-4000-8000-000000000834", tabId: null, toolName: "sum",
  toolSnapshotId: "00000000-0000-4000-8000-000000000835", idempotencyKey: "replay", status: "queued",
  createdAt: "2026-09-01T00:00:00.000Z", startedAt: null, completedAt: null, durationMs: null,
  networkDurationMs: null, pinned: false, replayedFromRunId: sourceRunId,
} satisfies RunSummary;

function app(start: ReplayExecutionService["start"]) {
  return createReplayExecutionRoutes({ start });
}

describe("replay execution routes", () => {
  it("accepts a strict replay request", async () => {
    const response = await app(() => run).request(`/${projectId}/runs/${sourceRunId}/replay`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ run });
  });

  it("returns stable validation, stale, confirmation, and idempotency errors", async () => {
    expect((await app(() => run).request(`/${projectId}/runs/not-a-run/replay`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    })).status).toBe(400);
    expect((await app(() => run).request(`/${projectId}/runs/${sourceRunId}/replay`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    })).status).toBe(400);
    const cases = [
      [new ReplayStalePreflightError(), 409, "REPLAY_STALE_PREFLIGHT"],
      [new ReplayConfirmationRequiredError(), 422, "REPLAY_CONFIRMATION_REQUIRED"],
      [new ReplayIdempotencyConflictError(), 409, "REPLAY_IDEMPOTENCY_CONFLICT"],
    ] as const;
    for (const [error, status, code] of cases) {
      const response = await app(() => { throw error; }).request(`/${projectId}/runs/${sourceRunId}/replay`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
      });
      expect(response.status).toBe(status);
      expect((await response.json() as { error: { code: string } }).error.code).toBe(code);
    }
  });
});
