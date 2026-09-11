import { describe, expect, it } from "vitest";
import { scenarioTestCaseMutationSchema } from "../test-case.js";

const connectionId = "00000000-0000-4000-8000-000000001902";

function step(id: string, extractor?: string) {
  return { id, name: id, target: { connectionId, toolName: id }, fixedArguments: {}, mappings: [],
    extractors: extractor === undefined ? [] : [{ name: extractor, source: "RESULT" as const,
      path: "$.value", isRequired: true }], assertions: [], condition: null, polling: null,
    argumentTransform: null, onFailure: "STOP" as const };
}

function scenario() {
  return { kind: "scenario" as const, name: "Dynamic expectation", description: "", tags: [], isEnabled: false,
    inputs: [], steps: [step("create", "createdId"), step("read")], cleanupSteps: [step("cleanup")],
    assertions: [], failurePolicy: "STOP" as const };
}

function dynamicAssertion(path: string) {
  return { id: "matches", source: "MCP_RESULT" as const, path: "$.id", operator: "EQUALS" as const,
    expectedSource: { source: "VARIABLE" as const, path } };
}

describe("Scenario dynamic expected operands", () => {
  it("accepts a variable extracted by an earlier main-flow step", () => {
    const definition = scenario();
    definition.steps[1]!.assertions = [dynamicAssertion("$.createdId") as never];

    expect(scenarioTestCaseMutationSchema.safeParse(definition).success).toBe(true);
  });

  it("rejects forward and missing variable references", () => {
    const forward = scenario();
    forward.steps[0]!.assertions = [dynamicAssertion("$.createdLater") as never];
    forward.steps[1]!.extractors = [{ name: "createdLater", source: "RESULT", path: "$.value", isRequired: true }];
    const missing = scenario();
    missing.steps[1]!.assertions = [dynamicAssertion("$.unknown") as never];

    for (const definition of [forward, missing]) {
      const parsed = scenarioTestCaseMutationSchema.safeParse(definition);
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues.map(({ message }) => message).join(" ")).toContain("previous main-flow step");
    }
  });

  it("rejects cleanup-to-main and cross-Scenario variable references", () => {
    const cleanupToMain = scenario();
    cleanupToMain.cleanupSteps[0]!.extractors = [{ name: "cleanupId", source: "RESULT", path: "$.value", isRequired: true }];
    cleanupToMain.assertions = [{ ...dynamicAssertion("$.cleanupId"), source: "VARIABLE", path: "$.createdId" } as never];
    const crossScenario = scenario();
    crossScenario.steps[1]!.assertions = [dynamicAssertion("$.fromAnotherScenario") as never];

    expect(scenarioTestCaseMutationSchema.safeParse(cleanupToMain).success).toBe(false);
    expect(scenarioTestCaseMutationSchema.safeParse(crossScenario).success).toBe(false);
  });
});
