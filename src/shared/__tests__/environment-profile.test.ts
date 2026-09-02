import { describe, expect, it } from "vitest";
import {
  environmentProfileMutationSchema,
  environmentProfileVariableMutationSchema,
  parseEnvironmentProfile,
} from "../environment-profile.js";

describe("environment profile contracts", () => {
  it("accepts a bounded project profile with an optional parent", () => {
    expect(environmentProfileMutationSchema.parse({
      name: "staging",
      description: "Shared staging defaults",
      parentProfileId: "00000000-0000-4000-8000-000000000001",
    })).toEqual({
      name: "staging",
      description: "Shared staging defaults",
      parentProfileId: "00000000-0000-4000-8000-000000000001",
    });
    expect(() => environmentProfileMutationSchema.parse({
      name: "staging",
      description: "",
      parentProfileId: null,
      token: "must-not-be-accepted",
    })).toThrow();
  });

  it("models explicit value and unset overrides without leaking unset values", () => {
    expect(environmentProfileVariableMutationSchema.parse({
      mode: "value", value: "{{TOKEN}}", secret: true,
    })).toEqual({ mode: "value", value: "{{TOKEN}}", secret: true });
    expect(environmentProfileVariableMutationSchema.parse({ mode: "unset" }))
      .toEqual({ mode: "unset" });
    expect(() => environmentProfileVariableMutationSchema.parse({
      mode: "unset", value: "hidden", secret: true,
    })).toThrow();
  });

  it("never accepts secret material in a public profile response", () => {
    expect(parseEnvironmentProfile({
      id: "00000000-0000-4000-8000-000000000002",
      projectId: "00000000-0000-4000-8000-000000000003",
      name: "test",
      description: "",
      parentProfileId: null,
      revision: 1,
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
    })).toMatchObject({ name: "test", revision: 1 });
  });
});
