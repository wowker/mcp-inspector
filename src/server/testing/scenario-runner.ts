import { evaluateAssertion, type AssertionContext } from "../../shared/testing/assertion-engine.js";
import type { AssertionDefinition, AssertionResult } from "../../shared/testing/assertions.js";
import type {
  ScenarioStepDefinition,
  ScenarioTestCaseDefinition,
  ValueSource,
} from "../../shared/testing/test-case.js";
import type { JsonObject, JsonValue } from "../../shared/tool-definition.js";
import type { ScenarioStepStatus, TestExecutionStatus } from "../../shared/testing/test-execution.js";

const forbiddenPathSegments = new Set(["__proto__", "prototype", "constructor"]);
const maxPathSegments = 128;

interface ResolvedValue {
  exists: boolean;
  value?: JsonValue;
}

export interface ScenarioError {
  code: string;
  message: string;
}

export interface ScenarioInvocationInput {
  connectionId: string;
  toolName: string;
  argumentsValue: JsonObject;
  stepId: string;
  position: number;
  attempt: number;
  phase: "main" | "cleanup";
  signal?: AbortSignal;
}

export interface ScenarioInvocationResult {
  sources: AssertionContext["sources"];
  redactedSources?: ReadonlySet<AssertionDefinition["source"]>;
  runId: string;
  workflowExecutionId: string | null;
  succeeded?: boolean;
  error?: ScenarioError;
}

export interface ScenarioRunStepResult {
  stepId: string;
  position: number;
  attempt: number;
  status: Extract<ScenarioStepStatus, "PASSED" | "FAILED" | "ERROR" | "SKIPPED" | "CANCELLED">;
  argumentsValue: JsonObject | null;
  runId: string | null;
  workflowExecutionId: string | null;
  assertions: AssertionResult[];
  error: ScenarioError | null;
}

export interface ScenarioRunResult {
  status: Extract<TestExecutionStatus, "PASSED" | "FAILED" | "ERROR" | "CANCELLED">;
  steps: ScenarioRunStepResult[];
  variables: JsonObject;
  assertions: AssertionResult[];
  error: ScenarioError | null;
}

export interface ScenarioRunnerDependencies {
  invoke(input: ScenarioInvocationInput): Promise<ScenarioInvocationResult>;
  wait(milliseconds: number, signal?: AbortSignal): Promise<void>;
  resolveEnvironment(
    scope: "PROJECT" | "SERVER",
    connectionId: string,
    name: string,
  ): Promise<JsonValue | undefined>;
  createId?: () => string;
  now?: () => number;
}

export interface RunScenarioInput {
  definition: ScenarioTestCaseDefinition;
  inputs: JsonObject;
  signal?: AbortSignal;
}

export class ScenarioRunnerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function cloneJson<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

function parsePath(path: string): Array<string | number> {
  if (path === "" || path === "$") return [];
  if (!path.startsWith("$")) throw new ScenarioRunnerError("INVALID_JSON_PATH", "JSON path must start with $");
  const segments: Array<string | number> = [];
  let cursor = 1;
  const push = (segment: string | number) => {
    if (typeof segment === "string" && forbiddenPathSegments.has(segment)) {
      throw new ScenarioRunnerError("INVALID_JSON_PATH", "JSON path contains a forbidden property");
    }
    segments.push(segment);
    if (segments.length > maxPathSegments) {
      throw new ScenarioRunnerError("INVALID_JSON_PATH", "JSON path is too deep");
    }
  };
  while (cursor < path.length) {
    if (path[cursor] === ".") {
      cursor += 1;
      const start = cursor;
      while (cursor < path.length && path[cursor] !== "." && path[cursor] !== "[") cursor += 1;
      const property = path.slice(start, cursor);
      if (property.length === 0) throw new ScenarioRunnerError("INVALID_JSON_PATH", "JSON path has an empty property");
      push(property);
      continue;
    }
    if (path[cursor] === "[") {
      const close = path.indexOf("]", cursor + 1);
      if (close === -1) throw new ScenarioRunnerError("INVALID_JSON_PATH", "JSON path has an unclosed bracket");
      const token = path.slice(cursor + 1, close).trim();
      if (/^(?:0|[1-9]\d*)$/.test(token)) {
        push(Number(token));
      } else if ((token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))) {
        let property: string;
        try {
          property = token[0] === '"'
            ? JSON.parse(token) as string
            : token.slice(1, -1).replaceAll("\\'", "'").replaceAll("\\\\", "\\");
        } catch {
          throw new ScenarioRunnerError("INVALID_JSON_PATH", "JSON path has an invalid quoted property");
        }
        push(property);
      } else {
        throw new ScenarioRunnerError("INVALID_JSON_PATH", "JSON path bracket is invalid");
      }
      cursor = close + 1;
      continue;
    }
    throw new ScenarioRunnerError("INVALID_JSON_PATH", "JSON path syntax is invalid");
  }
  return segments;
}

