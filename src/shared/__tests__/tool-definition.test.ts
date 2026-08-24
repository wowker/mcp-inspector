import { describe, expect, it } from "vitest";
import { parseToolDefinition } from "../tool-definition.js";

describe("MCP Tool definition schema", () => {
  it.each([
    ["array output", { type: "array", items: false }],
    ["boolean anyOf branch", { anyOf: [false, { type: "string" }] }],
    ["boolean negation", { not: false }],
    ["empty schema", {}],
  ])("accepts the legal %s JSON Schema object", (_label, outputSchema) => {
    const definition = {
      name: "schema/output",
      inputSchema: { type: "object" },
      outputSchema: { ...outputSchema, futureKeyword: { retained: true } },
    };

    expect(parseToolDefinition(definition)).toEqual(definition);
  });
});
