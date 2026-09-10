import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectService } from "../../projects/project-service.js";
import { createAuthoringAssetService } from "../authoring-asset-service.js";
import { createAuthoringDraftService } from "../authoring-draft-service.js";
import { AuthoringDraftValidationStaleError, createAuthoringDraftValidator } from "../authoring-draft-validator.js";
import type { ToolService } from "../../tools/tool-service.js";
import type { AuthoringPolicyService } from "../authoring-policy-service.js";

const projectId = "00000000-0000-4000-8000-000000007001";
const connectionId = "00000000-0000-4000-8000-000000007002";
const assetId = "00000000-0000-4000-8000-000000007003";
const suiteId = "00000000-0000-4000-8000-000000007004";
const schemaHash = "c".repeat(64);

describe("Authoring Draft validation and asset discovery", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

  function fixture(options: { allowed?: boolean; cleanup?: boolean; sourceRevision?: number } = {}) {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-authoring-validation-"));
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Validation");
    let nextId = 7_100;
    const createId = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
    const formalCase = { id: assetId, projectId, revision: options.sourceRevision ?? 1, kind: "tool" as const,
      name: "Existing", description: "", tags: [], isEnabled: true,
      target: { connectionId, toolName: "read_tool" }, arguments: { a: 1, apiKey: "stored-secret" },
      assertions: [], timeoutMs: 30_000, createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z" };
    const formalSuite = { id: suiteId, projectId, revision: 1, name: "Suite", description: "", tags: [],
      members: [{ id: createId(), testCaseId: assetId, position: 0, isEnabled: true }],
      executionPolicy: { concurrency: 1, stopOnFailure: true },
      createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z" };
    const testCases = { get: vi.fn(() => formalCase) };
    const testSuites = { get: vi.fn(() => formalSuite) };
    const drafts = createAuthoringDraftService({ projects,
      calls: { get: vi.fn(() => { throw new Error("not used"); }) }, testCases, testSuites, createId });
    const toolGet = vi.fn((_projectId: string, _connectionId: string, toolName: string) => ({ tool: {
      projectId, connectionId, name: toolName, status: "current" as const, folderId: null,
      favorite: false, lastUsedAt: null, updatedAt: "2026-09-10T00:00:00.000Z",
      currentSnapshot: { id: createId(), projectId, connectionId, toolName, contentHash: schemaHash,
        definition: { name: toolName, annotations: { readOnlyHint: toolName === "read_tool" },
          inputSchema: { type: "object" as const, required: ["a"], properties: { a: { type: "number" } }, additionalProperties: false } },
        createdAt: "2026-09-10T00:00:00.000Z" },
    }, snapshots: [] }));
    const tools: Pick<ToolService, "get"> = { get: toolGet };
    const policies: Pick<AuthoringPolicyService, "get" | "isToolAllowed"> = {
      isToolAllowed: vi.fn(() => options.allowed ?? true),
      get: vi.fn(() => ({ projectId, connectionId, mode: "FULL_ACCESS" as const, allowedTools: [], deniedTools: [],
        requireCleanupForDraftMutations: options.cleanup ?? false, maxCallsPerMinute: 60,
        maxConcurrentCalls: 1, maxCallDurationMs: 30_000, revision: 1,
        createdAt: null, updatedAt: null })),
    };
    const validator = createAuthoringDraftValidator({ projects, drafts, tools, policies,
      testCases, testSuites, createId, now: () => new Date("2026-09-10T00:00:00.000Z") });
    const assets = createAuthoringAssetService({ projects, testCases, testSuites });
    cleanups.push(() => { projects.close(); rmSync(dataRoot, { recursive: true, force: true }); });
    return { projects, drafts, validator, assets, tools: { get: toolGet }, testCases };
  }

  function validToolDefinition() {
    return { version: 1 as const, testCases: [{ localId: "case-1", kind: "tool" as const,
      name: "Read", description: "", tags: [], target: { connectionId, toolName: "read_tool" },
      arguments: { a: 1 }, assertions: [{ id: "a", source: "MCP_RESULT" as const, path: "$.value",
        operator: "EQUALS" as const, expected: 1 }], timeoutMs: 30_000 }],
      suites: [], sourceAssets: [], evidence: [] };
  }

  function storedDraft(definition: ReturnType<typeof validToolDefinition>, key: string) {
    const state = fixture();
    const created = state.drafts.create({ projectId, goal: "Validate", idempotencyKey: `create-${key}` });
    const replaced = state.drafts.replace({ projectId, draftId: created.draftId, expectedRevision: 1,
      goal: "Validate", definition, idempotencyKey: `replace-${key}` });
    return { ...state, draftId: created.draftId, revision: replaced.revision };
  }

  it("binds a deterministic valid result to Draft identity, digest, and current Tool hashes without a call", () => {
    const { projects, validator, tools, draftId, revision } = storedDraft(validToolDefinition(), "valid");
    const result = validator.validate({ projectId, draftId, revision });
    expect(result).toMatchObject({ status: "VALID", draftId, draftRevision: revision,
      toolSchemaHashes: { [`${connectionId}:read_tool`]: schemaHash }, issues: [] });
    expect(tools.get).toHaveBeenCalledTimes(1);
    expect(projects.open(projectId).database.prepare(
      "SELECT definition_digest, validation_digest, status FROM authoring_draft_validations WHERE id = ?",
    ).get(result.id)).toEqual({ definition_digest: result.definitionDigest,
      validation_digest: result.validationDigest, status: "VALID" });
  });

  it.each([
    ["TOOL_ARGUMENTS_INVALID", () => { const value = validToolDefinition(); value.testCases[0]!.arguments = { a: "wrong" } as never; return value; }],
    ["INVALID_JSON_PATH", () => { const value = validToolDefinition(); value.testCases[0]!.assertions[0]!.path = "$.__proto__.x"; return value; }],
    ["ASSERTION_OPERAND_REQUIRED", () => { const value = validToolDefinition();
      const { expected: _expected, ...assertion } = value.testCases[0]!.assertions[0]!;
      value.testCases[0]!.assertions = [assertion as never]; return value; }],
    ["SECRET_LITERAL", () => { const value = validToolDefinition(); value.testCases[0]!.arguments = { a: 1, token: "secret" } as never; return value; }],
  ])("reports %s without invoking a downstream Tool", (code, build) => {
    const { validator, draftId, revision } = storedDraft(build(), String(code));
    const result = validator.validate({ projectId, draftId, revision });
    expect(result.status).toBe("INVALID");
    expect(result.issues.map((item) => item.code)).toContain(code);
  });

  it("reports policy, cleanup, and source revision conflicts", () => {
    const state = fixture({ allowed: false, cleanup: true, sourceRevision: 2 });
    const definition = { version: 1 as const, testCases: [{ localId: "case-1", kind: "scenario" as const,
      name: "Write", description: "", tags: [], inputs: [], assertions: [], failurePolicy: "STOP" as const,
      steps: [{ id: "write", name: "Write", target: { connectionId, toolName: "write_tool" },
        fixedArguments: { a: 1 }, mappings: [], extractors: [], assertions: [], condition: null,
        polling: null, argumentTransform: null, onFailure: "STOP" as const }], cleanupSteps: [] }], suites: [], evidence: [],
      sourceAssets: [{ draftLocalId: "case-1", kind: "TEST_CASE" as const, assetId, revision: 1 }] };
    const created = state.drafts.create({ projectId, goal: "", idempotencyKey: "create-conflicts" });
    const replaced = state.drafts.replace({ projectId, draftId: created.draftId, expectedRevision: 1,
      goal: "", definition, idempotencyKey: "replace-conflicts" });
    const result = state.validator.validate({ projectId, draftId: created.draftId, revision: replaced.revision });
    expect(result.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "AUTHORING_POLICY_DENIED", "CLEANUP_REQUIRED", "SOURCE_REVISION_CONFLICT",
    ]));
  });

  it("reports a stale argument transform digest at the exact step path", () => {
    const state = fixture();
    const definition = { version: 1 as const, testCases: [{ localId: "case-1", kind: "scenario" as const,
      name: "Transform", description: "", tags: [], inputs: [], assertions: [], failurePolicy: "STOP" as const,
      steps: [{ id: "step-1", name: "Step 1", target: { connectionId, toolName: "read_tool" },
        fixedArguments: { a: 1 }, mappings: [], extractors: [], assertions: [], condition: null, polling: null,
        argumentTransform: { source: "export default ({ mappedArguments }) => mappedArguments",
          sourceDigest: "0".repeat(64) }, onFailure: "STOP" as const }], cleanupSteps: [] }],
      suites: [], evidence: [], sourceAssets: [] };
    const created = state.drafts.create({ projectId, goal: "", idempotencyKey: "create-transform-digest" });
    const replaced = state.drafts.replace({ projectId, draftId: created.draftId, expectedRevision: 1,
      goal: "", definition, idempotencyKey: "replace-transform-digest" });

    const result = state.validator.validate({ projectId, draftId: created.draftId, revision: replaced.revision });

    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "ARGUMENT_TRANSFORM_DIGEST_MISMATCH",
      path: "definition.testCases[0].steps[0].argumentTransform.sourceDigest",
    }));
  });

  it("rejects stale validation requests before inspecting Tools", () => {
    const { validator, tools, draftId, revision } = storedDraft(validToolDefinition(), "stale");
    expect(() => validator.validate({ projectId, draftId, revision: revision - 1 }))
      .toThrow(AuthoringDraftValidationStaleError);
    expect(tools.get).not.toHaveBeenCalled();
  });

  it("lists bounded assets and returns exact-revision detail with sensitive literals redacted", () => {
    const { projects, assets } = fixture();
    projects.open(projectId).database.prepare(`INSERT INTO test_cases
      (id, project_id, kind, name, description, tags_json, revision, enabled, definition_json, created_at, updated_at)
      VALUES (?, ?, 'tool', 'Existing', '', '[]', 1, 1, '{}', ?, ?)`)
      .run(assetId, projectId, "2026-09-10T00:00:00.000Z", "2026-09-10T00:00:00.000Z");
    projects.open(projectId).database.prepare(`INSERT INTO test_suites
      (id, project_id, name, description, tags_json, revision, concurrency, stop_on_failure, created_at, updated_at)
      VALUES (?, ?, 'Suite', '', '[]', 1, 1, 1, ?, ?)`)
      .run(suiteId, projectId, "2026-09-10T00:00:01.000Z", "2026-09-10T00:00:01.000Z");
    const page = assets.list(projectId, { limit: 1 });
    expect(page.items).toEqual([expect.objectContaining({ id: suiteId, kind: "TEST_SUITE" })]);
    expect(assets.list(projectId, { limit: 1, cursor: page.nextCursor! }).items)
      .toEqual([expect.objectContaining({ id: assetId, kind: "TEST_CASE" })]);
    const detail = assets.get(projectId, "TEST_CASE", assetId, 1);
    expect(JSON.stringify(detail)).not.toContain("stored-secret");
    expect(detail).toMatchObject({ arguments: { apiKey: "[REDACTED]" } });
    expect(() => assets.get(projectId, "TEST_CASE", assetId, 2)).toThrow(/revision/i);
  });
});
