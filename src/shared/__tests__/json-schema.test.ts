import { describe, expect, it } from "vitest";
import { formatRawArguments, parseRawArguments } from "../json.js";
import { validateJsonSchema } from "../json-schema.js";

describe("raw arguments", () => {
  it("accepts objects, rejects other roots, and reports syntax offsets", () => {
    expect(parseRawArguments('{"x":1}')).toEqual({ ok: true, value: { x: 1 } });
    expect(parseRawArguments("[]")).toMatchObject({ ok: false, offset: null });
    expect(parseRawArguments('{"x":}')).toMatchObject({ ok: false, offset: expect.any(Number) });
    expect(formatRawArguments({ nested: [1, true, null] })).toBe('{\n  "nested": [\n    1,\n    true,\n    null\n  ]\n}');
  });
});

describe("JSON Schema validation", () => {
  it.each([
    "https://json-schema.org/draft/2020-12/schema",
    "http://json-schema.org/draft-07/schema#",
  ])("validates %s without mutating values", ($schema) => {
    const value = { "a/b~c": "1", untouched: true };
    const before = structuredClone(value);
    const result = validateJsonSchema({ $schema, type: "object", required: ["missing/key"],
      properties: { "a/b~c": { type: "number" } } }, value);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/a~1b~0c", keyword: "type" }),
      expect.objectContaining({ path: "/missing~1key", keyword: "required" }),
    ]));
    expect(value).toEqual(before);
  });

  it("warns but still validates an unknown dialect", () => {
    const result = validateJsonSchema({ $schema: "https://example.test/custom", type: "object",
      required: ["x"] }, {});
    expect(result.warning).toMatch(/未知/);
    expect(result.issues).toHaveLength(1);
  });
});
