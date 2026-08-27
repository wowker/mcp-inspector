import { describe, expect, it } from "vitest";
import { resolveEnvironmentTemplate } from "../environment-template.js";

describe("environment templates", () => {
  it("lets Server variables override project variables while preserving literal text", () => {
    expect(resolveEnvironmentTemplate("tenant-{{REGION}}-{{ACCOUNT_ID}}", {
      project: { REGION: "global", ACCOUNT_ID: 42 },
      server: { REGION: "eu" },
    })).toBe("tenant-eu-42");
  });

  it("preserves literal values without environment references", () => {
    expect(resolveEnvironmentTemplate("literal-token", { project: {}, server: {} })).toBe("literal-token");
  });

  it("rejects missing, malformed, and non-scalar variables without exposing their values", () => {
    expect(() => resolveEnvironmentTemplate("{{MISSING}}", { project: {}, server: {} }))
      .toThrow("Environment variable MISSING is unavailable");
    expect(() => resolveEnvironmentTemplate("{{TOKEN", { project: {}, server: {} }))
      .toThrow("Environment template is invalid");
    expect(() => resolveEnvironmentTemplate("{{TOKEN}}", { project: { TOKEN: { secret: "never-print" } }, server: {} }))
      .toThrow("Environment variable TOKEN must be a scalar value");
  });
});
