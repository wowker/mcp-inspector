import { describe, expect, it } from "vitest";
import { linearRegexTest, UnsupportedRegexError } from "../linear-regex.js";

describe("linear regex", () => {
  it("supports bounded deterministic matching without native backtracking", () => {
    expect(linearRegexTest("^Hello\\sWorld$", "Hello World")).toBe(true);
    expect(linearRegexTest("[a-z]+-[0-9]{2,4}", "prefix abc-123 suffix")).toBe(true);
    expect(linearRegexTest("colou?r", "color")).toBe(true);
    expect(linearRegexTest("ABC", "abc", false)).toBe(true);
    expect(linearRegexTest("a*$", "bbb")).toBe(true);
    expect(linearRegexTest("^a*$", "bbb")).toBe(false);
  });

  it("rejects constructs that cannot be evaluated with a linear bound", () => {
    expect(() => linearRegexTest("(a+)+$", "a".repeat(100))).toThrow(UnsupportedRegexError);
    expect(() => linearRegexTest("a|aa", "aa")).toThrow(UnsupportedRegexError);
    expect(() => linearRegexTest("(a)\\1", "aa")).toThrow(UnsupportedRegexError);
    expect(() => linearRegexTest("a{101}", "a".repeat(101))).toThrow(UnsupportedRegexError);
  });
});
