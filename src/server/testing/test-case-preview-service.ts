import { z } from "zod";
import { buildTestCaseCreationPreview, type TestCaseCreationPreview } from "../../shared/testing/creation-preview.js";
import { RunNotFoundError, type RunServiceWithEvents } from "../runs/run-service.js";
import { SavedItemNotFoundError, type SavedItemService } from "../saved-items/saved-item-service.js";
import { ToolNotFoundError, type ToolService } from "../tools/tool-service.js";

const uuid = z.uuid();

export class TestCasePreviewSourceNotFoundError extends Error {
  constructor() { super("Test case preview source not found"); this.name = "TestCasePreviewSourceNotFoundError"; }
}

export interface TestCasePreviewService {
  fromRun(projectId: string, runId: string): TestCaseCreationPreview;
  fromSavedItem(projectId: string, savedItemId: string): TestCaseCreationPreview;
}

function validId(value: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new TestCasePreviewSourceNotFoundError();
  return parsed.data;
}

export function createTestCasePreviewService(deps: {
  runs: RunServiceWithEvents;
  savedItems: SavedItemService;
  tools: ToolService;
}): TestCasePreviewService {
  function toolState(projectId: string, connectionId: string, toolName: string, sourceHash?: string) {
    try {
      const detail = deps.tools.get(projectId, connectionId, toolName);
      return {
        status: detail.tool.status,
        definitionChanged: sourceHash !== undefined && detail.tool.currentSnapshot.contentHash !== sourceHash,
      };
    } catch (error) {
      if (error instanceof ToolNotFoundError) return { status: "removed" as const, definitionChanged: false };
      throw error;
    }
  }

  return {
    fromRun(rawProjectId, rawRunId) {
      const projectId = validId(rawProjectId); const runId = validId(rawRunId);
      try {
        const run = deps.runs.get(projectId, runId);
        const tool = toolState(projectId, run.connectionId, run.toolName, run.toolSnapshotHash);
        return buildTestCaseCreationPreview({
          source: { kind: "run", id: run.id }, connectionId: run.connectionId, toolName: run.toolName,
          name: `${run.toolName} baseline`, argumentsValue: run.request.arguments, baseline: run.response?.result,
          truncated: run.response?.truncated ?? false, toolStatus: tool.status, definitionChanged: tool.definitionChanged,
        });
      } catch (error) {
        if (error instanceof RunNotFoundError) throw new TestCasePreviewSourceNotFoundError();
        throw error;
      }
    },

    fromSavedItem(rawProjectId, rawSavedItemId) {
      const projectId = validId(rawProjectId); const savedItemId = validId(rawSavedItemId);
      try {
        const item = deps.savedItems.get(projectId, savedItemId);
        let sourceRun;
        if (item.sourceRunId !== null) {
          try { sourceRun = deps.runs.get(projectId, item.sourceRunId); }
          catch (error) { if (!(error instanceof RunNotFoundError)) throw error; }
        }
        const tool = toolState(projectId, item.connectionId, item.toolName, sourceRun?.toolSnapshotHash);
        return buildTestCaseCreationPreview({
          source: { kind: "saved-item", id: item.id }, connectionId: item.connectionId, toolName: item.toolName,
          name: item.name, argumentsValue: item.kind === "request" ? item.payload : sourceRun?.request.arguments ?? {},
          ...(item.kind === "response" ? { baseline: item.payload } : {}),
          truncated: item.kind === "response" && (sourceRun?.response?.truncated ?? false),
          toolStatus: tool.status, definitionChanged: tool.definitionChanged,
        });
      } catch (error) {
        if (error instanceof SavedItemNotFoundError) throw new TestCasePreviewSourceNotFoundError();
        throw error;
      }
    },
  };
}
