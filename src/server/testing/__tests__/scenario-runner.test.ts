import { describe, expect, it } from "vitest";
import type { ScenarioTestCaseDefinition } from "../../../shared/testing/test-case.js";
import { runScenario, type ScenarioInvocationResult } from "../scenario-runner.js";

const projectId = "00000000-0000-4000-8000-000000001901";
const connectionId = "00000000-0000-4000-8000-000000001902";
const now = "2026-09-01T00:00:00.000Z";

function definition(): ScenarioTestCaseDefinition {
  return { id: "00000000-0000-4000-8000-000000001903", projectId, kind: "scenario", name: "Order flow",
    description: "", tags: [], revision: 1, isEnabled: true, createdAt: now, updatedAt: now,
    inputs: [{ name: "storeId", description: "", isRequired: true }], assertions: [], failurePolicy: "STOP",
    steps: [{ id: "create", name: "Create", target: { connectionId, toolName: "create_order" },
      fixedArguments: {}, mappings: [{ targetPath: "$.store_id", source: { kind: "SCENARIO_INPUT", name: "storeId" }, isRequired: true }],
      extractors: [{ name: "orderId", source: "RESULT", path: "$.order_id", isRequired: true }], assertions: [], condition: null, polling: null, onFailure: "STOP" },
    { id: "inspect", name: "Inspect", target: { connectionId, toolName: "get_order" }, fixedArguments: {},
      mappings: [{ targetPath: "$.order_id", source: { kind: "VARIABLE", name: "orderId" }, isRequired: true }], extractors: [],
      assertions: [], condition: null, polling: { intervalMs: 250, maxAttempts: 3, timeoutMs: 1000,
        until: [{ id: "ready", source: "MCP_RESULT", path: "$.status", operator: "EQUALS", expected: "ready" }], failWhen: [] }, onFailure: "STOP" }],
    cleanupSteps: [{ id: "cleanup", name: "Cleanup", target: { connectionId, toolName: "delete_order" }, fixedArguments: {},
      mappings: [{ targetPath: "$.order_id", source: { kind: "STEP_RESPONSE", stepId: "create", path: "$.order_id" }, isRequired: true }],
      extractors: [], assertions: [], condition: null, polling: null, onFailure: "CONTINUE" }],
  };
}

