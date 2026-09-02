import { z } from "zod";
import {
  runComparisonSchema,
  type ComparisonRunMetadata,
  type ComparisonUnavailableReason,
  type RunComparison,
} from "../../shared/run-comparison.js";
import { jsonValueSchema, type JsonValue } from "../../shared/tool-definition.js";
import type { RunDetail, RunStatus, RunSummary } from "../runs/run-types.js";
import { RunNotFoundError, type RunServiceWithEvents } from "../runs/run-service.js";
import { normalizeComparisonExpressions, type ComparisonRuleService } from "./comparison-rule-service.js";
import { diffJsonValues } from "./structural-diff.js";

const uuid = z.string().uuid();
const activeStatuses = new Set<RunStatus>(["queued", "connecting", "authorizing", "running"]);

export class InvalidRunComparisonError extends Error {
  constructor() { super("Run comparison request is invalid"); this.name = "InvalidRunComparisonError"; }
}

export interface RunComparisonService {
  compare(projectId: string, replayRunId: string, preview?: unknown): RunComparison;
}

function metadata(summary: RunSummary, detail?: RunDetail): ComparisonRunMetadata {
  return {
    id: summary.id,
    connectionId: summary.connectionId,
    toolName: summary.toolName,
    toolSnapshotId: summary.toolSnapshotId,
    status: summary.status,
    error: detail?.response?.error ?? null,
    truncated: detail?.response?.truncated ?? null,
    originalBytes: detail?.response?.originalBytes ?? null,
  };
}

export function createRunComparisonService(dependencies: {
  runs: Pick<RunServiceWithEvents, "getSummary" | "get">;
  rules: ComparisonRuleService;
}): RunComparisonService {
  return {
    compare(rawProjectId, rawReplayRunId, preview) {
      const project = uuid.safeParse(rawProjectId);
      const replayId = uuid.safeParse(rawReplayRunId);
      if (!project.success || !replayId.success) throw new InvalidRunComparisonError();
      const ruleExpressions = preview === undefined
        ? dependencies.rules.list(project.data).rules.map(({ expression }) => expression)
        : normalizeComparisonExpressions(preview);
      const unavailable = (input: {
        reason: ComparisonUnavailableReason;
        sourceRunId?: string | null;
        source?: ComparisonRunMetadata | null;
        replay?: ComparisonRunMetadata | null;
      }): RunComparison => runComparisonSchema.parse({
        projectId: project.data,
        replayRunId: replayId.data,
        sourceRunId: input.sourceRunId ?? null,
        comparable: false,
        unavailableReason: input.reason,
        source: input.source ?? null,
        replay: input.replay ?? null,
        ruleExpressions,
        diff: null,
      });

      let replaySummary: RunSummary;
      try { replaySummary = dependencies.runs.getSummary(project.data, replayId.data); }
      catch (error) {
        if (error instanceof RunNotFoundError) return unavailable({ reason: "REPLAY_NOT_FOUND" });
        throw error;
      }
      const replayBase = metadata(replaySummary);
      if (replaySummary.replayedFromRunId === null) {
        return unavailable({ reason: "NOT_DIRECT_REPLAY", replay: replayBase });
      }
      const sourceRunId = replaySummary.replayedFromRunId;
      let sourceSummary: RunSummary;
      try { sourceSummary = dependencies.runs.getSummary(project.data, sourceRunId); }
      catch (error) {
        if (error instanceof RunNotFoundError) {
          return unavailable({ reason: "SOURCE_NOT_FOUND", sourceRunId, replay: replayBase });
        }
        throw error;
      }
      const sourceBase = metadata(sourceSummary);
      if (activeStatuses.has(replaySummary.status)) {
        return unavailable({ reason: "REPLAY_ACTIVE", sourceRunId, source: sourceBase, replay: replayBase });
      }
      if (activeStatuses.has(sourceSummary.status)) {
        return unavailable({ reason: "SOURCE_ACTIVE", sourceRunId, source: sourceBase, replay: replayBase });
      }

      let replayDetail: RunDetail;
      try { replayDetail = dependencies.runs.get(project.data, replayId.data); }
      catch { return unavailable({ reason: "REPLAY_RESPONSE_INVALID", sourceRunId, source: sourceBase, replay: replayBase }); }
      const replay = metadata(replaySummary, replayDetail);
      let sourceDetail: RunDetail;
      try { sourceDetail = dependencies.runs.get(project.data, sourceRunId); }
      catch { return unavailable({ reason: "SOURCE_RESPONSE_INVALID", sourceRunId, source: sourceBase, replay }); }
      const source = metadata(sourceSummary, sourceDetail);

      if (replaySummary.status !== "succeeded") {
        return unavailable({ reason: "REPLAY_NOT_SUCCEEDED", sourceRunId, source, replay });
      }
      if (sourceSummary.status !== "succeeded") {
        return unavailable({ reason: "SOURCE_NOT_SUCCEEDED", sourceRunId, source, replay });
      }
      if (replayDetail.response === null) {
        return unavailable({ reason: "REPLAY_RESPONSE_MISSING", sourceRunId, source, replay });
      }
      if (sourceDetail.response === null) {
        return unavailable({ reason: "SOURCE_RESPONSE_MISSING", sourceRunId, source, replay });
      }
      if (replayDetail.response.truncated) {
        return unavailable({ reason: "REPLAY_RESPONSE_TRUNCATED", sourceRunId, source, replay });
      }
      if (sourceDetail.response.truncated) {
        return unavailable({ reason: "SOURCE_RESPONSE_TRUNCATED", sourceRunId, source, replay });
      }
      const replayValue = jsonValueSchema.safeParse(replayDetail.response.result);
      if (!replayValue.success) {
        return unavailable({ reason: "REPLAY_RESPONSE_INVALID", sourceRunId, source, replay });
      }
      const sourceValue = jsonValueSchema.safeParse(sourceDetail.response.result);
      if (!sourceValue.success) {
        return unavailable({ reason: "SOURCE_RESPONSE_INVALID", sourceRunId, source, replay });
      }
      const diff = diffJsonValues(
        sourceValue.data as JsonValue,
        replayValue.data as JsonValue,
        ruleExpressions,
      );
      return runComparisonSchema.parse({
        projectId: project.data,
        replayRunId: replayId.data,
        sourceRunId,
        comparable: true,
        unavailableReason: null,
        source,
        replay,
        ruleExpressions,
        diff,
      });
    },
  };
}
