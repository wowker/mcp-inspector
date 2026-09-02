import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { createEnvironmentProfileService, createProfileAwareEnvironmentService } from "../environment-profile-service.js";
import { createEnvironmentService } from "../environment-service.js";

describe("EnvironmentProfileService", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-environment-profile-"));
    roots.push(dataRoot);
    const projects = createProjectService({ dataRoot });
    const projectId = projects.create("Profiles").id;
    const connectionId = "00000000-0000-4000-8000-000000000101";
    const connections = createConnectionService(projects, {
      createId: () => connectionId,
    });
    connections.create(projectId, {
      name: "Profiles", url: "https://example.test/mcp", transport: "streamable-http",
      authMode: "none", timeoutMs: 10_000, headers: { "X-Region": "{{REGION}}", "X-Missing": "{{MISSING}}" },
    });
    let id = 102;
    const options = {
      createId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, "0")}`,
      now: () => new Date("2026-09-02T00:00:00.000Z"),
    };
    const environment = createEnvironmentService(projects, connections, options);
    const profiles = createEnvironmentProfileService(projects, connections, environment, options);
    return { projects, projectId, connectionId, environment, profiles };
  }

  it("resolves base, parent, child and Server overrides deterministically", () => {
    const { projects, projectId, connectionId, environment, profiles } = fixture();
    try {
      environment.set(projectId, null, "REGION", { value: "base", secret: false });
      environment.set(projectId, null, "REMOVED", { value: "base", secret: false });
      environment.set(projectId, connectionId, "TOKEN", { value: "base-token", secret: true });

      const parent = profiles.create(projectId, {
        name: "test", description: "", parentProfileId: null,
      });
      profiles.setVariable(projectId, parent.id, null, "REGION", {
        mode: "value", value: "test", secret: false,
      });
      profiles.setVariable(projectId, parent.id, null, "REMOVED", { mode: "unset" });
      profiles.setVariable(projectId, parent.id, connectionId, "TOKEN", {
        mode: "value", value: "parent-token", secret: true,
      });

      const child = profiles.create(projectId, {
        name: "staging", description: "", parentProfileId: parent.id,
      });
      profiles.setVariable(projectId, child.id, null, "REGION", {
        mode: "value", value: "staging", secret: false,
      });
      profiles.setVariable(projectId, child.id, connectionId, "TOKEN", {
        mode: "value", value: "visible-token", secret: false,
      });

      expect(profiles.resolve(projectId, connectionId, child.id)).toMatchObject({
        project: { REGION: "staging" },
        server: { TOKEN: "visible-token" },
        secretNames: [],
        chain: [parent.id, child.id],
      });
    } finally { projects.close(); }
  });

  it("rejects inheritance cycles and preserves the existing resolver without a profile", () => {
    const { projects, projectId, connectionId, environment, profiles } = fixture();
    try {
      environment.set(projectId, null, "REGION", { value: "base", secret: false });
      const parent = profiles.create(projectId, {
        name: "parent", description: "", parentProfileId: null,
      });
      const child = profiles.create(projectId, {
        name: "child", description: "", parentProfileId: parent.id,
      });
      expect(() => profiles.update(projectId, parent.id, {
        revision: parent.revision,
        name: "parent", description: "", parentProfileId: child.id,
      })).toThrow(/cycle/i);
      expect(environment.resolve(projectId, connectionId)).toEqual({
        project: { REGION: "base" }, server: {}, secretNames: [],
      });
    } finally { projects.close(); }
  });

  it("uses the effective Server scope when project and Server secrecy differs", () => {
    const { projects, projectId, connectionId, environment, profiles } = fixture();
    try {
      environment.set(projectId, null, "TOKEN", { value: "project-secret", secret: true });
      environment.set(projectId, connectionId, "TOKEN", { value: "server-public", secret: false });
      const profile = profiles.create(projectId, {
        name: "test", description: "", parentProfileId: null,
      });
      expect(profiles.resolve(projectId, connectionId, profile.id).secretNames).toEqual([]);
    } finally { projects.close(); }
  });

  it("selects a profile for one exact connection and keeps secret preview values hidden", () => {
    const { projects, projectId, connectionId, environment, profiles } = fixture();
    try {
      environment.set(projectId, null, "REGION", { value: "base", secret: false });
      environment.set(projectId, connectionId, "TOKEN", { value: "base-token", secret: true });
      const selected = profiles.create(projectId, {
        name: "staging", description: "Staging overrides", parentProfileId: null,
      });
      profiles.setVariable(projectId, selected.id, null, "REGION", {
        mode: "value", value: "staging", secret: false,
      });
      profiles.setVariable(projectId, selected.id, connectionId, "TOKEN", {
        mode: "value", value: "profile-token", secret: true,
      });

      expect(profiles.getActiveProfileId(projectId, connectionId)).toBeNull();
      profiles.setActiveProfileId(projectId, connectionId, selected.id);
      const runtimeEnvironment = createProfileAwareEnvironmentService(environment, profiles);
      expect(profiles.resolveActive(projectId, connectionId)).toEqual({
        project: { REGION: "staging" },
        server: { TOKEN: "profile-token" },
        secretNames: ["TOKEN"],
      });
      expect(runtimeEnvironment.resolve(projectId, connectionId).project).toEqual({ REGION: "staging" });
      const preview = profiles.preview(projectId, connectionId, selected.id);
      expect(preview.chain.map(({ id }) => id)).toEqual([selected.id]);
      expect(preview.variables).toContainEqual(expect.objectContaining({
        name: "REGION", value: "staging", source: "profile", sourceProfileId: selected.id,
      }));
      expect(preview.variables).toContainEqual({
        name: "TOKEN", scope: "server", secret: true,
        source: "profile", sourceProfileId: selected.id,
      });
      expect(preview.references).toEqual(expect.arrayContaining([
        { location: "Header: X-Region", variables: ["REGION"], missing: [] },
        { location: "Header: X-Missing", variables: ["MISSING"], missing: ["MISSING"] },
      ]));
      expect(JSON.stringify(preview)).not.toContain("profile-token");
      expect(() => profiles.delete(projectId, selected.id)).toThrow(/in use/i);

      profiles.setActiveProfileId(projectId, connectionId, null);
      expect(profiles.resolveActive(projectId, connectionId)).toEqual({
        project: { REGION: "base" }, server: { TOKEN: "base-token" }, secretNames: ["TOKEN"],
      });
    } finally { projects.close(); }
  });
});
