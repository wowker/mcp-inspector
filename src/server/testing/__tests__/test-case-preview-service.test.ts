import { describe, expect, it, vi } from "vitest";
import { createTestCasePreviewService } from "../test-case-preview-service.js";
import type { RunServiceWithEvents } from "../../runs/run-service.js";
import type { SavedItemService } from "../../saved-items/saved-item-service.js";
import type { ToolService } from "../../tools/tool-service.js";

const projectId = "00000000-0000-4000-8000-000000000201";
const runId = "00000000-0000-4000-8000-000000000202";
const connectionId = "00000000-0000-4000-8000-000000000203";

describe("test case preview service", () => {
  it("binds Run previews to the exact connection and warns when the Tool definition changed", () => {
    const service = createTestCasePreviewService({
      runs: { get: vi.fn().mockReturnValue({
        id: runId, projectId, connectionId, toolName: "read", toolSnapshotHash: "old",
        request: { arguments: { id: "42" } }, response: { result: { ok: true }, truncated: false },
      }) } as unknown as RunServiceWithEvents,
      savedItems: {} as SavedItemService,
      tools: { get: vi.fn().mockReturnValue({ tool: { status: "current", currentSnapshot: { contentHash: "new" } } }) } as unknown as ToolService,
    });
    const preview = service.fromRun(projectId, runId);
    expect(preview.definition.target).toEqual({ connectionId, toolName: "read" });
    expect(preview.warnings).toContain("TOOL_DEFINITION_CHANGED");
    expect(preview.definition.assertions[0]).toMatchObject({ operator: "DEEP_EQUALS", expected: { ok: true } });
  });
});
