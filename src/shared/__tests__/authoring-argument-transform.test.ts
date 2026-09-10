import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { scenarioStepDefinitionSchema } from "../testing/test-case.js";

const connectionId = "00000000-0000-4000-8000-000000002001";
const step = {
  id: "create", name: "Create", target: { connectionId, toolName: "create_order" },
  fixedArguments: {}, mappings: [], extractors: [], assertions: [], condition: null,
  polling: null, onFailure: "STOP" as const,
};

describe("scenario argumentTransform contract", () => {
  it("normalizes legacy steps without a transform to null", () => {
    expect(scenarioStepDefinitionSchema.parse(step)).toMatchObject({ argumentTransform: null });
  });

  it("accepts a bounded transform and its SHA-256 source digest", () => {
    const source = "\n  export default ({ mappedArguments }) => ({ ...mappedArguments, ready: true });\n";
    const sourceDigest = createHash("sha256").update(source, "utf8").digest("hex");
    expect(scenarioStepDefinitionSchema.parse({ ...step, argumentTransform: { source, sourceDigest } }))
      .toMatchObject({ argumentTransform: { source, sourceDigest } });
  });

  it("rejects malformed digests and oversized sources", () => {
    expect(scenarioStepDefinitionSchema.safeParse({ ...step,
      argumentTransform: { source: "export default () => ({})", sourceDigest: "not-a-digest" } }).success).toBe(false);
    expect(scenarioStepDefinitionSchema.safeParse({ ...step,
      argumentTransform: { source: "x".repeat(2_097_153), sourceDigest: "a".repeat(64) } }).success).toBe(false);
  });
});
