import { describe, expect, it } from "vitest";
import { fieldsFromSchema, requiresWholeArgumentsFallback, valueFromInput } from "../schema-form.js";

describe("schema form", () => {
  it("describes primitive fields, defaults, constraints and additional arguments", () => {
    const fields = fieldsFromSchema({ type: "object", required: ["name"], properties: {
      name: { type: "string", description: "Display name", default: "Ada", minLength: 2 },
      count: { type: "integer", minimum: 1 }, enabled: { type: "boolean" },
      mode: { enum: ["fast", "safe"] }, payload: { type: "object" },
    } }, { extra: { preserved: true } });
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "name", kind: "string", required: true, defaultValue: "Ada",
        constraints: { minLength: 2 } }),
      expect.objectContaining({ name: "count", kind: "integer" }),
      expect.objectContaining({ name: "enabled", kind: "boolean" }),
      expect.objectContaining({ name: "mode", kind: "enum" }),
      expect.objectContaining({ name: "payload", kind: "json" }),
      expect.objectContaining({ name: "extra", additional: true, value: { preserved: true } }),
    ]));
  });

  it("falls back to JSON for unsupported constructs without losing values", () => {
    const [field] = fieldsFromSchema({ type: "object", properties: {
      value: { oneOf: [{ type: "string" }, { type: "number" }] },
    } }, { value: { nested: [1, 2] } });
    expect(field).toMatchObject({ kind: "json", value: { nested: [1, 2] } });
    expect(valueFromInput(field, '{"nested":[3]}')).toEqual({ ok: true, value: { nested: [3] } });
    expect(requiresWholeArgumentsFallback({ oneOf: [{ type: "object" }, { type: "null" }] })).toBe(true);
    expect(requiresWholeArgumentsFallback({ type: "object", properties: {} })).toBe(false);
  });
});
