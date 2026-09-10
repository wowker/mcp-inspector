import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createApp } from "../../app.js";
import { createProjectService } from "../../projects/project-service.js";
import { AuthoringPolicyRepository } from "../authoring-policy-repository.js";
import {
  AuthoringPolicyRevisionConflictError,
  createAuthoringPolicyService,
} from "../authoring-policy-service.js";
import type { AuthoringAuditEvent } from "../authoring-audit.js";

describe("Authoring connection policy", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-authoring-policy-"));
    const projects = createProjectService({ dataRoot });
    const firstProject = projects.create("First");
    const secondProject = projects.create("Second");
    const firstStore = projects.open(firstProject.id);
    const secondStore = projects.open(secondProject.id);
    const firstConnectionId = "10000000-0000-4000-8000-000000000001";
    const secondConnectionId = "10000000-0000-4000-8000-000000000002";
    const insertConnection = (projectId: string, connectionId: string, store: typeof firstStore) => {
      store.database.prepare(`
        INSERT INTO connections (
          id, project_id, name, url, transport, auth_mode, timeout_ms, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'streamable-http', 'none', 30000, ?, ?)
      `).run(connectionId, projectId, "Same URL", "http://127.0.0.1:9000/mcp", "2026-09-10T00:00:00.000Z", "2026-09-10T00:00:00.000Z");
    };
    insertConnection(firstProject.id, firstConnectionId, firstStore);
    insertConnection(secondProject.id, secondConnectionId, secondStore);
    const audits: AuthoringAuditEvent[] = [];
    const service = createAuthoringPolicyService({
      projects,
      now: () => new Date("2026-09-10T01:02:03.000Z"),
      audit: (event) => audits.push(event),
    });
    cleanups.push(() => {
      projects.close();
      rmSync(dataRoot, { recursive: true, force: true });
    });
    return {
      projects,
      service,
      firstProject,
      secondProject,
      firstStore,
      secondStore,
      firstConnectionId,
      secondConnectionId,
      audits,
    };
  }

  test("defaults missing policies to DISABLED and isolates same-URL connections", () => {
    const fixtureValue = fixture();
    const { service, firstProject, secondProject, firstConnectionId, secondConnectionId } = fixtureValue;
    expect(service.get(firstProject.id, firstConnectionId)).toMatchObject({
      projectId: firstProject.id,
      connectionId: firstConnectionId,
      mode: "DISABLED",
      revision: 0,
    });

    service.replace(firstProject.id, firstConnectionId, {
      expectedRevision: 0,
      mode: "CUSTOM",
      allowedTools: ["read_orders"],
      deniedTools: [],
      requireCleanupForDraftMutations: true,
      maxCallsPerMinute: 60,
      maxConcurrentCalls: 2,
      maxCallDurationMs: 30000,
    });

    expect(service.get(firstProject.id, firstConnectionId).mode).toBe("CUSTOM");
    expect(service.get(secondProject.id, secondConnectionId).mode).toBe("DISABLED");
    expect(() => service.get(firstProject.id, secondConnectionId)).toThrow(/connection not found/iu);
  });

  test("enforces every mode, deny-wins custom access, and future Tools under FULL_ACCESS", () => {
    const { service, firstProject, firstConnectionId, audits } = fixture();
    const replace = (expectedRevision: number, mode: "DISABLED" | "READ_ONLY" | "CUSTOM" | "FULL_ACCESS",
      allowedTools: string[] = [], deniedTools: string[] = []) => service.replace(firstProject.id, firstConnectionId, {
      expectedRevision,
      mode,
      allowedTools,
      deniedTools,
      requireCleanupForDraftMutations: true,
      maxCallsPerMinute: 60,
      maxConcurrentCalls: 2,
      maxCallDurationMs: 30000,
    });

    replace(0, "DISABLED");
    expect(service.isToolAllowed(firstProject.id, firstConnectionId, "read_orders")).toBe(false);
    replace(1, "READ_ONLY", ["read_orders"]);
    expect(service.isToolAllowed(firstProject.id, firstConnectionId, "read_orders")).toBe(true);
    expect(service.isToolAllowed(firstProject.id, firstConnectionId, "delete_order")).toBe(false);
    replace(2, "CUSTOM", ["read_orders", "delete_order"], ["delete_order"]);
    expect(service.isToolAllowed(firstProject.id, firstConnectionId, "read_orders")).toBe(true);
    expect(service.isToolAllowed(firstProject.id, firstConnectionId, "delete_order")).toBe(false);
    replace(3, "FULL_ACCESS", [], ["future_tool"]);
    expect(service.isToolAllowed(firstProject.id, firstConnectionId, "future_tool")).toBe(true);
    expect(service.isToolAllowed(firstProject.id, firstConnectionId, "another_future_tool")).toBe(true);
    expect(audits.at(-1)).toMatchObject({ eventType: "POLICY_CHANGED", projectId: firstProject.id,
      connectionId: firstConnectionId, policyDecision: "FULL_ACCESS", status: "SUCCEEDED" });
  });

  test("rejects stale revisions and cascades policy deletion with its exact connection", () => {
    const { service, firstProject, firstConnectionId, firstStore } = fixture();
    const saved = service.replace(firstProject.id, firstConnectionId, {
      expectedRevision: 0,
      mode: "READ_ONLY",
      allowedTools: ["z_tool", "a_tool", "z_tool"],
      deniedTools: [],
      requireCleanupForDraftMutations: false,
      maxCallsPerMinute: 10,
      maxConcurrentCalls: 1,
      maxCallDurationMs: 5000,
    });
    expect(saved.revision).toBe(1);
    expect(saved.allowedTools).toEqual(["a_tool", "z_tool"]);
    expect(() => service.replace(firstProject.id, firstConnectionId, {
      expectedRevision: 0,
      mode: "DISABLED",
      allowedTools: [],
      deniedTools: [],
      requireCleanupForDraftMutations: true,
      maxCallsPerMinute: 60,
      maxConcurrentCalls: 1,
      maxCallDurationMs: 30000,
    })).toThrow(AuthoringPolicyRevisionConflictError);

    firstStore.database.prepare("DELETE FROM connections WHERE id = ? AND project_id = ?")
      .run(firstConnectionId, firstProject.id);
    expect(new AuthoringPolicyRepository(firstStore).find(firstProject.id, firstConnectionId)).toBeNull();
  });

  test("exposes policy reads and writes only through browser session authorization", async () => {
    const { projects, service, firstProject, firstConnectionId } = fixture();
    const app = createApp({
      sessionToken: "browser-session",
      allowedOrigin: "http://127.0.0.1:8500",
      version: "3.0.0-test",
      projects,
      authoringPolicies: service,
    });
    const path = `/api/projects/${firstProject.id}/connections/${firstConnectionId}/authoring-policy`;
    expect((await app.request(path)).status).toBe(401);
    const headers = {
      Origin: "http://127.0.0.1:8500",
      "X-MCP-Inspector-Session": "browser-session",
      "Content-Type": "application/json",
    };
    const initial = await app.request(path, { headers });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ policy: { mode: "DISABLED", revision: 0 } });

    const saved = await app.request(path, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        expectedRevision: 0,
        mode: "FULL_ACCESS",
        allowedTools: [],
        deniedTools: [],
        requireCleanupForDraftMutations: true,
        maxCallsPerMinute: 60,
        maxConcurrentCalls: 2,
        maxCallDurationMs: 30000,
      }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ policy: { mode: "FULL_ACCESS", revision: 1 } });

    const stale = await app.request(path, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        expectedRevision: 0,
        mode: "DISABLED",
        allowedTools: [],
        deniedTools: [],
        requireCleanupForDraftMutations: true,
        maxCallsPerMinute: 60,
        maxConcurrentCalls: 1,
        maxCallDurationMs: 30000,
      }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: { code: "AUTHORING_POLICY_REVISION_CONFLICT", message: "Authoring policy changed; reload and try again" } });
  });
});
