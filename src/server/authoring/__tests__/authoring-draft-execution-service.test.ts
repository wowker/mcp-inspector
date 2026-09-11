import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthoringToolCallDetail } from "../../../shared/authoring/calls.js";
import { createProjectService } from "../../projects/project-service.js";
import type { AuthoringCallService } from "../authoring-call-service.js";
import { createAuthoringDraftService } from "../authoring-draft-service.js";
import type { AuthoringDraftValidator } from "../authoring-draft-validator.js";
import {
  AuthoringDraftExecutionActiveError,
  AuthoringDraftExecutionConflictError,
  createAuthoringDraftExecutionService,
} from "../authoring-draft-execution-service.js";

const projectId = "00000000-0000-4000-8000-000000008001";
const connectionId = "00000000-0000-4000-8000-000000008002";
const validationDigest = "c".repeat(64);
const toolSchemaHash = "a".repeat(64);

describe("AuthoringDraftExecutionService", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture(callImplementation?: (input: Parameters<AuthoringCallService["call"]>[0], signal?: AbortSignal) =>
    Promise<AuthoringToolCallDetail>) {
    const dataRoot = mkdtempSync(join(tmpdir(), "authoring-draft-execution-"));
    roots.push(dataRoot);
    let id = 8_100;
    const createId = () => `00000000-0000-4000-8000-${String(id++).padStart(12, "0")}`;
    let tick = 0;
    const now = () => new Date(Date.parse("2026-09-10T00:00:00.000Z") + tick++ * 10);
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Draft execution");
    const defaultCall: AuthoringCallService["call"] = async (input) => ({
        id: createId(), projectId, connectionId: input.connectionId, toolName: input.toolName,
        toolSnapshotId: createId(), toolSchemaHash: input.toolSchemaHash, context: input.context,
        purpose: input.purpose, status: "SUCCEEDED", runId: createId(), idempotencyKey: input.idempotencyKey,
        arguments: input.arguments, mayHaveSideEffects: input.purpose !== "POLL",
        response: { structuredContent: { value: Number(input.arguments.value ?? 0) + 1 } }, error: null,
        createdAt: now().toISOString(), startedAt: now().toISOString(), completedAt: now().toISOString(), durationMs: 10,
      });
    const calls: Pick<AuthoringCallService, "call"> = { call: vi.fn(callImplementation ?? defaultCall) };
    const drafts = createAuthoringDraftService({ projects, calls: { get: vi.fn() },
      testCases: { get: vi.fn() }, testSuites: { get: vi.fn() }, createId, now });
    const validator: AuthoringDraftValidator = { validate: vi.fn(({
      draftId, revision,
    }: Parameters<AuthoringDraftValidator["validate"]>[0]) => {
      const draft = drafts.get(projectId, draftId);
      return { id: createId(), projectId, draftId, draftRevision: revision,
        definitionDigest: draft.definitionDigest,
        toolSchemaHashes: { [`${connectionId}:increment`]: toolSchemaHash }, validationDigest,
        status: "VALID" as const, issues: [], createdAt: now().toISOString() };
    }) };
    const service = createAuthoringDraftExecutionService({
      projects, drafts, validator, calls, resolveEnvironment: async () => undefined, createId, now,
    });
    const createDraft = (definition: Parameters<typeof drafts.replace>[0]["definition"]) => {
      const created = drafts.create({ projectId, goal: "Trial", idempotencyKey: `create-${createId()}` });
      const replaced = drafts.replace({ projectId, draftId: created.draftId, expectedRevision: 1,
        goal: "Trial", definition, idempotencyKey: `replace-${createId()}` });
      return { draftId: created.draftId, revision: replaced.revision, definitionDigest: replaced.definitionDigest };
    };
    return { projects, service, calls, validator, createDraft, createId, now };
  }

  function toolDefinition() {
    return { version: 1 as const, testCases: [{ localId: "case-1", kind: "tool" as const,
      name: "Increment", description: "", tags: [], target: { connectionId, toolName: "increment" },
      arguments: { value: 1 }, timeoutMs: 30_000,
      assertions: [{ id: "value", source: "MCP_RESULT" as const, path: "$.structuredContent.value",
        operator: "EQUALS" as const, expected: 2 }] }], suites: [], sourceAssets: [], evidence: [],
      sourceRefs: [], expectationClaims: [] };
  }

  it("returns immediately and persists the exact validated revision with expected and actual assertion values", async () => {
    const state = fixture();
    try {
      const draft = state.createDraft(toolDefinition());
      const started = state.service.start({ projectId, draftId: draft.draftId, revision: draft.revision,
        validationDigest, idempotencyKey: "trial-once", inputs: {} });
      expect(started).toMatchObject({ status: "QUEUED", draftRevision: draft.revision,
        definitionDigest: draft.definitionDigest });

      const completed = await state.service.waitForTerminal(projectId, started.id);
      expect(completed).toMatchObject({ status: "PASSED", validationDigest,
        testCases: [{ localId: "case-1", status: "PASSED", steps: [{ runId: expect.any(String) }],
          assertions: [{ assertionId: "value", status: "PASSED", expected: 2, actual: 2 }] }] });
      expect(state.validator.validate).toHaveBeenCalledWith({ projectId, draftId: draft.draftId, revision: draft.revision });
      expect(state.calls.call).toHaveBeenCalledWith(expect.objectContaining({
        context: { kind: "DRAFT", draftId: draft.draftId, draftRevision: draft.revision },
        toolSchemaHash, purpose: "ACTION",
      }), expect.any(AbortSignal));
    } finally { await state.service.close(); state.projects.close(); }
  });

  it("fails asynchronously when the requested validation digest is no longer current", async () => {
    const state = fixture();
    try {
      const draft = state.createDraft(toolDefinition());
      const execution = state.service.start({ projectId, draftId: draft.draftId, revision: draft.revision,
        validationDigest: "d".repeat(64), idempotencyKey: "stale-validation", inputs: {} });
      expect(execution.status).toBe("QUEUED");
      await expect(state.service.waitForTerminal(projectId, execution.id)).resolves.toMatchObject({
        status: "ERROR", error: { code: "DRAFT_VALIDATION_STALE" }, testCases: [],
      });
      expect(state.calls.call).not.toHaveBeenCalled();
    } finally { await state.service.close(); state.projects.close(); }
  });

  it("deduplicates one start intent, rejects conflicts, and permits only one active execution per Draft", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const state = fixture(async (input) => {
      await barrier;
      return { id: state.createId(), projectId, connectionId, toolName: input.toolName,
        toolSnapshotId: state.createId(), toolSchemaHash, context: input.context, purpose: input.purpose,
        status: "SUCCEEDED", runId: state.createId(), idempotencyKey: input.idempotencyKey,
        arguments: input.arguments, mayHaveSideEffects: false, response: {}, error: null,
        createdAt: state.now().toISOString(), startedAt: state.now().toISOString(),
        completedAt: state.now().toISOString(), durationMs: 1 };
    });
    try {
      const draft = state.createDraft(toolDefinition());
      const request = { projectId, draftId: draft.draftId, revision: draft.revision,
        validationDigest, idempotencyKey: "same", inputs: {} };
      const first = state.service.start(request);
      expect(state.service.start(request).id).toBe(first.id);
      expect(() => state.service.start({ ...request, inputs: { "case-1": { changed: true } } }))
        .toThrow(AuthoringDraftExecutionConflictError);
      expect(() => state.service.start({ ...request, idempotencyKey: "second" }))
        .toThrow(AuthoringDraftExecutionActiveError);
      release();
      await state.service.waitForTerminal(projectId, first.id);
    } finally { release(); await state.service.close(); state.projects.close(); }
  });

  it("runs scenario cleanup after failure and links it to the preceding Draft call", async () => {
    const state = fixture(async (input) => ({
      id: state.createId(), projectId, connectionId, toolName: input.toolName,
      toolSnapshotId: state.createId(), toolSchemaHash, context: input.context, purpose: input.purpose,
      status: input.purpose === "CLEANUP" ? "SUCCEEDED" : "FAILED", runId: state.createId(),
      idempotencyKey: input.idempotencyKey, arguments: input.arguments, mayHaveSideEffects: true,
      response: null, error: input.purpose === "CLEANUP" ? null : { code: "REMOTE_FAILED", message: "Remote failed" },
      createdAt: state.now().toISOString(), startedAt: state.now().toISOString(),
      completedAt: state.now().toISOString(), durationMs: 1,
    }));
    try {
      const definition = { version: 1 as const, testCases: [{ localId: "scenario-1", kind: "scenario" as const,
        name: "Cleanup", description: "", tags: [], inputs: [], assertions: [], failurePolicy: "STOP" as const,
        steps: [{ id: "write", name: "Write", target: { connectionId, toolName: "increment" },
          fixedArguments: { value: 1 }, mappings: [], extractors: [], assertions: [], condition: null,
          polling: null, argumentTransform: null, onFailure: "STOP" as const }],
        cleanupSteps: [{ id: "cleanup", name: "Cleanup", target: { connectionId, toolName: "increment" },
          fixedArguments: { value: 0 }, mappings: [], extractors: [], assertions: [], condition: null,
          polling: null, argumentTransform: null, onFailure: "CONTINUE" as const }] }],
        suites: [], sourceAssets: [], evidence: [], sourceRefs: [], expectationClaims: [] };
      const draft = state.createDraft(definition);
      const started = state.service.start({ projectId, draftId: draft.draftId, revision: draft.revision,
        validationDigest, idempotencyKey: "cleanup", inputs: {} });
      const completed = await state.service.waitForTerminal(projectId, started.id);
      expect(completed.status).toBe("FAILED");
      expect(vi.mocked(state.calls.call).mock.calls.map(([input]) => input.purpose)).toEqual(["ACTION", "CLEANUP"]);
      expect(vi.mocked(state.calls.call).mock.calls[1]?.[0].cleanupForCallId)
        .toBe(vi.mocked(state.calls.call).mock.results[0]?.value instanceof Promise
          ? (await vi.mocked(state.calls.call).mock.results[0]!.value).id : undefined);
    } finally { await state.service.close(); state.projects.close(); }
  });

  it("cancels business work, still attempts cleanup, and fences late completion", async () => {
    let startedCall!: () => void;
    const began = new Promise<void>((resolve) => { startedCall = resolve; });
    const state = fixture(async (input, signal) => {
      if (input.purpose !== "CLEANUP") {
        startedCall();
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
      }
      return { id: state.createId(), projectId, connectionId, toolName: input.toolName,
        toolSnapshotId: state.createId(), toolSchemaHash, context: input.context, purpose: input.purpose,
        status: input.purpose === "CLEANUP" ? "SUCCEEDED" : "CANCELLED", runId: state.createId(),
        idempotencyKey: input.idempotencyKey, arguments: input.arguments, mayHaveSideEffects: true,
        response: null, error: input.purpose === "CLEANUP" ? null : { code: "CALL_CANCELLED", message: "Cancelled" },
        createdAt: state.now().toISOString(), startedAt: state.now().toISOString(),
        completedAt: state.now().toISOString(), durationMs: 1 };
    });
    try {
      const definition = toolDefinition();
      definition.testCases = [] as never;
      const scenario = { version: 1 as const, testCases: [{ localId: "scenario-1", kind: "scenario" as const,
        name: "Cancel", description: "", tags: [], inputs: [], assertions: [], failurePolicy: "STOP" as const,
        steps: [{ id: "write", name: "Write", target: { connectionId, toolName: "increment" }, fixedArguments: { value: 1 },
          mappings: [], extractors: [], assertions: [], condition: null, polling: null, argumentTransform: null, onFailure: "STOP" as const }],
        cleanupSteps: [{ id: "cleanup", name: "Cleanup", target: { connectionId, toolName: "increment" }, fixedArguments: { value: 0 },
          mappings: [], extractors: [], assertions: [], condition: null, polling: null, argumentTransform: null, onFailure: "CONTINUE" as const }] }],
        suites: [], sourceAssets: [], evidence: [], sourceRefs: [], expectationClaims: [] };
      const draft = state.createDraft(scenario);
      const execution = state.service.start({ projectId, draftId: draft.draftId, revision: draft.revision,
        validationDigest, idempotencyKey: "cancel", inputs: {} });
      await began;
      expect(state.service.cancel(projectId, execution.id)).toBe(true);
      const completed = await state.service.waitForTerminal(projectId, execution.id);
      expect(completed.status).toBe("CANCELLED");
      await state.service.close();
      expect(vi.mocked(state.calls.call).mock.calls.map(([input]) => input.purpose)).toEqual(["ACTION", "CLEANUP"]);
      expect(state.service.get(projectId, execution.id).status).toBe("CANCELLED");
    } finally { await state.service.close(); state.projects.close(); }
  });

  it("cancels and persists active Draft executions when the service shuts down", async () => {
    let startedCall!: () => void;
    const began = new Promise<void>((resolve) => { startedCall = resolve; });
    const state = fixture(async (input, signal) => {
      startedCall();
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
      return { id: state.createId(), projectId, connectionId, toolName: input.toolName,
        toolSnapshotId: state.createId(), toolSchemaHash, context: input.context, purpose: input.purpose,
        status: "CANCELLED", runId: state.createId(), idempotencyKey: input.idempotencyKey,
        arguments: input.arguments, mayHaveSideEffects: false, response: null,
        error: { code: "CALL_CANCELLED", message: "Cancelled" }, createdAt: state.now().toISOString(),
        startedAt: state.now().toISOString(), completedAt: state.now().toISOString(), durationMs: 1 };
    });
    try {
      const draft = state.createDraft(toolDefinition());
      const execution = state.service.start({ projectId, draftId: draft.draftId, revision: draft.revision,
        validationDigest, idempotencyKey: "shutdown", inputs: {} });
      await began;
      await state.service.close();
      expect(state.service.get(projectId, execution.id)).toMatchObject({ status: "CANCELLED",
        testCases: [expect.objectContaining({ status: "CANCELLED" })] });
    } finally { await state.service.close(); state.projects.close(); }
  });

  it("marks active executions interrupted when a project is recovered after restart", async () => {
    const state = fixture();
    try {
      const draft = state.createDraft(toolDefinition());
      state.projects.open(projectId).database.prepare(`INSERT INTO authoring_draft_executions
        (id, project_id, draft_id, draft_revision, definition_digest, idempotency_key, request_hash,
         status, inputs_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'RUNNING_STEPS', ?, ?)`)
        .run(state.createId(), projectId, draft.draftId, draft.revision, draft.definitionDigest,
          "before-restart", "d".repeat(64), JSON.stringify({ validationDigest, testInputs: {} }),
          state.now().toISOString());
      const recovered = createAuthoringDraftExecutionService({ projects: state.projects,
        drafts: { get: vi.fn() }, validator: { validate: vi.fn() }, calls: { call: vi.fn() },
        resolveEnvironment: async () => undefined, createId: state.createId, now: state.now });
      const rows = state.projects.open(projectId).database.prepare(
        "SELECT status FROM authoring_draft_executions WHERE idempotency_key = 'before-restart'",
      ).all();
      expect(rows).toEqual([{ status: "RUNNING_STEPS" }]);
      recovered.list(projectId, { limit: 10 });
      expect(state.projects.open(projectId).database.prepare(
        "SELECT status FROM authoring_draft_executions WHERE idempotency_key = 'before-restart'",
      ).all()).toEqual([{ status: "INTERRUPTED" }]);
      await recovered.close();
    } finally { await state.service.close(); state.projects.close(); }
  });
});
