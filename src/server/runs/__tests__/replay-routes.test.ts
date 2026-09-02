import { describe, expect, it, vi } from "vitest";
import type { ReplayPreflight } from "../../../shared/run-replay.js";
import {
  ReplayConnectionUnavailableError,
  ReplaySourceUnavailableError,
  ReplayToolUnavailableError,
  type ReplayPreflightService,
} from "../replay-preflight-service.js";
import { createReplayPreflightRoutes } from "../replay-routes.js";

const projectId = "00000000-0000-4000-8000-000000000811";
const runId = "00000000-0000-4000-8000-000000000812";
const connectionId = "00000000-0000-4000-8000-000000000813";
const snapshotId = "00000000-0000-4000-8000-000000000814";
const preflight: ReplayPreflight = {
  projectId, sourceRunId: runId, connectionId, toolName: "read_item", arguments: { id: "1" },
  sourceToolSnapshotId: snapshotId, sourceToolSnapshotHash: "a".repeat(64),
  currentToolSnapshotId: snapshotId, currentToolSnapshotHash: "a".repeat(64), annotations: { readOnlyHint: true },
  schemaChanges: [], sideEffectRisk: "SAFE", blockers: [], requiredConfirmations: [], digest: "b".repeat(64),
};

function app(inspect: ReplayPreflightService["inspect"]) {
  return createReplayPreflightRoutes({ inspect });
}

describe("replay preflight routes", () => {
  it("returns the project-scoped read-only preflight", async () => {
    const inspect = vi.fn(() => preflight);
    const response = await app(inspect).request(`/${projectId}/runs/${runId}/replay-preflight`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preflight });
    expect(inspect).toHaveBeenCalledWith(projectId, runId);
  });

  it("returns stable invalid, source, connection, and Tool errors", async () => {
    expect((await app(() => preflight).request(`/${projectId}/runs/not-a-run/replay-preflight`)).status).toBe(400);
    const source = await app(() => { throw new ReplaySourceUnavailableError(); })
      .request(`/${projectId}/runs/${runId}/replay-preflight`);
    expect(source.status).toBe(404);
    expect(await source.json()).toEqual({ error: { code: "RUN_NOT_FOUND", message: "Source Run or Tool snapshot is unavailable" } });
    for (const error of [new ReplayConnectionUnavailableError(), new ReplayToolUnavailableError()]) {
      const response = await app(() => { throw error; }).request(`/${projectId}/runs/${runId}/replay-preflight`);
      expect(response.status).toBe(409);
      expect((await response.json() as { error: { code: string } }).error.code).toBe("REPLAY_BLOCKED");
    }
  });
});
