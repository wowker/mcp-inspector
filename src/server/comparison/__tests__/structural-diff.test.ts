import { describe, expect, it } from "vitest";
import type { JsonObject } from "../../../shared/tool-definition.js";
import { diffJsonValues, InvalidComparisonPathError, normalizeSafeJsonPath, parseSafeJsonPath } from "../structural-diff.js";

describe("bounded structural diff", () => {
  it("parses and normalizes only the safe JSONPath subset", () => {
    expect(normalizeSafeJsonPath("$.items[*]['display/name'][0]")).toBe('$["items"][*]["display/name"][0]');
    expect(parseSafeJsonPath("$")).toEqual([]);
    for (const invalid of ["", "items", "$..secret", "$[?(@.x)]", "$[0:2]", "$[0,1]", "$.__proto__", "$['constructor']", "$[foo]", `${"$.a".repeat(65)}`]) {
      expect(() => parseSafeJsonPath(invalid)).toThrow(InvalidComparisonPathError);
    }
  });

  it("produces deterministic added, removed, changed, and type-changed pointers", () => {
    const source = { keep: true, changed: 1, typed: "1", removed: { value: 1 }, rows: [{ volatile: 1 }, { volatile: 2 }] };
    const replay = { keep: true, changed: 2, typed: 1, added: ["new"], rows: [{ volatile: 9 }, { volatile: 8 }] };
    const result = diffJsonValues(source, replay, ["$.rows[*].volatile"]);
    expect(result.truncated).toBe(false);
    expect(result.changes).toEqual([
      { path: "/added", kind: "ADDED", replay: ["new"], ignored: false },
      { path: "/changed", kind: "CHANGED", source: 1, replay: 2, ignored: false },
      { path: "/removed", kind: "REMOVED", source: { value: 1 }, ignored: false },
      { path: "/rows/0/volatile", kind: "CHANGED", source: 1, replay: 9, ignored: true },
      { path: "/rows/1/volatile", kind: "CHANGED", source: 2, replay: 8, ignored: true },
      { path: "/typed", kind: "TYPE_CHANGED", source: "1", replay: 1, ignored: false },
    ]);
    expect(source.rows[0]!.volatile).toBe(1);
  });

  it("bounds nodes, changes, and serialized bytes with explicit truncation", () => {
    expect(diffJsonValues({ a: 1, b: 2 }, { a: 2, b: 3 }, [], { maxNodes: 1, maxChanges: 10, maxBytes: 10_000 }).truncated).toBe(true);
    expect(diffJsonValues([1, 2, 3], [4, 5, 6], [], { maxNodes: 100, maxChanges: 2, maxBytes: 10_000 }))
      .toMatchObject({ truncated: true, changes: expect.arrayContaining([expect.any(Object)]) });
    expect(diffJsonValues({ payload: "a".repeat(200) }, { payload: "b".repeat(200) }, [], { maxNodes: 10, maxChanges: 10, maxBytes: 50 }))
      .toMatchObject({ truncated: true, changes: [] });
  });

  it("keeps generated object and array comparisons deterministic without mutating either input", () => {
    for (let size = 1; size <= 40; size += 7) {
      const source = { rows: Array.from({ length: size }, (_, index) => ({ id: index, value: index % 3 })) };
      const replay = { rows: Array.from({ length: size }, (_, index) => ({ id: index, value: (index + 1) % 3 })) };
      const beforeSource = JSON.stringify(source);
      const beforeReplay = JSON.stringify(replay);
      const first = diffJsonValues(source, replay, ["$.rows[*].value"]);
      const second = diffJsonValues(source, replay, ["$.rows[*].value"]);
      expect(first).toEqual(second);
      expect(first.changes).toHaveLength(size);
      expect(first.changes.every(({ ignored }) => ignored)).toBe(true);
      expect(JSON.stringify(source)).toBe(beforeSource);
      expect(JSON.stringify(replay)).toBe(beforeReplay);
    }
  });

  it("truncates paths beyond the public contract instead of throwing", () => {
    const longKey = "x".repeat(500);
    let source: JsonObject = { leaf: 1 };
    let replay: JsonObject = { leaf: 2 };
    for (let index = 0; index < 10; index += 1) {
      source = { [`${longKey}${index}`]: source };
      replay = { [`${longKey}${index}`]: replay };
    }
    expect(diffJsonValues(source, replay)).toMatchObject({ truncated: true, changes: [] });
  });

  it("treats prototype-looking response keys as inert data while rejecting them as rules", () => {
    const source = JSON.parse('{"__proto__":{"polluted":false},"safe":1}');
    const replay = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
    expect(diffJsonValues(source, replay).changes).toEqual([
      { path: "/__proto__/polluted", kind: "CHANGED", source: false, replay: true, ignored: false },
    ]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
