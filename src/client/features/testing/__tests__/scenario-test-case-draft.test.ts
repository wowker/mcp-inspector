import { describe, expect, it } from "vitest";
import type { ScenarioTestCaseDefinition } from "../../../../shared/testing/test-case.js";
import {
  addScenarioStep,
  draftFromScenarioDefinition,
  moveScenarioStep,
  newScenarioTestCaseDraft,
  removeScenarioStep,
  scenarioDraftIssues,
  scenarioMutationFromDraft,
} from "../scenario-test-case-draft.js";

const projectId = "00000000-0000-4000-8000-000000001801";
const connectionId = "00000000-0000-4000-8000-000000001802";
const now = "2026-09-01T00:00:00.000Z";

describe("scenario test case draft", () => {
  it("keeps stable step IDs while reordering and produces a valid mutation", () => {
    let draft = newScenarioTestCaseDraft();
    draft = { ...draft, name: "Order flow", inputs: [{ name: "storeId", description: "", isRequired: true }] };
    draft = addScenarioStep(draft, "main", "create");
    draft = addScenarioStep(draft, "main", "inspect");
    draft.steps[0] = { ...draft.steps[0]!, name: "Create", connectionId, toolName: "create_order" };
    draft.steps[1] = { ...draft.steps[1]!, name: "Inspect", connectionId, toolName: "get_order",
      mappings: [{ targetPath: "$.order_id", source: { kind: "STEP_RESPONSE", stepId: "create", path: "$.order_id" }, isRequired: true }] };
    const moved = moveScenarioStep(draft, "main", 1, -1);
    expect(moved.steps.map(({ id }) => id)).toEqual(["inspect", "create"]);
    expect(scenarioMutationFromDraft(draft)).toMatchObject({ ok: true, value: {
      kind: "scenario", name: "Order flow", steps: [{ id: "create" }, { id: "inspect" }],
    } });
  });

  it("blocks deleting a referenced step and lists the dependent mapping", () => {
    let draft = newScenarioTestCaseDraft();
    draft = addScenarioStep(draft, "main", "create");
    draft = addScenarioStep(draft, "main", "inspect");
    draft.steps[1] = { ...draft.steps[1]!, mappings: [{
      targetPath: "$.id", source: { kind: "STEP_RESPONSE", stepId: "create", path: "$.id" }, isRequired: true,
    }] };
    expect(removeScenarioStep(draft, "main", "create")).toEqual({ ok: false, dependents: [{
      stepId: "inspect", stepName: "Step 2", mappingTargetPath: "$.id",
    }] });
  });

  it("round-trips a stored scenario without changing stable identities", () => {
    const definition: ScenarioTestCaseDefinition = {
      id: "00000000-0000-4000-8000-000000001803", projectId, kind: "scenario", name: "Cleanup",
      description: "", tags: [], revision: 3, isEnabled: true, createdAt: now, updatedAt: now,
      inputs: [], steps: [{ id: "create", name: "Create", target: { connectionId, toolName: "create" },
        fixedArguments: {}, mappings: [], extractors: [], assertions: [], condition: null, polling: null, onFailure: "STOP" }],
      cleanupSteps: [{ id: "cleanup", name: "Cleanup", target: { connectionId, toolName: "remove" },
        fixedArguments: {}, mappings: [], extractors: [], assertions: [], condition: null, polling: null, onFailure: "CONTINUE" }],
      assertions: [], failurePolicy: "STOP",
    };
    const draft = draftFromScenarioDefinition(definition);
    expect(draft.steps[0]?.id).toBe("create");
    expect(draft.cleanupSteps[0]?.id).toBe("cleanup");
    expect(scenarioMutationFromDraft(draft)).toEqual({ ok: true, value: expect.objectContaining({
      steps: definition.steps, cleanupSteps: definition.cleanupSteps,
    }) });
  });

  it("reports invalid literal JSON and forward references before save", () => {
    let draft = { ...newScenarioTestCaseDraft(), name: "Flow" };
    draft = addScenarioStep(draft, "main", "first");
    draft = addScenarioStep(draft, "main", "second");
    draft.steps[0] = { ...draft.steps[0]!, name: "First", connectionId, toolName: "first", mappings: [{
      targetPath: "$.payload", source: { kind: "LITERAL", value: null }, literalText: "{", isRequired: true,
    }] };
    expect(scenarioDraftIssues(draft)).toContain("Invalid JSON literal");
    draft.steps[0] = { ...draft.steps[0]!, mappings: [{ targetPath: "$.id",
      source: { kind: "STEP_RESPONSE", stepId: "second", path: "$.id" }, isRequired: true }] };
    draft.steps[1] = { ...draft.steps[1]!, name: "Second", connectionId, toolName: "second" };
    expect(scenarioDraftIssues(draft)).toContain("Step 'second' must precede 'first'");
  });
});
