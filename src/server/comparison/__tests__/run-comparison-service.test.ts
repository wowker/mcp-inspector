import { describe, expect, it } from "vitest";
import type { RunDetail, RunSummary } from "../../runs/run-types.js";
import { RunNotFoundError } from "../../runs/run-service.js";
import { createRunComparisonService } from "../run-comparison-service.js";

const projectId = "00000000-0000-4000-8000-000000001541";
const sourceId = "00000000-0000-4000-8000-000000001542";
const replayId = "00000000-0000-4000-8000-000000001543";
const connectionId = "00000000-0000-4000-8000-000000001544";
const sourceSnapshotId = "00000000-0000-4000-8000-000000001545";
const replaySnapshotId = "00000000-0000-4000-8000-000000001546";

function summary(id: string, patch: Partial<RunSummary> = {}): RunSummary {
  return {
    id, projectId, connectionId, tabId: null, toolName: "sum",
    toolSnapshotId: id === sourceId ? sourceSnapshotId : replaySnapshotId,
    idempotencyKey: id, status: "succeeded", createdAt: "2026-09-01T00:00:00.000Z",
    startedAt: "2026-09-01T00:00:00.010Z", completedAt: "2026-09-01T00:00:00.020Z",
    durationMs: 10, networkDurationMs: 8, pinned: false,
    replayedFromRunId: id === replayId ? sourceId : null,
    ...patch,
  };
}

function detail(run: RunSummary, result: unknown, patch: Partial<RunDetail> = {}): RunDetail {
  return {
    ...run, toolSnapshotHash: "a".repeat(64), protocolVersion: null, serverInfo: null,
    clientInfo: {}, request: { arguments: {}, jsonrpc: {}, http: null },
    response: { result, error: null, truncated: false, originalBytes: 100 }, events: [], ...patch,
  };
}

function fixture(input: {
  source?: RunSummary;
  replay?: RunSummary;
  sourceDetail?: RunDetail | Error;
  replayDetail?: RunDetail | Error;
} = {}) {
  const source = input.source ?? summary(sourceId);
  const replay = input.replay ?? summary(replayId);
  const summaries = new Map([[source.id, source], [replay.id, replay]]);
  const details = new Map<string, RunDetail | Error>([
    [source.id, input.sourceDetail ?? detail(source, { requestId: "old", rows: [{ value: 1 }] })],
    [replay.id, input.replayDetail ?? detail(replay, { requestId: "new", rows: [{ value: 2 }] })],
  ]);
  const rules = [{ id: "00000000-0000-4000-8000-000000001547", projectId,
    expression: '$["requestId"]', position: 0, createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z" }];
  return createRunComparisonService({
    runs: {
      getSummary(requestProjectId, id) {
        const value = requestProjectId === projectId ? summaries.get(id) : undefined;
        if (value === undefined) throw new RunNotFoundError();
        return value;
      },
      get(requestProjectId, id) {
        const value = requestProjectId === projectId ? details.get(id) : undefined;
        if (value === undefined) throw new RunNotFoundError();
        if (value instanceof Error) throw value;
        return value;
      },
    },
    rules: { list: () => ({ rules }), replace: () => ({ rules }) },
  });
}

describe("run comparison service", () => {
  it("loads both server-owned responses, applies the rule snapshot, and returns a bounded diff", () => {
    const comparison = fixture().compare(projectId, replayId);
    expect(comparison).toMatchObject({
      projectId, sourceRunId: sourceId, replayRunId: replayId, comparable: true,
      unavailableReason: null, ruleExpressions: ['$["requestId"]'],
    });
    expect(comparison.diff?.changes).toEqual([
      { path: "/requestId", kind: "CHANGED", source: "old", replay: "new", ignored: true },
      { path: "/rows/0/value", kind: "CHANGED", source: 1, replay: 2, ignored: false },
    ]);
  });

  it("previews a normalized transient rule set without saving it", () => {
    const service = fixture();
    const comparison = service.compare(projectId, replayId, { expressions: ["$.rows[*].value"] });
    expect(comparison.ruleExpressions).toEqual(['$["rows"][*]["value"]']);
    expect(comparison.diff?.changes.find(({ path }) => path === "/rows/0/value")?.ignored).toBe(true);
  });

  it("rejects unrelated Runs and reports active, failed, truncated, and corrupt inputs explicitly", () => {
    expect(fixture({ replay: summary(replayId, { replayedFromRunId: null }) }).compare(projectId, replayId))
      .toMatchObject({ comparable: false, unavailableReason: "NOT_DIRECT_REPLAY" });
    expect(fixture({ replay: summary(replayId, { status: "running", completedAt: null }) }).compare(projectId, replayId))
      .toMatchObject({ comparable: false, unavailableReason: "REPLAY_ACTIVE" });
    const failed = summary(sourceId, { status: "failed" });
    expect(fixture({ source: failed, sourceDetail: detail(failed, null, { response: {
      result: null, error: { code: "FAILED", message: "failed" }, truncated: false, originalBytes: 0,
    } }) }).compare(projectId, replayId)).toMatchObject({
      comparable: false, unavailableReason: "SOURCE_NOT_SUCCEEDED",
      source: { error: { code: "FAILED", message: "failed" } },
    });
    const truncatedReplay = summary(replayId);
    expect(fixture({ replay: truncatedReplay, replayDetail: detail(truncatedReplay, {}, { response: {
      result: {}, error: null, truncated: true, originalBytes: 5_000_000,
    } }) }).compare(projectId, replayId)).toMatchObject({
      comparable: false, unavailableReason: "REPLAY_RESPONSE_TRUNCATED",
    });
    expect(fixture({ sourceDetail: new Error("corrupt secret payload") }).compare(projectId, replayId))
      .toMatchObject({ comparable: false, unavailableReason: "SOURCE_RESPONSE_INVALID" });
  });
});
