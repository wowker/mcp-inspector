import { describe, expect, it } from "vitest";
import { resolveDefaultDataRoot } from "../project-paths.js";

describe("resolveDefaultDataRoot", () => {
  it("uses Application Support on macOS", () => {
    expect(resolveDefaultDataRoot({ platform: "darwin", homeDirectory: "/Users/test" })).toBe(
      "/Users/test/Library/Application Support/MCP Inspector",
    );
  });

  it("uses APPDATA on Windows", () => {
    expect(resolveDefaultDataRoot({ platform: "win32", environment: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" } })).toContain(
      "MCP Inspector",
    );
    expect(() => resolveDefaultDataRoot({ platform: "win32", environment: {} })).toThrow(/APPDATA/);
  });
});
