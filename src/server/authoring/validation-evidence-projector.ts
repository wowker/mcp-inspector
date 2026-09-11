import { createHash } from "node:crypto";
import { expectationClaimHasAuthorityConflict,
  type AutomationDraftDefinition, type ExpectationClaim } from "../../shared/authoring/draft.js";
import { projectedExpectationEvidenceSchema, type MachineVerdict } from "../../shared/authoring/validation-session.js";
import type { AuthoringDraftExecutionDetail, AuthoringDraftExecutionTestCase } from "../../shared/authoring/execution.js";
import type { AssertionResult } from "../../shared/testing/assertions.js";
import type { JsonObject, JsonValue } from "../../shared/tool-definition.js";
import { canonicalJson } from "../tools/tool-service.js";
import { boundAuthoringValue, sanitizeAuthoringValue } from "./authoring-redaction.js";

const evidenceMaximumBytes = 262_144;
const severity: Record<MachineVerdict, number> = { PASS: 0, FAIL: 1, INCONCLUSIVE: 2, ERROR: 3 };

function locate(claim: ExpectationClaim, result: AuthoringDraftExecutionTestCase): {
  assertion: AssertionResult | undefined; step: AuthoringDraftExecutionTestCase["steps"][number] | undefined;
} {
  if (claim.target.kind === "TOOL_ASSERTION" || claim.target.kind === "SCENARIO_ASSERTION") {
    return { assertion: result.assertions.find(({ assertionId }) => assertionId === claim.target.assertionId),
      step: claim.target.kind === "TOOL_ASSERTION" ? result.steps[0] : undefined };
  }
  const targetStepId = claim.target.stepId;
  const candidates = result.steps.filter(({ stepId }) => stepId === targetStepId)
    .sort((left, right) => left.position - right.position || left.attempt - right.attempt);
  const step = candidates.at(-1);
  return { step, assertion: step?.assertions.find(({ assertionId }) => assertionId === claim.target.assertionId) };
}

function verdict(assertion: AssertionResult | undefined, errorCode: string | undefined,
  conflict: boolean): MachineVerdict {
  if (conflict || errorCode?.includes("OUTCOME_UNKNOWN") === true) return "INCONCLUSIVE";
  if (assertion === undefined) return "ERROR";
  return assertion.status === "PASSED" ? "PASS" : assertion.status === "FAILED" ? "FAIL" : "ERROR";
}

function sanitized(value: unknown): { value: JsonValue; redactionCount: number; truncated: boolean } {
  const clean = sanitizeAuthoringValue(value);
  const bounded = boundAuthoringValue(clean.value, evidenceMaximumBytes);
  return { value: bounded.value, redactionCount: clean.redactionCount,
    truncated: clean.truncated || bounded.truncated };
}

export function projectValidationEvidence(input: {
  definition: AutomationDraftDefinition;
  execution: AuthoringDraftExecutionDetail;
  toolSchemaHashes: Record<string, string>;
  authoritativeConflictClaimIds?: ReadonlySet<string>;
}): { evidenceDigest: string; machineVerdict: MachineVerdict; expectations: Array<{
  expectationLocalId: string; verdict: MachineVerdict; evidence: JsonObject; runId: string | null;
  redactionCount: number; truncated: boolean;
}> } {
  const results = new Map(input.execution.testCases.map((result) => [result.localId, result]));
  const definitions = new Map(input.definition.testCases.map((testCase) => [testCase.localId, testCase]));
  const expectations = input.definition.expectationClaims.map((claim) => {
    const result = results.get(claim.testCaseLocalId);
    const definition = definitions.get(claim.testCaseLocalId);
    const located = result === undefined ? { assertion: undefined, step: undefined } : locate(claim, result);
    const target = definition?.kind === "tool" ? definition.target
      : located.step === undefined || definition?.kind !== "scenario" ? undefined
        : [...definition.steps, ...definition.cleanupSteps].find(({ id }) => id === located.step?.stepId)?.target;
    const argumentsResult = sanitized(located.step?.arguments ?? null);
    const actual = sanitized(located.assertion?.actual);
    const expected = sanitized(located.assertion?.expected);
    const error = located.step?.error ?? result?.error ?? input.execution.error;
    const statement = sanitized(claim.statement);
    const message = sanitized(located.assertion?.message ?? error?.message ?? null);
    const absence = sanitized(located.assertion === undefined
      ? error?.message ?? "Assertion result is unavailable" : null);
    const itemVerdict = verdict(located.assertion, error?.code,
      input.authoritativeConflictClaimIds?.has(claim.localId) === true ||
        expectationClaimHasAuthorityConflict(input.definition, claim));
    const evidence = projectedExpectationEvidenceSchema.parse({ claimLocalId: claim.localId,
      testCaseLocalId: claim.testCaseLocalId, target: claim.target, statement: statement.value,
      sourceRefs: claim.sourceRefs, connectionId: target?.connectionId ?? null,
      toolName: target?.toolName ?? null,
      toolSchemaHash: target === undefined ? null : input.toolSchemaHashes[`${target.connectionId}:${target.toolName}`] ?? null,
      runId: located.step?.runId ?? null,
      arguments: typeof argumentsResult.value === "object" && argumentsResult.value !== null && !Array.isArray(argumentsResult.value)
        ? argumentsResult.value : { value: argumentsResult.value },
      executionTiming: { startedAt: input.execution.startedAt, completedAt: input.execution.completedAt,
        durationMs: input.execution.durationMs },
      assertion: { status: located.assertion?.status ?? null,
        resolvedPath: located.assertion?.resolvedPath ?? null,
        ...(located.assertion?.actual === undefined ? {} : { actual: actual.value }),
        ...(located.assertion?.expected === undefined ? {} : { expected: expected.value }),
        absenceReason: located.assertion?.actual === undefined
          ? (located.assertion === undefined ? absence.value : "Actual value was not captured") : null,
        errorCode: located.assertion?.errorCode ?? error?.code ?? null,
        message: message.value,
        durationMs: located.assertion?.durationMs ?? null } });
    const bounded = boundAuthoringValue(evidence as JsonObject, evidenceMaximumBytes);
    const value = (typeof bounded.value === "object" && bounded.value !== null &&
      !Array.isArray(bounded.value)) ? bounded.value : { bounded: bounded.value };
    return { expectationLocalId: claim.localId, verdict: itemVerdict, evidence: value,
      runId: located.step?.runId ?? null,
      redactionCount: argumentsResult.redactionCount + actual.redactionCount + expected.redactionCount +
        statement.redactionCount + message.redactionCount + absence.redactionCount,
      truncated: argumentsResult.truncated || actual.truncated || expected.truncated || statement.truncated ||
        message.truncated || absence.truncated || bounded.truncated };
  });
  const machineVerdict = expectations.length === 0 ? "ERROR" : expectations.reduce<MachineVerdict>(
    (aggregate, item) => severity[item.verdict] > severity[aggregate] ? item.verdict : aggregate, "PASS");
  const evidenceDigest = createHash("sha256").update(canonicalJson({ machineVerdict, expectations })).digest("hex");
  return { evidenceDigest, machineVerdict, expectations };
}
