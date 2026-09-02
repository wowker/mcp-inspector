import { describe, expect, it } from "vitest";
import {
  replayPreflightSchema,
  replayRequestSchema,
  runHistoryFilterSchema,
  runPinRequestSchema,
  runSummarySchema,
} from "../run-replay.js";

const uuid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

describe("run replay contracts", () => {
  it("requires pin and lineage fields on Run summaries", () => {
    const summary = {
      id: uuid(1), projectId: uuid(2), connectionId: uuid(3), tabId: null,
      toolName: "sum", toolSnapshotId: uuid(4), idempotencyKey: "intent-1", status: "succeeded",
      createdAt: "2026-09-01T00:00:00.000Z", startedAt: null, completedAt: null,
      durationMs: null, networkDurationMs: null, pinned: false, replayedFromRunId: null,
    };
    expect(runSummarySchema.parse(summary)).toEqual(summary);
    expect(runSummarySchema.safeParse(({ ...summary, pinned: undefined })).success).toBe(false);
    expect(runSummarySchema.safeParse(({ ...summary, replayedFromRunId: uuid(1) })).success).toBe(false);
  });

  it("normalizes bounded history filters and rejects ambiguous ranges", () => {
    expect(runHistoryFilterSchema.parse({ toolName: "sum", pinned: true, origin: "REPLAY", limit: 25 }))
      .toEqual({ toolName: "sum", pinned: true, origin: "REPLAY", limit: 25 });
    expect(runHistoryFilterSchema.safeParse({ toolName: " sum" }).success).toBe(false);
    expect(runHistoryFilterSchema.safeParse({
      createdFrom: "2026-09-02T00:00:00.000Z",
      createdTo: "2026-09-01T00:00:00.000Z",
    }).success).toBe(false);
    expect(runHistoryFilterSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it("keeps pin and replay requests strict", () => {
    expect(runPinRequestSchema.parse({ pinned: true })).toEqual({ pinned: true });
    expect(runPinRequestSchema.safeParse({ pinned: true, runId: uuid(1) }).success).toBe(false);
    expect(replayRequestSchema.parse({
      idempotencyKey: "replay-1", preflightDigest: "a".repeat(64),
      confirmSchemaDrift: false, confirmSideEffects: true,
    })).toEqual({
      idempotencyKey: "replay-1", preflightDigest: "a".repeat(64),
      confirmSchemaDrift: false, confirmSideEffects: true,
    });
  });

  it("requires a complete, project-fenced replay preflight", () => {
    const value = {
      projectId: uuid(1), sourceRunId: uuid(2), connectionId: uuid(3), toolName: "sum",
      arguments: { a: 1 }, sourceToolSnapshotId: uuid(4), sourceToolSnapshotHash: "a".repeat(64),
      currentToolSnapshotId: uuid(5), currentToolSnapshotHash: "b".repeat(64), annotations: {},
      schemaChanges: [], sideEffectRisk: "UNKNOWN", blockers: [],
      requiredConfirmations: ["SIDE_EFFECT_RISK"], digest: "c".repeat(64),
    };
    expect(replayPreflightSchema.parse(value)).toEqual(value);
    expect(replayPreflightSchema.safeParse({ ...value, connectionId: "https://example.test/mcp" }).success).toBe(false);
  });
});