function resolvePath(source: JsonValue | undefined, path: string): ResolvedValue {
  if (source === undefined) return { exists: false };
  let current: JsonValue = source;
  for (const segment of parsePath(path)) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) return { exists: false };
      current = current[segment]!;
    } else {
      if (current === null || Array.isArray(current) || typeof current !== "object" ||
        !Object.prototype.hasOwnProperty.call(current, segment)) return { exists: false };
      current = current[segment]!;
    }
  }
  return { exists: true, value: current };
}

function setPath(target: JsonObject, path: string, value: JsonValue): void {
  const segments = parsePath(path);
  if (segments.length === 0) {
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      throw new ScenarioRunnerError("INPUT_MAPPING_FAILED", "The root arguments value must be an object");
    }
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, cloneJson(value));
    return;
  }
  let current: JsonObject | JsonValue[] = target;
  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1;
    if (isLast) {
      if (typeof segment === "number") {
        if (!Array.isArray(current)) throw new ScenarioRunnerError("INPUT_MAPPING_FAILED", "Array mapping target is invalid");
        current[segment] = cloneJson(value);
      } else {
        if (Array.isArray(current)) throw new ScenarioRunnerError("INPUT_MAPPING_FAILED", "Object mapping target is invalid");
        current[segment] = cloneJson(value);
      }
      return;
    }
    const nextSegment = segments[index + 1]!;
    const nextContainer: JsonObject | JsonValue[] = typeof nextSegment === "number" ? [] : {};
    if (typeof segment === "number") {
      if (!Array.isArray(current)) throw new ScenarioRunnerError("INPUT_MAPPING_FAILED", "Array mapping target is invalid");
      const existing = current[segment];
      if (existing === null || typeof existing !== "object") current[segment] = nextContainer;
      current = current[segment] as JsonObject | JsonValue[];
    } else {
      if (Array.isArray(current)) throw new ScenarioRunnerError("INPUT_MAPPING_FAILED", "Object mapping target is invalid");
      const existing = current[segment];
      if (existing === null || typeof existing !== "object") current[segment] = nextContainer;
      current = current[segment] as JsonObject | JsonValue[];
    }
  });
}

function errorResult(error: unknown): ScenarioError {
  if (error instanceof ScenarioRunnerError) return { code: error.code, message: error.message };
  return { code: "TEST_EXECUTION_FAILED", message: "Scenario step execution failed" };
}

function assertionResults(
  definitions: readonly AssertionDefinition[],
  context: AssertionContext,
  dependencies: ScenarioRunnerDependencies,
): AssertionResult[] {
  return definitions.map((assertion) => evaluateAssertion(assertion, context, {
    createId: dependencies.createId,
    now: dependencies.now,
  }));
}

function assertionsPassed(results: readonly AssertionResult[]): boolean {
  return results.every(({ status }) => status === "PASSED");
}

async function resolveValueSource(
  source: ValueSource,
  connectionId: string,
  inputs: JsonObject,
  variables: JsonObject,
  stepResponses: ReadonlyMap<string, JsonValue | undefined>,
  dependencies: ScenarioRunnerDependencies,
): Promise<ResolvedValue> {
  switch (source.kind) {
    case "LITERAL": return { exists: true, value: cloneJson(source.value) };
    case "SCENARIO_INPUT": return Object.prototype.hasOwnProperty.call(inputs, source.name)
      ? { exists: true, value: inputs[source.name] }
      : { exists: false };
    case "VARIABLE": return Object.prototype.hasOwnProperty.call(variables, source.name)
      ? { exists: true, value: variables[source.name] }
      : { exists: false };
    case "ENVIRONMENT": {
      const value = await dependencies.resolveEnvironment(source.scope, connectionId, source.name);
      return value === undefined ? { exists: false } : { exists: true, value };
    }
    case "STEP_RESPONSE": return resolvePath(stepResponses.get(source.stepId), source.path);
  }
}

async function resolveArguments(
  step: ScenarioStepDefinition,
  inputs: JsonObject,
  variables: JsonObject,
  stepResponses: ReadonlyMap<string, JsonValue | undefined>,
  dependencies: ScenarioRunnerDependencies,
): Promise<JsonObject> {
  const result = cloneJson(step.fixedArguments);
  for (const mapping of step.mappings) {
    const resolved = await resolveValueSource(
      mapping.source, step.target.connectionId, inputs, variables, stepResponses, dependencies,
    );
    if (!resolved.exists) {
      if (mapping.isRequired) {
        throw new ScenarioRunnerError("INPUT_MAPPING_FAILED", `Required mapping for ${mapping.targetPath} is unavailable`);
      }
      continue;
    }
    setPath(result, mapping.targetPath, resolved.value!);
  }
  return result;
}

