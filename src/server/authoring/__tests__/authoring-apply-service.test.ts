import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { createTestCaseService } from "../../testing/test-case-service.js";
import { createTestSuiteService } from "../../testing/test-suite-service.js";
import type { AutomationDraftDefinition } from "../../../shared/authoring/draft.js";
import { createAuthoringDraftService } from "../authoring-draft-service.js";
import type { AuthoringDraftValidator } from "../authoring-draft-validator.js";
import { AuthoringDraftValidationRepository } from "../authoring-draft-validation-repository.js";
import {
  AuthoringApplyConflictError,
  AuthoringApplyValidationError,
  createAuthoringApplyService,
} from "../authoring-apply-service.js";

const projectId = "00000000-0000-4000-8000-000000009001";
const connectionId = "00000000-0000-4000-8000-000000009002";
const validationDigest = "c".repeat(64);

describe("AuthoringApplyService", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture(options: { failAfterStage?: string; validationStatus?: "VALID" | "INVALID" } = {}) {
    const dataRoot = mkdtempSync(join(tmpdir(), "authoring-apply-")); roots.push(dataRoot);
    let id = 9_100;
    const createId = () => `00000000-0000-4000-8000-${String(id++).padStart(12, "0")}`;
    let tick = 0;
    const now = () => new Date(Date.parse("2026-09-10T00:00:00.000Z") + tick++ * 10);
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Apply");
    const connections = createConnectionService(projects, { createId: () => connectionId });
    connections.create(projectId, { name: "Server", url: "https://apply.example/mcp",
      transport: "streamable-http", authMode: "none", timeoutMs: 10_000 });
    const testCases = createTestCaseService(projects, { createId, now });
    const testSuites = createTestSuiteService(projects, { createId, now });
    const drafts = createAuthoringDraftService({ projects, calls: { get: vi.fn() }, testCases, testSuites, createId, now });
    const validator: AuthoringDraftValidator = { validate: vi.fn(({ draftId, revision }) => {
      const draft = drafts.get(projectId, draftId);
      const result = { id: createId(), projectId, draftId, draftRevision: revision,
        definitionDigest: draft.definitionDigest,
        toolSchemaHashes: { [`${connectionId}:read`]: "a".repeat(64) }, validationDigest,
        status: options.validationStatus ?? "VALID",
        issues: options.validationStatus === "INVALID"
          ? [{ code: "TOOL_SCHEMA_DRIFT", path: "definition.testCases[0].target", message: "Tool changed" }]
          : [],
        createdAt: now().toISOString() };
      return new AuthoringDraftValidationRepository(projects.open(projectId)).insert(result);
    }) };
    const service = createAuthoringApplyService({ projects, drafts, validator, testCases, testSuites,
      createId, now, afterStage: options.failAfterStage === undefined ? undefined : (stage) => {
        if (stage === options.failAfterStage) throw new Error(`Injected ${stage}`);
      } });
    const replace = (definition: Parameters<typeof drafts.replace>[0]["definition"], key: string) => {
      const created = drafts.create({ projectId, goal: "Apply", idempotencyKey: `create-${key}` });
      const current = drafts.replace({ projectId, draftId: created.draftId, expectedRevision: 1,
        goal: "Apply", definition, idempotencyKey: `replace-${key}` });
      return current;
    };
    return { projects, connections, testCases, testSuites, drafts, validator, service, replace };
  }

  function definition(): AutomationDraftDefinition {
    return { version: 1 as const, testCases: [{ localId: "case-1", kind: "tool" as const,
      name: "Read", description: "", tags: [], target: { connectionId, toolName: "read" },
      arguments: {}, assertions: [], timeoutMs: 30_000 }], suites: [{ localId: "suite-1", name: "Suite",
      description: "", tags: [], members: [{ localId: "member-1", testCaseLocalId: "case-1", position: 0,
        isEnabled: true }],
      executionPolicy: { concurrency: 1, stopOnFailure: true } }], sourceAssets: [], evidence: [],
      sourceRefs: [], expectationClaims: [] };
  }

  it("atomically creates disabled formal tests, suites, ordered members, and stable mappings", async () => {
    const state = fixture();
    try {
      const draft = state.replace(definition(), "new-assets");
      const result = state.service.apply({ projectId, draftId: draft.draftId,
        expectedRevision: draft.revision, validationDigest, idempotencyKey: "apply-new" });
      expect(result.assets).toEqual([
        expect.objectContaining({ draftLocalId: "case-1", kind: "TEST_CASE", revision: 1 }),
        expect.objectContaining({ draftLocalId: "suite-1", kind: "TEST_SUITE", revision: 1 }),
      ]);
      const caseMapping = result.assets[0]!;
      const suiteMapping = result.assets[1]!;
      expect(state.testCases.get(projectId, caseMapping.formalAssetId).isEnabled).toBe(false);
      expect(state.testSuites.get(projectId, suiteMapping.formalAssetId)).toMatchObject({
        members: [{ testCaseId: caseMapping.formalAssetId, position: 0, isEnabled: true }],
      });
      expect(state.drafts.get(projectId, draft.draftId).state).toBe("APPLIED");
    } finally { await state.connections.close(); state.projects.close(); }
  });

  it("updates exact source revisions while preserving existing test enablement", async () => {
    const state = fixture();
    try {
      const formal = state.testCases.create(projectId, { kind: "tool", name: "Existing", description: "", tags: [],
        isEnabled: true, target: { connectionId, toolName: "read" }, arguments: {}, assertions: [], timeoutMs: 30_000 });
      const authored = definition();
      authored.testCases[0]!.name = "Updated";
      authored.suites = [];
      authored.sourceAssets = [{ draftLocalId: "case-1", kind: "TEST_CASE" as const,
        assetId: formal.id, revision: formal.revision }];
      const draft = state.replace(authored, "update-source");
      const result = state.service.apply({ projectId, draftId: draft.draftId,
        expectedRevision: draft.revision, validationDigest, idempotencyKey: "apply-update" });
      expect(result.assets).toEqual([expect.objectContaining({ formalAssetId: formal.id, revision: 2 })]);
      expect(state.testCases.get(projectId, formal.id)).toMatchObject({ name: "Updated", revision: 2, isEnabled: true });
    } finally { await state.connections.close(); state.projects.close(); }
  });

  it("rejects validation drift and replays only the exact idempotent Apply request", async () => {
    const state = fixture();
    try {
      const draft = state.replace(definition(), "idempotency");
      expect(() => state.service.apply({ projectId, draftId: draft.draftId,
        expectedRevision: draft.revision, validationDigest: "d".repeat(64), idempotencyKey: "bad-validation" }))
        .toThrow(AuthoringApplyValidationError);
      const request = { projectId, draftId: draft.draftId, expectedRevision: draft.revision,
        validationDigest, idempotencyKey: "apply-once" };
      const first = state.service.apply(request);
      expect(state.service.apply(request)).toEqual(first);
      expect(() => state.service.apply({ ...request, expectedRevision: draft.revision + 1 }))
        .toThrow(AuthoringApplyConflictError);
      expect(() => state.service.apply({ ...request, idempotencyKey: "second-apply" }))
        .toThrow(AuthoringApplyConflictError);
    } finally { await state.connections.close(); state.projects.close(); }
  });

  it("blocks invalid revalidation and source assets that changed after Draft creation", async () => {
    const invalid = fixture({ validationStatus: "INVALID" });
    try {
      const draft = invalid.replace(definition(), "invalid-revalidation");
      expect(() => invalid.service.apply({ projectId, draftId: draft.draftId,
        expectedRevision: draft.revision, validationDigest, idempotencyKey: "apply-invalid" }))
        .toThrow(AuthoringApplyValidationError);
      expect(invalid.projects.open(projectId).database.prepare("SELECT count(*) AS count FROM test_cases").get())
        .toEqual({ count: 0 });
    } finally { await invalid.connections.close(); invalid.projects.close(); }

    const drifted = fixture();
    try {
      const formal = drifted.testCases.create(projectId, { kind: "tool", name: "Existing", description: "", tags: [],
        isEnabled: true, target: { connectionId, toolName: "read" }, arguments: {}, assertions: [], timeoutMs: 30_000 });
      const authored = definition();
      authored.suites = [];
      authored.sourceAssets = [{ draftLocalId: "case-1", kind: "TEST_CASE", assetId: formal.id,
        revision: formal.revision }];
      const draft = drifted.replace(authored, "source-drift");
      drifted.testCases.update(projectId, formal.id, { revision: formal.revision, definition: {
        kind: "tool", name: "Changed elsewhere", description: "", tags: [], isEnabled: true,
        target: { connectionId, toolName: "read" }, arguments: {}, assertions: [], timeoutMs: 30_000,
      } });
      expect(() => drifted.service.apply({ projectId, draftId: draft.draftId,
        expectedRevision: draft.revision, validationDigest, idempotencyKey: "apply-stale-source" }))
        .toThrow(AuthoringApplyValidationError);
    } finally { await drifted.connections.close(); drifted.projects.close(); }
  });

  it.each(["APPLY_CREATED", "TEST_CASES_WRITTEN", "SUITES_WRITTEN", "MAPPINGS_WRITTEN"])(
    "rolls back every formal write when %s fails",
    async (stage) => {
      const state = fixture({ failAfterStage: stage });
      try {
        const draft = state.replace(definition(), `rollback-${stage}`);
        expect(() => state.service.apply({ projectId, draftId: draft.draftId,
          expectedRevision: draft.revision, validationDigest, idempotencyKey: `apply-${stage}` })).toThrow(`Injected ${stage}`);
        const database = state.projects.open(projectId).database;
        expect(database.prepare("SELECT count(*) AS count FROM test_cases").get()).toEqual({ count: 0 });
        expect(database.prepare("SELECT count(*) AS count FROM test_suites").get()).toEqual({ count: 0 });
        expect(database.prepare("SELECT count(*) AS count FROM authoring_draft_apply_results").get()).toEqual({ count: 0 });
        expect(state.drafts.get(projectId, draft.draftId).state).toBe("ACTIVE");
      } finally { await state.connections.close(); state.projects.close(); }
    },
  );
});
