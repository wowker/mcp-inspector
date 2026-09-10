import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { createTestCaseService } from "../../testing/test-case-service.js";
import { createTestSuiteService } from "../../testing/test-suite-service.js";
import type { AutomationDraftDefinition } from "../../../shared/authoring/draft.js";
import type { AuthoringCallService } from "../authoring-call-service.js";
import {
  AuthoringDraftIdempotencyConflictError,
  AuthoringDraftInvalidError,
  AuthoringDraftRevisionConflictError,
  AuthoringDraftSourceRevisionConflictError,
  createAuthoringDraftService,
} from "../authoring-draft-service.js";

const projectId = "00000000-0000-4000-8000-000000006001";
const otherProjectId = "00000000-0000-4000-8000-000000006002";
const connectionId = "00000000-0000-4000-8000-000000006003";
const callId = "00000000-0000-4000-8000-000000006004";
const runId = "00000000-0000-4000-8000-000000006005";

describe("AuthoringDraftService", () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-authoring-drafts-"));
    let projectNumber = 0;
    const projects = createProjectService({ dataRoot, createId: () => projectNumber++ === 0 ? projectId : otherProjectId });
    projects.create("Draft project");
    projects.create("Other project");
    const connections = createConnectionService(projects, { createId: () => connectionId });
    connections.create(projectId, { name: "Orders", url: "https://orders.example.test/mcp",
      transport: "streamable-http", authMode: "none", timeoutMs: 10_000 });
    let formalId = 6_100;
    const formalCreateId = () => `00000000-0000-4000-8000-${String(formalId++).padStart(12, "0")}`;
    const testCases = createTestCaseService(projects, { createId: formalCreateId });
    const testSuites = createTestSuiteService(projects, { createId: formalCreateId });
    const calls: Pick<AuthoringCallService, "get"> = { get: () => ({
      id: callId, projectId, connectionId, toolName: "create_order", toolSnapshotId: null,
      toolSchemaHash: "a".repeat(64), context: { kind: "STANDALONE" }, purpose: "DIAGNOSTIC",
      status: "SUCCEEDED", runId, idempotencyKey: "source-call", arguments: { token: "[REDACTED]", sku: "A" },
      mayHaveSideEffects: true, response: { orderId: "100" }, error: null,
      createdAt: "2026-09-10T00:00:00.000Z", startedAt: null, completedAt: null, durationMs: null,
    }) };
    let draftId = 6_500;
    let second = 0;
    const drafts = createAuthoringDraftService({
      projects, calls, testCases, testSuites,
      createId: () => `00000000-0000-4000-8000-${String(draftId++).padStart(12, "0")}`,
      now: () => new Date(`2026-09-10T00:00:${String(second++).padStart(2, "0")}.000Z`),
    });
    cleanups.push(async () => { await connections.close(); projects.close(); rmSync(dataRoot, { recursive: true, force: true }); });
    return { projects, testCases, testSuites, drafts };
  }

  function validDefinition(connection = connectionId): AutomationDraftDefinition {
    return {
      version: 1 as const,
      testCases: [{ localId: "case-1", kind: "tool" as const, name: "Create order", description: "",
        tags: [], target: { connectionId: connection, toolName: "create_order" }, arguments: { sku: "A" },
        assertions: [], timeoutMs: 30_000 }],
      suites: [{ localId: "suite-1", name: "Order flow", description: "", tags: [],
        members: [{ localId: "member-1", testCaseLocalId: "case-1", position: 0, isEnabled: true }],
        executionPolicy: { concurrency: 1, stopOnFailure: true } }],
      sourceAssets: [], evidence: [],
    };
  }

  it("creates an empty revision and replays an identical idempotency key", () => {
    const { drafts } = fixture();
    const input = { projectId, goal: "Create order checks", idempotencyKey: "create-1" };
    const created = drafts.create(input);
    expect(drafts.create(input)).toEqual(created);
    expect(drafts.get(projectId, created.draftId)).toMatchObject({
      revision: 1, state: "ACTIVE", goal: input.goal,
      definition: { version: 1, testCases: [], suites: [], sourceAssets: [], evidence: [] },
    });
    expect(() => drafts.create({ ...input, goal: "Different" }))
      .toThrow(AuthoringDraftIdempotencyConflictError);
  });

  it("fully replaces by expected revision and rejects stale or broken Draft-local references", () => {
    const { drafts } = fixture();
    const created = drafts.create({ projectId, goal: "", idempotencyKey: "create" });
    const replaced = drafts.replace({ projectId, draftId: created.draftId, expectedRevision: 1,
      goal: "Order flow", definition: validDefinition(), idempotencyKey: "replace-1" });
    expect(replaced.revision).toBe(2);
    expect(drafts.get(projectId, created.draftId).definition.testCases).toHaveLength(1);
    const third = drafts.replace({ projectId, draftId: created.draftId, expectedRevision: 2,
      goal: "Third", definition: validDefinition(), idempotencyKey: "replace-2" });
    expect(third.revision).toBe(3);
    expect(drafts.replace({ projectId, draftId: created.draftId, expectedRevision: 1,
      goal: "Order flow", definition: validDefinition(), idempotencyKey: "replace-1" })).toEqual(replaced);
    expect(() => drafts.replace({ projectId, draftId: created.draftId, expectedRevision: 1,
      goal: "Stale", definition: validDefinition(), idempotencyKey: "replace-stale" }))
      .toThrow(AuthoringDraftRevisionConflictError);
    const broken = validDefinition();
    broken.suites[0]!.members[0]!.testCaseLocalId = "missing";
    expect(() => drafts.replace({ projectId, draftId: created.draftId, expectedRevision: 3,
      goal: "Broken", definition: broken, idempotencyKey: "replace-broken" }))
      .toThrow(AuthoringDraftInvalidError);
  });

  it("defaults legacy Draft suite members to enabled", () => {
    const { drafts } = fixture();
    const created = drafts.create({ projectId, goal: "", idempotencyKey: "create-legacy" });
    const legacy = validDefinition() as unknown as { suites: Array<{ members: Array<Record<string, unknown>> }> };
    delete legacy.suites[0]!.members[0]!.isEnabled;
    drafts.replace({ projectId, draftId: created.draftId, expectedRevision: 1,
      goal: "Legacy", definition: legacy as never, idempotencyKey: "replace-legacy" });
    expect(drafts.get(projectId, created.draftId).definition.suites[0]!.members[0]!.isEnabled).toBe(true);
  });

  it("rejects server-owned controls, management capabilities, unknown fields, and oversized Bundles", () => {
    const { drafts } = fixture();
    const created = drafts.create({ projectId, goal: "", idempotencyKey: "create" });
    const forbidden = [
      { ...validDefinition(), isEnabled: true },
      { ...validDefinition(), schedule: "* * * * *" },
      { ...validDefinition(), delete: ["asset"] },
      { ...validDefinition(), pressureTests: [] },
      { ...validDefinition(), sharedScript: "return args" },
      { ...validDefinition(), id: callId },
    ];
    for (const [index, definition] of forbidden.entries()) {
      expect(() => drafts.replace({ projectId, draftId: created.draftId, expectedRevision: 1,
        goal: "", definition: definition as never, idempotencyKey: `forbidden-${index}` }))
        .toThrow(AuthoringDraftInvalidError);
    }
    const caseEnabled = validDefinition() as ReturnType<typeof validDefinition> & { testCases: Array<Record<string, unknown>> };
    caseEnabled.testCases[0]!.isEnabled = true;
    expect(() => drafts.replace({ projectId, draftId: created.draftId, expectedRevision: 1,
      goal: "", definition: caseEnabled as never, idempotencyKey: "enabled" })).toThrow(AuthoringDraftInvalidError);
    const oversized = { ...validDefinition(),
      evidence: [{ callId, runId, testCaseLocalId: "case-1", response: "x".repeat(2_097_152) }] };
    expect(() => drafts.replace({ projectId, draftId: created.draftId, expectedRevision: 1,
      goal: "", definition: oversized, idempotencyKey: "large" })).toThrow(AuthoringDraftInvalidError);
  });

  it("creates a Draft from sanitized call evidence", () => {
    const { drafts } = fixture();
    const created = drafts.createFromCall({ projectId, callId, goal: "Capture diagnosis", idempotencyKey: "from-call" });
    const draft = drafts.get(projectId, created.draftId);
    expect(draft.definition.testCases[0]).toMatchObject({
      kind: "tool", target: { connectionId, toolName: "create_order" },
      arguments: { token: "[REDACTED]", sku: "A" },
    });
    expect(draft.definition.evidence[0]).toEqual({
      callId, runId, testCaseLocalId: `call-${callId}`, response: { orderId: "100" },
    });
  });

  it("copies exact current test and suite revisions and rejects stale source revisions", () => {
    const { testCases, testSuites, drafts } = fixture();
    const testCase = testCases.create(projectId, { kind: "tool", name: "Existing", description: "",
      tags: [], isEnabled: true, target: { connectionId, toolName: "create_order" }, arguments: {},
      assertions: [], timeoutMs: 30_000 });
    const suite = testSuites.create(projectId, { name: "Existing suite", description: "", tags: [],
      members: [{ id: "00000000-0000-4000-8000-000000006090", testCaseId: testCase.id,
        position: 0, isEnabled: false }], executionPolicy: { concurrency: 1, stopOnFailure: true } });
    const fromCase = drafts.create({ projectId, goal: "Edit case", idempotencyKey: "from-case",
      source: { kind: "TEST_CASE", assetId: testCase.id, revision: 1 } });
    expect(drafts.get(projectId, fromCase.draftId).definition.sourceAssets).toEqual([
      { draftLocalId: `test-${testCase.id}`, kind: "TEST_CASE", assetId: testCase.id, revision: 1 },
    ]);
    testCases.update(projectId, testCase.id, { revision: 1, definition: {
      kind: "tool", name: "Existing updated", description: "", tags: [], isEnabled: true,
      target: { connectionId, toolName: "create_order" }, arguments: {}, assertions: [], timeoutMs: 30_000,
    } });
    expect(drafts.create({ projectId, goal: "Edit case", idempotencyKey: "from-case",
      source: { kind: "TEST_CASE", assetId: testCase.id, revision: 1 } })).toEqual(fromCase);
    const fromSuite = drafts.create({ projectId, goal: "Edit suite", idempotencyKey: "from-suite",
      source: { kind: "TEST_SUITE", assetId: suite.id, revision: 1 } });
    expect(drafts.get(projectId, fromSuite.draftId).definition).toMatchObject({
      testCases: [{ localId: `test-${testCase.id}` }],
      suites: [{ localId: `suite-${suite.id}`,
        members: [{ testCaseLocalId: `test-${testCase.id}`, isEnabled: false }] }],
    });
    expect(() => drafts.create({ projectId, goal: "Stale", idempotencyKey: "stale",
      source: { kind: "TEST_CASE", assetId: testCase.id, revision: 1 } }))
      .toThrow(AuthoringDraftSourceRevisionConflictError);
  });

  it("lists only summaries with project- and filter-bound cursors", () => {
    const { drafts } = fixture();
    drafts.create({ projectId, goal: "First", idempotencyKey: "first" });
    drafts.create({ projectId, goal: "Second", idempotencyKey: "second" });
    const page = drafts.list(projectId, { limit: 1, state: "ACTIVE" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).not.toHaveProperty("definition");
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(drafts.list(projectId, { limit: 1, state: "ACTIVE", cursor: page.nextCursor! }).items).toHaveLength(1);
    expect(() => drafts.list(projectId, { limit: 1, cursor: page.nextCursor! })).toThrow(/cursor/i);
    expect(() => drafts.list(otherProjectId, { limit: 1, state: "ACTIVE", cursor: page.nextCursor! })).toThrow(/cursor/i);
  });
});
