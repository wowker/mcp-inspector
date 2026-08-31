import { describe, expect, it } from "vitest";
import type { SchemaIssue } from "../../../../shared/json-schema.js";
import {
  fieldMatchesFilter,
  parameterStatus,
  summarizeConstraints,
  summarizeJsonValue,
  type ParameterFilter,
} from "../parameter-editor-model.js";
import type { SchemaField } from "../schema-form.js";

function field(overrides: Partial<SchemaField> & Pick<SchemaField, "name">): SchemaField {
  const { name, ...rest } = overrides;
  return {
    name,
    path: `/${name}`,
    kind: "string",
    required: false,
    constraints: {},
    schema: { type: "string" },
    value: undefined,
    additional: false,
    ...rest,
  };
}

describe("parameter editor model", () => {
  it("counts completed required fields and blocking issues without treating false or zero as empty", () => {
    const fields = [
      field({ name: "name", required: true, value: "" }),
      field({ name: "count", required: true, kind: "number", value: 0 }),
      field({ name: "enabled", required: true, kind: "boolean", value: false }),
      field({ name: "optional", value: "ready" }),
    ];
    const issues: SchemaIssue[] = [
      { path: "/name", keyword: "minLength", message: "too short" },
      { path: "/missing", keyword: "required", message: "required" },
    ];

    expect(parameterStatus(fields, issues)).toEqual({
      requiredCompleted: 2,
      requiredTotal: 3,
      errorCount: 2,
    });
  });

  it.each<[ParameterFilter, string[]]>([
    ["all", ["required", "filled", "invalid", "empty"]],
    ["required", ["required"]],
    ["filled", ["required", "filled", "invalid"]],
    ["errors", ["invalid"]],
  ])("filters fields with %s without changing their values", (filter, names) => {
    const fields = [
      field({ name: "required", required: true, value: 0 }),
      field({ name: "filled", value: "value" }),
      field({ name: "invalid", value: "bad" }),
      field({ name: "empty" }),
    ];
    const issues = [{ path: "/invalid", keyword: "pattern", message: "invalid" }];

    expect(fields.filter((item) => fieldMatchesFilter(item, issues, filter)).map(({ name }) => name)).toEqual(names);
  });

  it("turns Schema constraints and complex JSON values into compact summaries", () => {
    expect(summarizeConstraints(field({
      name: "title",
      required: true,
      constraints: { minLength: 1, maxLength: 64, pattern: "^[a-z]+$" },
    }))).toEqual(["string", "1–64", "pattern"]);
    expect(summarizeConstraints(field({
      name: "price",
      kind: "number",
      constraints: { minimum: 0, maximum: 100 },
    }))).toEqual(["number", "0–100"]);
    expect(summarizeJsonValue([{ id: 1 }, { id: 2 }])).toBe("Array<Object> · 2 项");
    expect(summarizeJsonValue({ id: 1, name: "demo" })).toBe("Object · 2 个字段");
    expect(summarizeJsonValue(undefined)).toBe("JSON · 未设置");
  });
});
