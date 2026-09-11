import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { createTestCaseService } from "../../testing/test-case-service.js";
import { createTestSuiteService } from "../../testing/test-suite-service.js";
import {
  AUTHORING_DRAFT_EXPECTATION_MAX_COUNT,
  AUTHORING_DRAFT_SOURCE_MAX_COUNT,
  automationDraftDefinitionSchema,
  type AutomationDraftDefinition,
} from "../../../shared/authoring/draft.js";
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
      sourceAssets: [], evidence: [], sourceRefs: [], expectationClaims: [],
    };
  }

  it("creates an empty revision and replays an identical idempotency key", () => {
    const { drafts } = fixture();
    const input = { projectId, goal: "Create order checks", idempotencyKey: "create-1" };
    const created = drafts.create(input);
    expect(drafts.create(input)).toEqual(created);
    expect(drafts.get(projectId, created.draftId)).toMatchObject({
      revision: 1, state: "ACTIVE", goal: input.goal,
      definition: { version: 1, testCases: [], suites: [], sourceAssets: [], evidence: [],
        sourceRefs: [], expectationClaims: [] },
    });
    expect(() => drafts.create({ ...input, goal: "Different" }))
      .toThrow(AuthoringDraftIdempotencyConflictError);
  });

  it("persists bounded provenance and an executable low-confidence Tool expectation in the definition digest", () => {
    const { drafts } = fixture();
    const created = drafts.create({ projectId, goal: "", idempotencyKey: "create-claims" });
    const definition = validDefinition();
    definition.testCases[0]!.assertions = [{ id: "created", source: "MCP_RESULT", path: "$.orderId",
      operator: "EXISTS" }];
    const claimed = {
      ...definition,
      sourceRefs: [{ localId: "requirement-1", kind: "PRODUCT_REQUIREMENT", authority: "AUTHORITATIVE",
        label: "Order creation requirement", locator: "PRD-42", digest: "a".repeat(64), excerpt: "An order ID is returned." }],
      expectationClaims: [{ localId: "expectation-1", testCaseLocalId: "case-1",
        target: { kind: "TOOL_ASSERTION", assertionId: "created" }, statement: "Creating an order returns an ID.",
        rationale: "The product requirement makes the identifier mandatory.", confidence: "LOW",
        sourceRefs: ["requirement-1"], reviewPriority: "NORMAL" }],
    } as const;

    const replaced = drafts.replace({ projectId, draftId: created.draftId, expectedRevision: 1,
      goal: "Order expectation", definition: claimed as never, idempotencyKey: "replace-claims" });

    expect(drafts.get(projectId, created.draftId)).toMatchObject({ definition: claimed });
    expect(replaced.definitionDigest).not.toBe(created.definitionDigest);
  });

  it("rejects missing provenance and assertion targets outside the claim's own test case", () => {
    const definition = validDefinition();
    definition.testCases[0]!.assertions = [{ id: "created", source: "MCP_RESULT", path: "$.orderId",
      operator: "EXISTS" }];
    const invalid = {
      ...definition,
      sourceRefs: [{ localId: "requirement-1", kind: "PRODUCT_REQUIREMENT", authority: "AUTHORITATIVE",
        label: "Order creation requirement" }],
      expectationClaims: [{ localId: "expectation-1", testCaseLocalId: "case-1",
        target: { kind: "STEP_ASSERTION", stepId: "missing-step", assertionId: "created" },
        statement: "Creating an order returns an ID.", rationale: "Required by the product.", confidence: "HIGH",
        sourceRefs: ["missing-source"], reviewPriority: "NORMAL" }],
    };

    const parsed = automationDraftDefinitionSchema.safeParse(invalid);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map(({ message }) => message)).toEqual(expect.arrayContaining([
        expect.stringContaining("source 'missing-source' does not exist"),
        expect.stringContaining("does not resolve to exactly one assertion"),
      ]));
    }
  });

  it("rejects duplicate provenance and expectation local IDs", () => {
    const definition = validDefinition();
    definition.testCases[0]!.assertions = [{ id: "created", source: "MCP_RESULT", path: "$.orderId",
      operator: "EXISTS" }];
    const source = { localId: "requirement-1", kind: "PRODUCT_REQUIREMENT" as const,
      authority: "AUTHORITATIVE" as const, label: "Order requirement" };
    const claim = { localId: "claim-1", testCaseLocalId: "case-1",
      target: { kind: "TOOL_ASSERTION" as const, assertionId: "created" },
      statement: "Creating an order returns an ID.", rationale: "Required by the product.",
      confidence: "HIGH" as const, sourceRefs: [source.localId], reviewPriority: "NORMAL" as const };

    const parsed = automationDraftDefinitionSchema.safeParse({
      ...definition, sourceRefs: [source, source], expectationClaims: [claim, claim],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map(({ message }) => message)).toEqual(expect.arrayContaining([
        "Draft source reference local IDs must be unique",
        "Draft expectation local IDs must be unique",
      ]));
    }
  });

  it("bounds provenance and expectation collections", () => {
    const definition = validDefinition();
    definition.testCases[0]!.assertions = [{ id: "created", source: "MCP_RESULT", path: "$.orderId",
      operator: "EXISTS" }];
    const sourceRefs = Array.from({ length: AUTHORING_DRAFT_SOURCE_MAX_COUNT + 1 }, (_, index) => ({
      localId: `source-${index}`, kind: "CODE_REFERENCE" as const, authority: "INFORMATIVE" as const,
      label: `Source ${index}`,
    }));
    const expectationClaims = Array.from({ length: AUTHORING_DRAFT_EXPECTATION_MAX_COUNT + 1 }, (_, index) => ({
      localId: `claim-${index}`, testCaseLocalId: "case-1",
      target: { kind: "TOOL_ASSERTION" as const, assertionId: "created" },
      statement: `Expectation ${index}`, rationale: "Bounded claim", confidence: "LOW" as const,
      sourceRefs: [], reviewPriority: "NORMAL" as const,
    }));

    expect(automationDraftDefinitionSchema.safeParse({ ...definition, sourceRefs }).success).toBe(false);
    expect(automationDraftDefinitionSchema.safeParse({ ...definition, expectationClaims }).success).toBe(false);
  });

  it("rejects an assertion that exists only in a different test case", () => {
    const definition = validDefinition();
    definition.testCases.push({ ...definition.testCases[0]!, localId: "case-2", name: "Second",
      assertions: [{ id: "other-assertion", source: "MCP_RESULT", path: "$.orderId", operator: "EXISTS" }] });

    const parsed = automationDraftDefinitionSchema.safeParse({ ...definition,
      expectationClaims: [{ localId: "claim-1", testCaseLocalId: "case-1",
        target: { kind: "TOOL_ASSERTION", assertionId: "other-assertion" },
        statement: "The other assertion passes.", rationale: "It must remain test-local.", confidence: "HIGH",
        sourceRefs: [], reviewPriority: "NORMAL" }],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(expect.objectContaining({
        path: ["expectationClaims", 0, "target"],
        message: "Draft expectation target does not resolve to exactly one assertion in its test case",
      }));
    }
  });

  it("resolves Scenario step, Scenario, and cleanup expectation targets exactly", () => {
    const step = (id: string, assertionId: string) => ({ id, name: id, target: { connectionId, toolName: "create_order" },
      fixedArguments: {}, mappings: [], extractors: [], assertions: [{ id: assertionId, source: "MCP_RESULT" as const,
        path: "$.ok", operator: "EXISTS" as const }], condition: null, polling: null, argumentTransform: null,
      onFailure: "STOP" as const });
    const definition = {
      version: 1, testCases: [{ localId: "scenario-1", kind: "scenario", name: "Order lifecycle", description: "",
        tags: [], inputs: [], steps: [step("create", "created")], cleanupSteps: [step("cleanup", "deleted")],
        assertions: [{ id: "complete", source: "VARIABLE", path: "$.done", operator: "EXISTS" }], failurePolicy: "STOP" }],
      suites: [], sourceAssets: [], evidence: [], sourceRefs: [],
      expectationClaims: [
        { localId: "step-claim", testCaseLocalId: "scenario-1",
          target: { kind: "STEP_ASSERTION", stepId: "create", assertionId: "created" },
          statement: "The create step succeeds.", rationale: "The lifecycle must start.", confidence: "HIGH", sourceRefs: [], reviewPriority: "NORMAL" },
        { localId: "scenario-claim", testCaseLocalId: "scenario-1",
          target: { kind: "SCENARIO_ASSERTION", assertionId: "complete" },
          statement: "The lifecycle completes.", rationale: "The final state is required.", confidence: "HIGH", sourceRefs: [], reviewPriority: "NORMAL" },
        { localId: "cleanup-claim", testCaseLocalId: "scenario-1",
          target: { kind: "CLEANUP_ASSERTION", stepId: "cleanup", assertionId: "deleted" },
          statement: "Cleanup removes the order.", rationale: "Tests must leave no order behind.", confidence: "MEDIUM", sourceRefs: [], reviewPriority: "REQUIRED" },
      ],
    };

    expect(automationDraftDefinitionSchema.safeParse(definition).success).toBe(true);
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
