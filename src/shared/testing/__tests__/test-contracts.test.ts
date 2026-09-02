import { describe, expect, it } from "vitest";
import {
  findScenarioStepDependents,
  parseTestCaseDefinition,
  testCaseDefinitionSchema,
  type ArgumentMapping,
  type ResponseExtractor,
} from "../test-case.js";
import { testExecutionDetailSchema, testExecutionSchema } from "../test-execution.js";
import { testSuiteDefinitionSchema } from "../test-suite.js";

const now = "2026-08-31T00:00:00.000Z";
const projectId = "00000000-0000-4000-8000-000000000801";
const connectionId = "00000000-0000-4000-8000-000000000802";

describe("automated testing shared contracts", () => {
  it("parses a strict Tool definition addressed only by connection identity", () => {
    const definition = parseTestCaseDefinition({
      id: "00000000-0000-4000-8000-000000000803",
      projectId,
      kind: "tool",
      name: "List stores",
      description: "Validates the active connection catalog.",
      tags: ["smoke"],
      revision: 1,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
      target: { connectionId, toolName: "list_stores" },
      arguments: {},
      assertions: [{
        id: "response-present",
        source: "MCP_RESULT",
        path: "$.structuredContent",
        operator: "EXISTS",
      }],
      timeoutMs: 10_000,
    });

    expect(definition.kind).toBe("tool");
    expect(definition.target.connectionId).toBe(connectionId);
    expect(testCaseDefinitionSchema.safeParse({
      ...definition,
      target: { ...definition.target, url: "https://example.test/mcp" },
    }).success).toBe(false);
    expect(testCaseDefinitionSchema.safeParse({
      ...definition,
      bearerToken: "must-not-be-stored",
    }).success).toBe(false);
  });

  it("parses bounded scenario, suite, and execution unions", () => {
    const assertion = {
      id: "status",
      source: "RUN" as const,
      path: "$.status",
      operator: "STATUS_IS" as const,
      expected: "succeeded",
    };
    const scenario = testCaseDefinitionSchema.parse({
      id: "00000000-0000-4000-8000-000000000804",
      projectId,
      kind: "scenario",
      name: "Create and inspect",
      description: "",
      tags: [],
      revision: 2,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
      inputs: [{ name: "storeId", description: "Store identity", isRequired: true }],
      steps: [{
        id: "create",
        name: "Create",
        target: { connectionId, toolName: "create_product" },
        fixedArguments: {},
        mappings: [{
          targetPath: "$.store_id",
          source: { kind: "SCENARIO_INPUT", name: "storeId" },
          isRequired: true,
        }],
        extractors: [],
        assertions: [assertion],
        condition: null,
        polling: null,
        onFailure: "STOP",
      }],
      cleanupSteps: [],
      assertions: [],
      failurePolicy: "STOP",
    });
    expect(scenario.kind).toBe("scenario");

    expect(testSuiteDefinitionSchema.parse({
      id: "00000000-0000-4000-8000-000000000805",
      projectId,
      name: "Smoke",
      description: "",
      tags: [],
      revision: 1,
      members: [{
        id: "00000000-0000-4000-8000-000000000806",
        testCaseId: scenario.id,
        position: 0,
        isEnabled: true,
      }],
      executionPolicy: { concurrency: 1, stopOnFailure: true },
      createdAt: now,
      updatedAt: now,
    }).executionPolicy.concurrency).toBe(1);

    const execution = testExecutionSchema.parse({
      id: "00000000-0000-4000-8000-000000000807",
      projectId,
      testCaseId: scenario.id,
      testCaseRevision: scenario.revision,
      status: "QUEUED",
      createdAt: now,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      error: null,
    });
    expect(execution.status).toBe("QUEUED");
    expect(testExecutionDetailSchema.parse({
      ...execution,
      definitionSnapshot: scenario,
      inputs: {},
      steps: [],
      assertions: [],
    }).definitionSnapshot.id).toBe(scenario.id);
  });

  it("rejects excessive definition collections and invalid execution policy", () => {
    const base = {
      id: "00000000-0000-4000-8000-000000000808",
      projectId,
      kind: "scenario" as const,
      name: "Too large",
      description: "",
      tags: [],
      revision: 1,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
      inputs: [],
      steps: [],
      cleanupSteps: [],
      assertions: [],
      failurePolicy: "STOP" as const,
    };
    expect(testCaseDefinitionSchema.safeParse({
      ...base,
      steps: Array.from({ length: 101 }, (_, index) => ({
        id: `step-${index}`,
        name: `Step ${index}`,
        target: { connectionId, toolName: "tool" },
        fixedArguments: {}, mappings: [], extractors: [], assertions: [],
        condition: null, polling: null, onFailure: "STOP",
      })),
    }).success).toBe(false);
    expect(testSuiteDefinitionSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000809",
      projectId,
      name: "Invalid",
      description: "",
      tags: [],
      revision: 1,
      members: [],
      executionPolicy: { concurrency: 9, stopOnFailure: false },
      createdAt: now,
      updatedAt: now,
    }).success).toBe(false);
  });

  it("rejects forward step references and unknown scenario data sources", () => {
    const step = (id: string, mappings: unknown[] = [], extractors: unknown[] = []) => ({
      id, name: id, target: { connectionId, toolName: id }, fixedArguments: {}, mappings, extractors,
      assertions: [], condition: null, polling: null, onFailure: "STOP",
    });
    const base = {
      id: "00000000-0000-4000-8000-000000000810", projectId, kind: "scenario" as const,
      name: "References", description: "", tags: [], revision: 1, isEnabled: true,
      createdAt: now, updatedAt: now, inputs: [{ name: "storeId", description: "", isRequired: true }],
      cleanupSteps: [], assertions: [], failurePolicy: "STOP" as const,
    };
    expect(testCaseDefinitionSchema.safeParse({ ...base, steps: [
      step("create", [{ targetPath: "$.id", source: { kind: "STEP_RESPONSE", stepId: "inspect", path: "$.id" }, isRequired: true }]),
      step("inspect"),
    ] }).success).toBe(false);
    expect(testCaseDefinitionSchema.safeParse({ ...base, steps: [
      step("create", [{ targetPath: "$.id", source: { kind: "SCENARIO_INPUT", name: "missing" }, isRequired: true }]),
    ] }).success).toBe(false);
    expect(testCaseDefinitionSchema.safeParse({ ...base, steps: [
      step("create"),
      step("inspect", [{ targetPath: "$.id", source: { kind: "VARIABLE", name: "taskId" }, isRequired: true }]),
    ] }).success).toBe(false);
  });

  it("allows only prior step and extracted-variable references and reports deletion dependents", () => {
    const step = (id: string, mappings: ArgumentMapping[] = [], extractors: ResponseExtractor[] = []) => ({
      id, name: id, target: { connectionId, toolName: id }, fixedArguments: {}, mappings, extractors,
      assertions: [], condition: null, polling: null, onFailure: "STOP" as const,
    });
    const steps = [
      step("create", [], [{ name: "taskId", source: "RESULT", path: "$.task_id", isRequired: true }]),
      step("inspect", [
        { targetPath: "$.fromResponse", source: { kind: "STEP_RESPONSE", stepId: "create", path: "$.task_id" }, isRequired: true },
        { targetPath: "$.fromVariable", source: { kind: "VARIABLE", name: "taskId" }, isRequired: true },
      ]),
    ];
    expect(testCaseDefinitionSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000811", projectId, kind: "scenario", name: "Valid",
      description: "", tags: [], revision: 1, isEnabled: true, createdAt: now, updatedAt: now,
      inputs: [], steps, cleanupSteps: [], assertions: [], failurePolicy: "STOP",
    }).success).toBe(true);
    expect(findScenarioStepDependents(steps, [], "create")).toEqual([{
      stepId: "inspect", stepName: "inspect", mappingTargetPath: "$.fromResponse",
    }]);
  });
});
