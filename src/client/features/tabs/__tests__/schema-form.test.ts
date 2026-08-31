import { describe, expect, it } from "vitest";
import { arrayObjectItemSchema, fieldsFromSchema, requiresWholeArgumentsFallback, valueFromInput } from "../schema-form.js";

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

  it("keeps declared fields editable when allOf only adds an if/then required dependency", () => {
    const schema = {
      type: "object",
      properties: {
        dsers_store_id: { type: "string" },
        supplier_platform_id: { type: "string" },
        supplier_product_id: { type: "string" },
      },
      required: ["dsers_store_id"],
      allOf: [{
        if: { required: ["supplier_product_id"] },
        then: { required: ["supplier_platform_id"] },
      }],
    };

    expect(requiresWholeArgumentsFallback(schema)).toBe(false);
    expect(fieldsFromSchema(schema, {}).map(({ name }) => name)).toEqual([
      "dsers_store_id", "supplier_platform_id", "supplier_product_id",
    ]);
    expect(requiresWholeArgumentsFallback({
      type: "object", properties: { supplier_product_id: { type: "string" } },
      allOf: [{
        if: { required: ["supplier_product_id"] },
        then: { required: ["undeclared_platform_id"] },
      }],
    })).toBe(true);
  });

  it("recognizes only arrays with one object item schema for structured entry editing", () => {
    const item = { type: "object", properties: { id: { type: "string" } } };
    expect(arrayObjectItemSchema({ type: "array", items: item })).toBe(item);
    expect(arrayObjectItemSchema({ type: "array", items: { type: "string" } })).toBeNull();
    expect(arrayObjectItemSchema({ type: "array", items: [item] })).toBeNull();
    expect(arrayObjectItemSchema({ type: "object", properties: {} })).toBeNull();
  });
});