function scenarioInputs(definition: ScenarioTestCaseDefinition, supplied: JsonObject): JsonObject {
  const result: JsonObject = {};
  for (const input of definition.inputs) {
    if (Object.prototype.hasOwnProperty.call(supplied, input.name)) result[input.name] = cloneJson(supplied[input.name]!);
    else if (input.defaultValue !== undefined) result[input.name] = cloneJson(input.defaultValue);
    else if (input.isRequired) throw new ScenarioRunnerError("SCENARIO_INPUT_REQUIRED", `Required scenario input '${input.name}' is missing`);
  }
  return result;
}

function extractVariables(
  step: ScenarioStepDefinition,
  invocation: ScenarioInvocationResult,
  variables: JsonObject,
): void {
  for (const extractor of step.extractors) {
    const assertionSource = extractor.source === "RESULT" ? "MCP_RESULT"
      : extractor.source === "ERROR" ? "MCP_ERROR" : "HTTP";
    const resolved = resolvePath(invocation.sources[assertionSource], extractor.path);
    if (!resolved.exists) {
      if (extractor.isRequired) {
        throw new ScenarioRunnerError("RESPONSE_EXTRACTION_FAILED", `Required extractor '${extractor.name}' did not resolve`);
      }
      continue;
    }
    variables[extractor.name] = cloneJson(resolved.value!);
  }
}

function skippedStep(step: ScenarioStepDefinition, position: number): ScenarioRunStepResult {
  return { stepId: step.id, position, attempt: 1, status: "SKIPPED", argumentsValue: null,
    runId: null, workflowExecutionId: null, assertions: [], error: null };
}

async function runStep(
  step: ScenarioStepDefinition,
  position: number,
  phase: "main" | "cleanup",
  input: RunScenarioInput,
  inputs: JsonObject,
  variables: JsonObject,
  stepResponses: Map<string, JsonValue | undefined>,
  dependencies: ScenarioRunnerDependencies,
): Promise<ScenarioRunStepResult[]> {
  const argumentsValue = await resolveArguments(step, inputs, variables, stepResponses, dependencies);
  const startedAt = (dependencies.now ?? Date.now)();
  const maxAttempts = step.polling?.maxAttempts ?? 1;
  const results: ScenarioRunStepResult[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (input.signal?.aborted) throw new ScenarioRunnerError("TEST_EXECUTION_CANCELLED", "Scenario execution was cancelled");
    try {
      const invocation = await dependencies.invoke({
        connectionId: step.target.connectionId,
        toolName: step.target.toolName,
        argumentsValue: cloneJson(argumentsValue),
        stepId: step.id,
        position,
        attempt,
        phase,
        signal: input.signal,
      });
      const context: AssertionContext = { sources: invocation.sources, redactedSources: invocation.redactedSources };
      const regularAssertions = assertionResults(step.assertions, context, dependencies);
      const failAssertions = assertionResults(step.polling?.failWhen ?? [], context, dependencies);
      const untilAssertions = assertionResults(step.polling?.until ?? [], context, dependencies);
      const explicitlyFailed = failAssertions.some(({ status }) => status === "PASSED");
      const pollingPassed = step.polling === null || assertionsPassed(untilAssertions);
      const businessPassed = invocation.succeeded !== false || regularAssertions.length > 0;
      const passed = businessPassed && !explicitlyFailed && assertionsPassed(regularAssertions) && pollingPassed;
      const allAssertions = [...regularAssertions, ...failAssertions, ...untilAssertions];
      const now = (dependencies.now ?? Date.now)();
      const pollingExhausted = step.polling !== null && (
        attempt === maxAttempts || now - startedAt + step.polling.intervalMs > step.polling.timeoutMs
      );
      const terminalAttempt = passed || explicitlyFailed || step.polling === null || pollingExhausted;
      let current: ScenarioRunStepResult = {
        stepId: step.id, position, attempt, status: passed ? "PASSED" : "FAILED",
        argumentsValue: cloneJson(argumentsValue), runId: invocation.runId,
        workflowExecutionId: invocation.workflowExecutionId, assertions: allAssertions,
        error: !passed && invocation.succeeded === false
          ? invocation.error ?? { code: "TOOL_EXECUTION_FAILED", message: "Tool execution failed" }
          : null,
      };
      stepResponses.set(step.id, invocation.sources.MCP_RESULT);
      if (terminalAttempt) {
        try {
          extractVariables(step, invocation, variables);
        } catch (error) {
          current = { ...current, status: "ERROR", error: errorResult(error) };
        }
        results.push(current);
        return results;
      }
      results.push(current);
      await dependencies.wait(step.polling!.intervalMs, input.signal);
    } catch (error) {
      results.push({ stepId: step.id, position, attempt, status: "ERROR", argumentsValue: cloneJson(argumentsValue),
        runId: null, workflowExecutionId: null, assertions: [], error: errorResult(error) });
      return results;
    }
  }
  return results;
}

