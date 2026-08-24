import { describe, expect, it, vi } from "vitest";
import { DialectAwareJsonSchemaValidator } from "../dialect-aware-validator.js";

describe("DialectAwareJsonSchemaValidator", () => {
  it("defaults an absent dialect to 2020-12", () => {
    const validator = new DialectAwareJsonSchemaValidator().getValidator({
      type: "object",
      properties: { value: { type: "string" } },
      unevaluatedProperties: false,
    });
    expect(validator({ value: "ok" }).valid).toBe(true);
    expect(validator({ value: "ok", extra: true }).valid).toBe(false);
  });

  it("dispatches normalized draft-07 and registers formats", () => {
    const validator = new DialectAwareJsonSchemaValidator().getValidator({
      $schema: " HTTP://JSON-SCHEMA.ORG/DRAFT-07/SCHEMA# ",
      type: "string",
      format: "email",
    });
    expect(validator("person@example.test").valid).toBe(true);
    expect(validator("not-an-email").valid).toBe(false);
  });

  it("warns and accepts schemas declaring an unknown dialect", () => {
    const warn = vi.fn();
    const validator = new DialectAwareJsonSchemaValidator({ warn }).getValidator({
      $schema: "https://example.test/future-schema",
      type: "string",
    });
    expect(validator(42)).toEqual({ valid: true, data: 42, errorMessage: undefined });
    expect(warn).toHaveBeenCalledOnce();
  });
});
