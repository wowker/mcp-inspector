import { describe, expect, it } from "vitest";
import { buildTestCaseCreationPreview } from "../creation-preview.js";

describe("test case creation preview", () => {
  it("omits secret-shaped values and refuses truncated baselines", () => {
    const preview = buildTestCaseCreationPreview({
      source: { kind: "run", id: "00000000-0000-4000-8000-000000000001" },
      connectionId: "00000000-0000-4000-8000-000000000002", toolName: "read", name: "read baseline",
      argumentsValue: { id: "42", api_token: "secret" }, baseline: { ok: true }, truncated: true, toolStatus: "current",
    });
    expect(preview.definition.arguments).toEqual({ id: "42" });
    expect(preview.definition.assertions).toEqual([]);
    expect(preview.warnings).toEqual(expect.arrayContaining(["SECRET_OMITTED", "RESPONSE_TRUNCATED", "BASELINE_UNAVAILABLE"]));
    expect(preview.requiresConfirmation).toBe(true);
  });
});