function lastStatus(results: readonly ScenarioRunStepResult[]): ScenarioRunStepResult["status"] | "ERROR" {
  return results.at(-1)?.status ?? "ERROR";
}

export async function runScenario(
  input: RunScenarioInput,
  dependencies: ScenarioRunnerDependencies,
): Promise<ScenarioRunResult> {
  const steps: ScenarioRunStepResult[] = [];
  const variables: JsonObject = {};
  let scenarioAssertions: AssertionResult[] = [];
  const stepResponses = new Map<string, JsonValue | undefined>();
  let status: ScenarioRunResult["status"] = "PASSED";
  let error: ScenarioError | null = null;
  let inputs: JsonObject = {};
  try {
    inputs = scenarioInputs(input.definition, input.inputs);
    let skipRemaining = false;
    for (const [position, step] of input.definition.steps.entries()) {
      if (skipRemaining) {
        steps.push(skippedStep(step, position));
        continue;
      }
      if (step.condition !== null) {
        const condition = evaluateAssertion(step.condition, { sources: { VARIABLE: variables } }, {
          createId: dependencies.createId, now: dependencies.now,
        });
        if (condition.status !== "PASSED") {
          steps.push(skippedStep(step, position));
          continue;
        }
      }
      const stepResults = await runStep(step, position, "main", input, inputs, variables, stepResponses, dependencies);
      steps.push(...stepResults);
      const stepStatus = lastStatus(stepResults);
      if (stepStatus === "ERROR") {
        status = "ERROR";
        error = stepResults.at(-1)?.error ?? { code: "TEST_EXECUTION_FAILED", message: "Scenario step execution failed" };
      } else if (stepStatus !== "PASSED") {
        status = status === "ERROR" ? status : "FAILED";
        error ??= stepResults.at(-1)?.error ?? null;
      }
      if (stepStatus !== "PASSED") {
        if (step.onFailure !== "CONTINUE" || input.definition.failurePolicy === "STOP") skipRemaining = true;
      }
    }
  } catch (caught) {
    const normalized = errorResult(caught);
    status = normalized.code === "TEST_EXECUTION_CANCELLED" ? "CANCELLED" : "ERROR";
    error = normalized;
  } finally {
    const cleanupOffset = input.definition.steps.length;
    for (const [index, step] of input.definition.cleanupSteps.entries()) {
      try {
        const cleanupResults = await runStep(
          step, cleanupOffset + index, "cleanup", input, inputs, variables, stepResponses, dependencies,
        );
        steps.push(...cleanupResults);
        if (lastStatus(cleanupResults) === "ERROR" && status === "PASSED") {
          status = "ERROR";
          error = cleanupResults.at(-1)?.error ?? { code: "TEST_EXECUTION_FAILED", message: "Scenario cleanup failed" };
        } else if (lastStatus(cleanupResults) === "FAILED" && status === "PASSED") {
          status = "FAILED";
        }
      } catch (caught) {
        const normalized = errorResult(caught);
        steps.push({ stepId: step.id, position: cleanupOffset + index, attempt: 1, status: "ERROR",
          argumentsValue: null, runId: null, workflowExecutionId: null, assertions: [], error: normalized });
        if (status === "PASSED") {
          status = "ERROR";
          error = normalized;
        }
      }
    }
  }
  if (status !== "CANCELLED") {
    scenarioAssertions = assertionResults(input.definition.assertions, { sources: { VARIABLE: variables } }, dependencies);
    if (scenarioAssertions.some(({ status: assertionStatus }) => assertionStatus === "ERROR")) {
      status = "ERROR";
      error ??= { code: "ASSERTION_EVALUATION_ERROR", message: "One or more scenario assertions could not be evaluated" };
    } else if (scenarioAssertions.some(({ status: assertionStatus }) => assertionStatus === "FAILED") && status === "PASSED") {
      status = "FAILED";
    }
  }
  if (status === "ERROR" && error?.code === "TEST_EXECUTION_FAILED") {
    error = { code: "TEST_EXECUTION_FAILED", message: "Scenario step execution failed" };
  }
  return { status, steps, variables, assertions: scenarioAssertions, error };
}
