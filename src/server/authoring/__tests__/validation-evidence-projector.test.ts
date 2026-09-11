import { describe, expect, it } from "vitest";
import type { AutomationDraftDefinition } from "../../../shared/authoring/draft.js";
import type { AuthoringDraftExecutionDetail } from "../../../shared/authoring/execution.js";
import type { JsonValue } from "../../../shared/tool-definition.js";
import { projectValidationEvidence } from "../validation-evidence-projector.js";

const projectId = "00000000-0000-4000-8000-000000009101";
const draftId = "00000000-0000-4000-8000-000000009102";
const executionId = "00000000-0000-4000-8000-000000009103";
const runId = "00000000-0000-4000-8000-000000009104";
const connectionId = "00000000-0000-4000-8000-000000009105";
const now = "2026-09-11T00:00:00.000Z";

function assertion(id: string, status: "PASSED" | "FAILED" | "ERROR", actual: JsonValue = id) {
  return { id: crypto.randomUUID(), assertionId: id, status,
    definition: { id, source: "MCP_RESULT" as const, path: `$.${id}`, operator: "EXISTS" as const },
    resolvedPath: `$.${id}`, actual, errorCode: status === "ERROR" ? "RESOLVER_ERROR" : null,
    message: null, durationMs: 1, isRedacted: false };
}

function fixture(): { definition: AutomationDraftDefinition; execution: AuthoringDraftExecutionDetail } {
  const ids = ["pass", "fail", "error", "unknown"];
  const definition = { version: 1 as const, testCases: [{ localId: "case-1", kind: "tool" as const,
    name: "Create", description: "", tags: [], target: { connectionId, toolName: "create_order" },
    arguments: {}, assertions: ids.map((id) => ({ id, source: "MCP_RESULT" as const,
      path: `$.${id}`, operator: "EXISTS" as const })), timeoutMs: 30_000 }], suites: [], sourceAssets: [], evidence: [],
    sourceRefs: [], expectationClaims: ids.map((id) => ({ localId: `claim-${id}`, testCaseLocalId: "case-1",
      target: { kind: "TOOL_ASSERTION" as const, assertionId: id }, statement: `${id} statement`,
      rationale: "Required", confidence: "HIGH" as const, sourceRefs: [], reviewPriority: "NORMAL" as const })) };
  const assertions = [assertion("pass", "PASSED"), assertion("fail", "FAILED"),
    assertion("error", "ERROR"), assertion("unknown", "PASSED")];
  const execution = { id: executionId, projectId, draftId, draftRevision: 1,
    definitionDigest: "a".repeat(64), validationDigest: "b".repeat(64), status: "ERROR" as const,
    inputs: {}, testCases: [{ localId: "case-1", kind: "tool" as const, status: "ERROR" as const,
      steps: [{ stepId: "tool", position: 0, attempt: 1, status: "ERROR" as const,
        arguments: { token: "raw-secret", payload: "ok" }, runId, assertions,
        error: { code: "CALL_OUTCOME_UNKNOWN", message: "token=raw-secret" } }],
      assertions, error: { code: "CALL_OUTCOME_UNKNOWN", message: "token=raw-secret" } }],
    error: null, createdAt: now, startedAt: now, completedAt: now, durationMs: 10 };
  return { definition, execution };
}

describe("validation evidence projector", () => {
  it("maps deterministic outcomes, redacts before hashing, and preserves authored order", () => {
    const input = fixture();
    const first = projectValidationEvidence({ ...input,
      toolSchemaHashes: { [`${connectionId}:create_order`]: "c".repeat(64) } });
    const second = projectValidationEvidence({ ...input,
      toolSchemaHashes: { [`${connectionId}:create_order`]: "c".repeat(64) } });

    expect(first.expectations.map(({ expectationLocalId, verdict }) => [expectationLocalId, verdict])).toEqual([
      ["claim-pass", "INCONCLUSIVE"], ["claim-fail", "INCONCLUSIVE"],
      ["claim-error", "INCONCLUSIVE"], ["claim-unknown", "INCONCLUSIVE"],
    ]);
    expect(first.machineVerdict).toBe("INCONCLUSIVE");
    expect(first.evidenceDigest).toBe(second.evidenceDigest);
    expect(JSON.stringify(first)).not.toContain("raw-secret");
    expect(first.expectations[0]).toMatchObject({ runId, redactionCount: 2,
      evidence: { connectionId, toolName: "create_order", toolSchemaHash: "c".repeat(64) } });
  });

  it("uses assertion severity without an unknown call and bounds oversized values", () => {
    const input = fixture();
    input.execution.testCases[0]!.steps[0]!.error = null;
    input.execution.testCases[0]!.error = null;
    input.execution.testCases[0]!.assertions[0]!.actual = { payload: "x".repeat(400_000) };
    input.execution.testCases[0]!.steps[0]!.assertions[0]!.actual = { payload: "x".repeat(400_000) };
    delete input.execution.testCases[0]!.assertions[3]!.actual;

    const result = projectValidationEvidence({ ...input, toolSchemaHashes: {} });

    expect(result.expectations.map(({ verdict }) => verdict)).toEqual(["PASS", "FAIL", "ERROR", "PASS"]);
    expect(result.machineVerdict).toBe("ERROR");
    expect(result.expectations[0]!.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result.expectations[0]!.evidence))).toBeLessThanOrEqual(262_144);
    expect(result.expectations[3]!.evidence).toMatchObject({
      assertion: { absenceReason: "Actual value was not captured" },
    });
  });

  it("fails closed when no expectation claim resolves", () => {
    const input = fixture();
    input.definition.expectationClaims = [];
    expect(projectValidationEvidence({ ...input, toolSchemaHashes: {} })).toMatchObject({
      machineVerdict: "ERROR", expectations: [],
    });
  });
});