describe("runScenario", () => {
  it("maps prior values, polls deterministically, and always runs cleanup without persisting variables", async () => {
    const calls: Array<{ toolName: string; argumentsValue: unknown; attempt: number }> = [];
    let inspectAttempt = 0;
    const invoke = async (input: { toolName: string; argumentsValue: Record<string, unknown>; attempt: number }): Promise<ScenarioInvocationResult> => {
      calls.push(input);
      if (input.toolName === "create_order") return { sources: { MCP_RESULT: { order_id: "o-1" } }, runId: "run-create", workflowExecutionId: null };
      if (input.toolName === "get_order") return { sources: { MCP_RESULT: { status: ++inspectAttempt === 1 ? "pending" : "ready" } }, runId: `run-inspect-${inspectAttempt}`, workflowExecutionId: null };
      return { sources: { MCP_RESULT: { deleted: true } }, runId: "run-cleanup", workflowExecutionId: null };
    };
    const result = await runScenario({ definition: definition(), inputs: { storeId: "s-1" } }, {
      invoke, wait: async () => undefined, resolveEnvironment: async () => undefined,
    });

    expect(result.status).toBe("PASSED");
    expect(calls.map(({ toolName, argumentsValue, attempt }) => ({ toolName, argumentsValue, attempt }))).toEqual([
      { toolName: "create_order", argumentsValue: { store_id: "s-1" }, attempt: 1 },
      { toolName: "get_order", argumentsValue: { order_id: "o-1" }, attempt: 1 },
      { toolName: "get_order", argumentsValue: { order_id: "o-1" }, attempt: 2 },
      { toolName: "delete_order", argumentsValue: { order_id: "o-1" }, attempt: 1 },
    ]);
    expect(result.steps.map(({ stepId, status, attempt }) => [stepId, status, attempt])).toEqual([
      ["create", "PASSED", 1], ["inspect", "FAILED", 1], ["inspect", "PASSED", 2], ["cleanup", "PASSED", 1],
    ]);
    expect(result.variables).toEqual({ orderId: "o-1" });
  });

  it("runs cleanup after a main-step error and reports the main failure", async () => {
    const invoked: string[] = [];
    const failedDefinition = definition();
    failedDefinition.cleanupSteps[0]!.mappings = [{
      targetPath: "$.order_id", source: { kind: "LITERAL", value: "fallback" }, isRequired: true,
    }];
    const result = await runScenario({ definition: failedDefinition, inputs: { storeId: "s-1" } }, {
      invoke: async ({ toolName }) => {
        invoked.push(toolName);
        if (toolName === "create_order") throw new Error("remote failure");
        return { sources: { MCP_RESULT: { deleted: true } }, runId: "cleanup-run", workflowExecutionId: null };
      }, wait: async () => undefined, resolveEnvironment: async () => undefined,
    });
    expect(result.status).toBe("ERROR");
    expect(result.error).toEqual({ code: "TEST_EXECUTION_FAILED", message: "Scenario step execution failed" });
    expect(invoked).toEqual(["create_order", "delete_order"]);
    expect(result.steps.at(-1)).toMatchObject({ stepId: "cleanup", status: "PASSED" });
  });

  it("preserves a safe Tool invocation reason on the failed step and scenario", async () => {
    const scenario = definition();
    scenario.steps = [scenario.steps[0]!];
    scenario.steps[0]!.extractors = [];
    scenario.cleanupSteps = [];
    const result = await runScenario({ definition: scenario, inputs: { storeId: "s-1" } }, {
      invoke: async () => ({
        sources: {}, runId: "failed-run", workflowExecutionId: null, succeeded: false,
        error: { code: "MCP_CONNECT_FAILED", message: "Unable to connect to MCP server" },
      }),
      wait: async () => undefined,
      resolveEnvironment: async () => undefined,
    });

    expect(result).toMatchObject({
      status: "FAILED",
      error: { code: "MCP_CONNECT_FAILED", message: "Unable to connect to MCP server" },
      steps: [{ status: "FAILED", error: { code: "MCP_CONNECT_FAILED" }, runId: "failed-run" }],
    });
  });

  it("evaluates scenario assertions from execution-scoped variables", async () => {
    const scenario = definition();
    scenario.steps = [scenario.steps[0]!];
    scenario.cleanupSteps = [];
    scenario.assertions = [{ id: "order", source: "VARIABLE", path: "$.orderId", operator: "EQUALS", expected: "o-1" }];
    const result = await runScenario({ definition: scenario, inputs: { storeId: "s-1" } }, {
      invoke: async () => ({ sources: { MCP_RESULT: { order_id: "o-1" } }, runId: "run", workflowExecutionId: null }),
      wait: async () => undefined, resolveEnvironment: async () => undefined,
      createId: () => "00000000-0000-4000-8000-000000001999",
    });
    expect(result.status).toBe("PASSED");
    expect(result.assertions).toMatchObject([{ assertionId: "order", status: "PASSED", actual: "o-1" }]);
  });

  it("rejects prototype mapping paths without mutating object prototypes", async () => {
    const scenario = definition();
    scenario.steps[0]!.mappings[0]!.targetPath = "$.__proto__.polluted";
    scenario.cleanupSteps = [];
    const result = await runScenario({ definition: scenario, inputs: { storeId: "s-1" } }, {
      invoke: async () => { throw new Error("must not invoke"); },
      wait: async () => undefined, resolveEnvironment: async () => undefined,
    });
    expect(result).toMatchObject({ status: "ERROR", error: { code: "INVALID_JSON_PATH" } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("extracts before assertions and lets CONTINUE feed a later step while preserving failure", async () => {
    const scenario = definition();
    scenario.failurePolicy = "CONTINUE";
    scenario.cleanupSteps = [];
    scenario.steps[0]!.assertions = [{ id: "forced-failure", source: "MCP_RESULT", path: "$.ok", operator: "EQUALS", expected: true }];
    scenario.steps[0]!.onFailure = "CONTINUE";
    scenario.steps[1]!.polling = null;
    const calls: string[] = [];
    const result = await runScenario({ definition: scenario, inputs: { storeId: "s-1" } }, {
      invoke: async ({ toolName, argumentsValue }): Promise<ScenarioInvocationResult> => {
        calls.push(`${toolName}:${JSON.stringify(argumentsValue)}`);
        if (toolName === "create_order") {
          return { sources: { MCP_RESULT: { order_id: "o-1", ok: false } }, runId: "create", workflowExecutionId: null };
        }
        return { sources: { MCP_RESULT: { status: "ready" } }, runId: "inspect", workflowExecutionId: null };
      },
      wait: async () => undefined, resolveEnvironment: async () => undefined,
    });
    expect(result.status).toBe("FAILED");
    expect(calls).toEqual(["create_order:{\"store_id\":\"s-1\"}", "get_order:{\"order_id\":\"o-1\"}"]);
  });
});
