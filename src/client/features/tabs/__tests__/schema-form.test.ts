import { describe, expect, it } from "vitest";
import {
  arrayObjectItemSchema,
  discriminatedObjectBranches,
  fieldsFromSchema,
  planObjectBranchSwitch,
  requiresWholeArgumentsFallback,
  valueAtJsonPointer,
  valueFromInput,
} from "../schema-form.js";

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

  it("resolves escaped nested JSON Pointers without traversing prototype keys", () => {
    const root = { profile: { preferences: { locale: "en-US" } }, "a/b~c": [{ value: 7 }] };
    expect(valueAtJsonPointer(root, "/profile/preferences/locale")).toBe("en-US");
    expect(valueAtJsonPointer(root, "/a~1b~0c/0/value")).toBe(7);
    expect(valueAtJsonPointer(root, "/profile/missing")).toBeUndefined();
    expect(valueAtJsonPointer(root, "/__proto__/polluted")).toBeUndefined();
    expect(valueAtJsonPointer(root, "/invalid~2escape")).toBeUndefined();
  });

  it("treats inherited property names as additional values", () => {
    const values = JSON.parse('{"constructor":"local"}') as Record<string, unknown>;
    expect(fieldsFromSchema({ type: "object", properties: {} }, values))
      .toEqual([expect.objectContaining({ name: "constructor", additional: true, value: "local" })]);
  });

  it("resolves explicit discriminators before other unique const fields", () => {
    const model = discriminatedObjectBranches({ type: "object", discriminator: { propertyName: "kind" }, oneOf: [
      { type: "object", title: "Card", properties: { kind: { const: "card" }, marker: { const: "x" }, cardNumber: { type: "string" } } },
      { type: "object", title: "Wallet", properties: { kind: { enum: ["wallet"] }, marker: { const: "y" }, walletId: { type: "string" } } },
    ] });

    expect(model).toMatchObject({ keyword: "oneOf", propertyName: "kind" });
    expect(model?.options.map(({ title, value }) => ({ title, value })))
      .toEqual([{ title: "Card", value: "card" }, { title: "Wallet", value: "wallet" }]);
  });

  it("infers one unique single-value selector and rejects ambiguous or unsupported branches", () => {
    const inferred = discriminatedObjectBranches({ type: "object", anyOf: [
      { type: "object", properties: { mode: { const: "simple" }, value: { type: "string" } } },
      { type: "object", properties: { mode: { enum: ["advanced"] }, rules: { type: "array" } } },
    ] });
    expect(inferred).toMatchObject({ keyword: "anyOf", propertyName: "mode" });
    expect(discriminatedObjectBranches({ type: "object", oneOf: [
      { type: "object", properties: { mode: { const: "a" }, version: { const: 1 } } },
      { type: "object", properties: { mode: { const: "b" }, version: { const: 2 } } },
    ] })).toBeNull();
    expect(discriminatedObjectBranches({ type: "object", oneOf: [
      { $ref: "#/$defs/a" }, { type: "object", properties: { mode: { const: "b" } } },
    ] })).toBeNull();
    expect(discriminatedObjectBranches({ type: "object", properties: [], discriminator: { propertyName: "mode" }, oneOf: [
      { type: "object", properties: { mode: { const: "a" } } },
      { type: "object", properties: { mode: { const: "b" } } },
    ] })).toBeNull();
    expect(discriminatedObjectBranches({ type: "object", discriminator: { propertyName: "mode" }, oneOf: [
      { type: "object", properties: { mode: { const: "a" } }, required: [7] },
      { type: "object", properties: { mode: { const: "b" } } },
    ] })).toBeNull();
  });

  it("plans branch switches without dropping common or unknown values", () => {
    const model = discriminatedObjectBranches({ type: "object", properties: { requestId: { type: "string" } },
      discriminator: { propertyName: "kind" }, oneOf: [
        { type: "object", properties: { kind: { const: "card" }, cardNumber: { type: "string" } } },
        { type: "object", properties: { kind: { const: "wallet" }, walletId: { type: "string" } } },
      ] })!;
    const plan = planObjectBranchSwitch(model,
      { kind: "card", requestId: "req", cardNumber: "4111", extension: "keep" }, 1);

    expect(plan.removed).toEqual(["cardNumber"]);
    expect(plan.value).toEqual({ kind: "wallet", requestId: "req", extension: "keep" });
  });
});
