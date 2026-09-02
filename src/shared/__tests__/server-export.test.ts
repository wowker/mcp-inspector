import { describe, expect, it } from "vitest";
import { parseServerExportEnvironment } from "../server-export.js";

describe("server export environment contract", () => {
  it("accepts public values and redacted secrets without secret material", () => {
    const parsed = parseServerExportEnvironment({
      activeProfileId: "00000000-0000-4000-8000-000000000201",
      baseVariables: [
        { name: "REGION", scope: "project", secret: false, value: "eu" },
        { name: "API_TOKEN", scope: "server", secret: true, redacted: true },
      ],
      profiles: [{
        id: "00000000-0000-4000-8000-000000000201",
        name: "Staging",
        description: "Staging overrides",
        parentProfileId: null,
        revision: 1,
        variables: [
          { name: "REGION", scope: "project", mode: "value", secret: false, value: "us" },
          { name: "API_TOKEN", scope: "server", mode: "value", secret: true, redacted: true },
          { name: "LEGACY", scope: "project", mode: "unset", secret: false },
        ],
      }],
    });

    expect(parsed.profiles[0]?.variables).toHaveLength(3);
    expect(JSON.stringify(parsed)).not.toContain("secret-value");
  });

  it("rejects any secret entry that also contains a value", () => {
    expect(() => parseServerExportEnvironment({
      activeProfileId: null,
      baseVariables: [
        { name: "API_TOKEN", scope: "server", secret: true, redacted: true, value: "secret-value" },
      ],
      profiles: [],
    })).toThrow();
  });
});
