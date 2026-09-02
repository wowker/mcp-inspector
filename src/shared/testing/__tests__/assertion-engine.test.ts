import { describe, expect, it } from "vitest";
import type { AssertionDefinition } from "../assertions.js";
import { evaluateAssertion, type AssertionContext } from "../assertion-engine.js";

const context: AssertionContext = {
  sources: {
    VARIABLE: {
      present: "Hello World",
      nil: null,
      number: 10,
      array: [1, { id: 2 }],
      object: { id: 2, nested: { active: true }, extra: "kept" },
    },
    RUN: { status: "succeeded", isError: false, durationMs: 120, networkDurationMs: 80 },
  },
};

let nextId = 900;
const options = {
  createId: () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
  now: (() => { let tick = 0; return () => tick++; })(),
};

function definition(operator: AssertionDefinition["operator"], path: string, expected?: unknown): AssertionDefinition {
  return {
    id: `${operator.toLocaleLowerCase()}-${path || "root"}`,
    source: operator === "STATUS_IS" || operator === "IS_ERROR_IS" ||
      operator === "DURATION_LTE" || operator === "NETWORK_DURATION_LTE" ? "RUN" : "VARIABLE",
    path,
    operator,
    ...(expected === undefined ? {} : { expected: expected as never }),
  };
}

describe("assertion engine", () => {
  it.each([
    ["EXISTS", "$.present", undefined],
    ["NOT_EXISTS", "$.missing", undefined],
    ["IS_NULL", "$.nil", undefined],
    ["NOT_NULL", "$.present", undefined],
    ["EQUALS", "$.number", 10],
    ["NOT_EQUALS", "$.number", 11],
    ["DEEP_EQUALS", "$.array", [1, { id: 2 }]],
    ["SUBSET", "$.object", { nested: { active: true } }],
    ["CONTAINS", "$.present", "World"],
    ["STARTS_WITH", "$.present", "Hello"],
    ["ENDS_WITH", "$.present", "World"],
    ["MATCHES_REGEX", "$.present", "^Hello\\sWorld$"],
    ["GT", "$.number", 9],
    ["GTE", "$.number", 10],
    ["LT", "$.number", 11],
    ["LTE", "$.number", 10],
    ["BETWEEN", "$.number", [9, 11]],
    ["LENGTH_EQUALS", "$.array", 2],
    ["LENGTH_GTE", "$.present", 5],
    ["ARRAY_CONTAINS", "$.array", { id: 2 }],
    ["TYPE_IS", "$.number", "number"],
    ["MATCHES_SCHEMA", "$.object", { type: "object", required: ["id"], properties: { id: { type: "number" } } }],
    ["STATUS_IS", "$.status", "succeeded"],
    ["IS_ERROR_IS", "$.isError", false],
    ["DURATION_LTE", "$.durationMs", 120],
    ["NETWORK_DURATION_LTE", "$.networkDurationMs", 80],
  ] as const)("evaluates %s with strict deterministic semantics", (operator, path, expected) => {
    expect(evaluateAssertion(definition(operator, path, expected), context, options))
      .toMatchObject({ status: "PASSED", errorCode: null, assertionId: expect.any(String) });
  });

  it("supports unordered arrays, case-insensitive strings, exact objects, and negation", () => {
    expect(evaluateAssertion({ ...definition("DEEP_EQUALS", "$.array", [{ id: 2 }, 1]), options: {
      arrayOrder: "UNORDERED",
    } }, context, options).status).toBe("PASSED");
    expect(evaluateAssertion({ ...definition("EQUALS", "$.present", "hello world"), options: {
      caseSensitive: false,
    } }, context, options).status).toBe("PASSED");
    expect(evaluateAssertion({ ...definition("SUBSET", "$.object", { id: 2 }), options: {
      objectMatch: "EXACT",
    } }, context, options).status).toBe("FAILED");
    expect(evaluateAssertion({ ...definition("EQUALS", "$.number", 11), options: {
      isNegated: true,
    } }, context, options).status).toBe("PASSED");
  });

  it("returns stable ERROR results for unsafe paths, regexes, and invalid operands", () => {
    expect(evaluateAssertion(definition("EQUALS", "$.__proto__.polluted", true), context, options))
      .toMatchObject({ status: "ERROR", errorCode: "ASSERTION_INVALID" });
    expect(evaluateAssertion(definition("MATCHES_REGEX", "$.present", "(a+)+$"), context, options))
      .toMatchObject({ status: "ERROR", errorCode: "ASSERTION_INVALID" });
    expect(evaluateAssertion(definition("GT", "$.number", "9"), context, options))
      .toMatchObject({ status: "ERROR", errorCode: "ASSERTION_INVALID" });
  });

  it("does not expose actual values for redacted sources", () => {
    const result = evaluateAssertion(definition("EQUALS", "$.present", "nope"), {
      ...context, redactedSources: new Set(["VARIABLE"]),
    }, options);
    expect(result).toMatchObject({ status: "FAILED", isRedacted: true });
    expect(result).not.toHaveProperty("actual");
  });

  it("treats an unresolved ordinary path as a failed assertion, not an engine crash", () => {
    expect(evaluateAssertion(definition("EQUALS", "$.missing", "value"), context, options))
      .toMatchObject({ status: "FAILED", errorCode: null, resolvedPath: "$.missing" });
  });
});
