import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { validateArguments, type SchemaIssue } from "../../shared/json-schema.js";
import {
  authoringCallToolInputSchema,
  authoringListToolCallsInputSchema,
  isJsonValue,
  type AuthoringCallStatus,
  type AuthoringCallToolInput,
  type AuthoringListToolCallsInput,
  type AuthoringToolCallPage,
  type AuthoringToolCallDetail,
} from "../../shared/authoring/calls.js";
import { AUTHORING_LIMITS } from "../../shared/authoring/protocol.js";
import type { JsonObject, JsonValue } from "../../shared/tool-definition.js";
import type { ProjectService } from "../projects/project-service.js";
import {
  RunToolSnapshotChangedError,
  type RunServiceWithEvents,
} from "../runs/run-service.js";
import type { RunDetail } from "../runs/run-types.js";
import type { ToolService } from "../tools/tool-service.js";
import { canonicalJson } from "../tools/tool-service.js";
import { AuthoringCallRepository, type StoredAuthoringCall } from "./authoring-call-repository.js";
import type { AuthoringPolicyService } from "./authoring-policy-service.js";
import { authoringBoundedLimit } from "./authoring-limits.js";
import {
  boundAuthoringValue,
  sanitizeAuthoringError,
  sanitizeAuthoringValue,
} from "./authoring-redaction.js";

const uuid = z.string().uuid();
const terminalCallStatuses = new Set<AuthoringCallStatus>([
  "SUCCEEDED", "FAILED", "UNKNOWN", "BLOCKED", "CANCELLED",
]);

export class AuthoringPolicyDeniedError extends Error {
  constructor() { super("Connection policy denies this Tool call"); this.name = "AuthoringPolicyDeniedError"; }
}
export class AuthoringToolSchemaChangedError extends Error {
  constructor() { super("Tool Schema changed"); this.name = "AuthoringToolSchemaChangedError"; }
}
export class AuthoringToolArgumentsError extends Error {
  constructor(readonly issues: SchemaIssue[]) { super("Tool arguments are invalid"); this.name = "AuthoringToolArgumentsError"; }
}
export class AuthoringCallIdempotencyConflictError extends Error {
  constructor() { super("Authoring call idempotency conflict"); this.name = "AuthoringCallIdempotencyConflictError"; }
}
export class AuthoringCallRateLimitError extends Error {
  constructor() { super("Authoring call rate limit reached"); this.name = "AuthoringCallRateLimitError"; }
}
export class AuthoringCallConcurrencyError extends Error {
  constructor() { super("Authoring call concurrency limit reached"); this.name = "AuthoringCallConcurrencyError"; }
}
export class AuthoringCallGlobalLimitError extends Error {
  constructor() { super("Global Authoring call limit reached"); this.name = "AuthoringCallGlobalLimitError"; }
}
export class AuthoringCallOutcomeUnknownError extends Error {
  constructor(readonly callId: string) {
    super("A matching non-idempotent call has an unresolved outcome");
    this.name = "AuthoringCallOutcomeUnknownError";
  }
}
export class AuthoringDraftContextError extends Error {
  constructor() { super("Authoring Draft context is invalid"); this.name = "AuthoringDraftContextError"; }
}
export class AuthoringCleanupContextError extends Error {
  constructor() { super("Authoring cleanup context is invalid"); this.name = "AuthoringCleanupContextError"; }
}
export class AuthoringCallNotFoundError extends Error {
  constructor() { super("Authoring call not found"); this.name = "AuthoringCallNotFoundError"; }
}
export class AuthoringCallShuttingDownError extends Error {
  constructor() { super("Authoring calls are shutting down"); this.name = "AuthoringCallShuttingDownError"; }
}

export interface AuthoringAuditEvent {
  requestId: string;
  callId: string | null;
  runId: string | null;
  projectId: string;
  connectionId: string;
  toolName: string;
  policyDecision: "ALLOWED" | "DENIED";
  status: AuthoringCallStatus;
  durationMs: number | null;
  errorCode: string | null;
  redactionCount: number;
  truncated: boolean;
}

export interface AuthoringCallService {
  call(input: AuthoringCallToolInput, signal?: AbortSignal): Promise<AuthoringToolCallDetail>;
  get(projectId: string, callId: string): AuthoringToolCallDetail;
  list(projectId: string, input?: Omit<AuthoringListToolCallsInput, "projectId">): AuthoringToolCallPage;
  close?(): Promise<void>;
}

function bounded(value: JsonValue, maximumBytes = AUTHORING_LIMITS.maxStructuredResponseBytes): JsonValue {
  return boundAuthoringValue(value, maximumBytes).value;
}

function mayHaveSideEffects(
  purpose: AuthoringCallToolInput["purpose"],
  annotations: Record<string, JsonValue> | undefined,
): boolean {
  return purpose === "SETUP" || purpose === "ACTION" || purpose === "CLEANUP" ||
    annotations?.readOnlyHint !== true || annotations.destructiveHint === true;
}

function runError(run: RunDetail, secrets: readonly string[]): { code: string; message: string } | null {
  if (run.response?.error !== null && run.response?.error !== undefined) {
    return sanitizeAuthoringError(run.response.error, secrets);
  }
  if (run.status === "failed") return { code: "CALL_FAILED", message: "Downstream Tool call failed" };
  if (run.status === "cancelled") return { code: "CALL_CANCELLED", message: "Downstream Tool call was cancelled" };
  if (run.status === "interrupted") return { code: "CALL_INTERRUPTED", message: "Downstream Tool call was interrupted" };
  return null;
}

function terminalStatus(call: StoredAuthoringCall, run: RunDetail): Exclude<AuthoringCallStatus, "PENDING" | "RUNNING"> {
  if (run.status === "succeeded") return "SUCCEEDED";
  if (call.mayHaveSideEffects && run.startedAt !== null &&
      (run.status === "cancelled" || run.status === "interrupted" || run.response?.error?.code === "CALL_TIMEOUT" ||
       run.response?.error?.code === "MCP_CALL_FAILED")) return "UNKNOWN";
  if (run.status === "cancelled") return "CANCELLED";
  return "FAILED";
}

function responseSummary(run: RunDetail): JsonObject | null {
  if (run.response === null) return null;
  const result = run.response.result;
  return {
    status: run.status,
    truncated: run.response.truncated,
    originalBytes: run.response.originalBytes,
    isError: typeof result === "object" && result !== null && !Array.isArray(result) &&
      (result as Record<string, unknown>).isError === true,
  };
}

export function createAuthoringCallService(options: {
  projects: ProjectService;
  policies: AuthoringPolicyService;
  tools: ToolService;
  runs: RunServiceWithEvents;
  createId?: () => string;
  now?: () => Date;
  resolveSecrets?: (projectId: string, connectionId: string) => string[];
  maxGlobalCalls?: number;
  audit?: (event: AuthoringAuditEvent) => void;
}): AuthoringCallService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const maxGlobalCalls = authoringBoundedLimit(options.maxGlobalCalls, AUTHORING_LIMITS.maxGlobalCalls,
    AUTHORING_LIMITS.maxGlobalCalls, "Authoring global call limit");
  let activeCalls = 0;
  let acceptingCalls = true;
  const activeControllers = new Set<AbortController>();
  const activeSettlements = new Set<Promise<void>>();
  const repository = (projectId: string) => new AuthoringCallRepository(options.projects.open(projectId));

  function secrets(projectId: string, connectionId: string): string[] {
    return options.resolveSecrets?.(projectId, connectionId) ?? [];
  }

  function responseFor(call: StoredAuthoringCall): JsonValue | null {
    if (call.runId === null) return null;
    const run = options.runs.getRedacted(call.projectId, call.runId);
    const value = run.response?.result;
    return value === null || value === undefined
      ? null
      : bounded(sanitizeAuthoringValue(value, secrets(call.projectId, call.connectionId)).value, 512 * 1024);
  }

  function detail(call: StoredAuthoringCall): AuthoringToolCallDetail {
    return {
      id: call.id, projectId: call.projectId, connectionId: call.connectionId,
      toolName: call.toolName, toolSnapshotId: call.toolSnapshotId, toolSchemaHash: call.toolSchemaHash,
      context: call.context, purpose: call.purpose, status: call.status, runId: call.runId,
      idempotencyKey: call.idempotencyKey, arguments: bounded(call.arguments, 256 * 1024) as JsonObject,
      mayHaveSideEffects: call.mayHaveSideEffects, response: responseFor(call), error: call.error,
      createdAt: call.createdAt, startedAt: call.startedAt, completedAt: call.completedAt,
      durationMs: call.durationMs,
    };
  }

  function assertDraftContext(input: AuthoringCallToolInput): void {
    if (input.context.kind !== "DRAFT") return;
    const exists = options.projects.open(input.projectId).database.prepare(`SELECT 1
      FROM authoring_draft_revisions r JOIN authoring_drafts d
        ON d.project_id = r.project_id AND d.id = r.draft_id
      WHERE r.project_id = ? AND r.draft_id = ? AND r.revision = ? AND d.state = 'ACTIVE'`)
      .get(input.projectId, input.context.draftId, input.context.draftRevision);
    if (exists === undefined) throw new AuthoringDraftContextError();
  }

  function assertCleanupContext(input: AuthoringCallToolInput): void {
    if (input.cleanupForCallId === undefined) return;
    if (input.purpose !== "CLEANUP" || input.context.kind !== "DRAFT") throw new AuthoringCleanupContextError();
    const original = repository(input.projectId).get(input.projectId, input.cleanupForCallId);
    if (original === null || original.context.kind !== "DRAFT" ||
        original.context.draftId !== input.context.draftId) throw new AuthoringCleanupContextError();
  }

  async function waitForExisting(call: StoredAuthoringCall, signal?: AbortSignal): Promise<AuthoringToolCallDetail> {
    if (terminalCallStatuses.has(call.status)) return detail(call);
    if (call.runId === null) return detail(call);
    try { await options.runs.waitForTerminal(call.projectId, call.runId, signal); } catch { /* Read terminal state below. */ }
    const run = options.runs.getRedacted(call.projectId, call.runId);
    const finished = repository(call.projectId).finish({
      projectId: call.projectId, callId: call.id, status: terminalStatus(call, run),
      summary: responseSummary(run), error: runError(run, secrets(call.projectId, call.connectionId)),
      completedAt: run.completedAt ?? now().toISOString(), durationMs: run.durationMs ?? 0,
    });
    return detail(finished);
  }

  return {
    async call(rawInput, signal) {
      if (!acceptingCalls) throw new AuthoringCallShuttingDownError();
      const input = authoringCallToolInputSchema.parse(rawInput);
      const { idempotencyKey: _idempotencyKey, ...requestIdentity } = input;
      const canonicalRequest = canonicalJson(requestIdentity);
      if (Buffer.byteLength(canonicalRequest, "utf8") > AUTHORING_LIMITS.maxRequestBytes) {
        throw new AuthoringToolArgumentsError([{
          path: "", keyword: "maxBytes", message: "Arguments exceed the Authoring request limit",
        }]);
      }
      const policy = options.policies.get(input.projectId, input.connectionId);
      if (!options.policies.isToolAllowed(input.projectId, input.connectionId, input.toolName)) {
        options.audit?.({ requestId: randomUUID(), callId: null,
          runId: null, projectId: input.projectId, connectionId: input.connectionId, toolName: input.toolName,
          policyDecision: "DENIED", status: "BLOCKED", durationMs: 0, errorCode: "AUTHORING_POLICY_DENIED",
          redactionCount: 0, truncated: false });
        throw new AuthoringPolicyDeniedError();
      }
      const requestHash = createHash("sha256").update(canonicalRequest).digest("hex");
      const existing = repository(input.projectId).findByIdempotency(input.projectId, input.idempotencyKey);
      if (existing !== null) {
        if (existing.requestHash !== requestHash) throw new AuthoringCallIdempotencyConflictError();
        return waitForExisting(existing, signal);
      }
      const unresolved = repository(input.projectId).findUnknownByRequestHash(input.projectId, requestHash);
      if (unresolved !== null) throw new AuthoringCallOutcomeUnknownError(unresolved.id);
      const tool = options.tools.get(input.projectId, input.connectionId, input.toolName).tool;
      if (tool.status === "removed" || tool.currentSnapshot.contentHash !== input.toolSchemaHash) {
        throw new AuthoringToolSchemaChangedError();
      }
      const issues = validateArguments(tool.currentSnapshot.definition.inputSchema, input.arguments);
      if (issues.length > 0) throw new AuthoringToolArgumentsError(issues);
      assertDraftContext(input);
      assertCleanupContext(input);
      if (activeCalls >= maxGlobalCalls) throw new AuthoringCallGlobalLimitError();

      const createdAtDate = now();
      const secretValues = secrets(input.projectId, input.connectionId);
      const argumentSanitization = sanitizeAuthoringValue(input.arguments, secretValues);
      const sanitizedArguments = argumentSanitization.value;
      if (!isJsonValue(sanitizedArguments) || typeof sanitizedArguments !== "object" || sanitizedArguments === null || Array.isArray(sanitizedArguments)) {
        throw new AuthoringToolArgumentsError([]);
      }
      const callId = createId();
      if (!uuid.safeParse(callId).success) throw new Error("Authoring call ID generator returned an invalid UUID");
      const claimed = repository(input.projectId).claim({
        id: callId, projectId: input.projectId, context: input.context,
        connectionId: input.connectionId, toolName: input.toolName,
        toolSnapshotId: tool.currentSnapshot.id, toolSchemaHash: input.toolSchemaHash,
        purpose: input.purpose, cleanupForCallId: input.cleanupForCallId ?? null,
        idempotencyKey: input.idempotencyKey, requestHash,
        sanitizedArgumentsJson: canonicalJson(sanitizedArguments),
        mayHaveSideEffects: mayHaveSideEffects(input.purpose, tool.currentSnapshot.definition.annotations),
        createdAt: createdAtDate.toISOString(),
        rateWindowStart: new Date(createdAtDate.getTime() - 60_000).toISOString(),
        maxCallsPerMinute: policy.maxCallsPerMinute,
        maxConcurrentCalls: policy.maxConcurrentCalls,
      });
      if (claimed.kind === "rate-limited") throw new AuthoringCallRateLimitError();
      if (claimed.kind === "concurrency-limited") throw new AuthoringCallConcurrencyError();
      if (claimed.kind === "existing") {
        if (claimed.call.requestHash !== requestHash) throw new AuthoringCallIdempotencyConflictError();
        return waitForExisting(claimed.call, signal);
      }

      activeCalls += 1;
      const call = claimed.call;
      const internalController = new AbortController();
      activeControllers.add(internalController);
      const effectiveSignal = signal === undefined ? internalController.signal
        : AbortSignal.any([signal, internalController.signal]);
      let settle!: () => void;
      const settlement = new Promise<void>((resolve) => { settle = resolve; });
      activeSettlements.add(settlement);
      try {
        let run;
        try {
          run = options.runs.startInvocation({
            projectId: input.projectId, connectionId: input.connectionId, toolName: input.toolName,
            idempotencyKey: `authoring-call:${call.id}`, arguments: input.arguments,
            timeoutMs: policy.maxCallDurationMs, expectedToolSnapshotId: tool.currentSnapshot.id,
          });
        } catch (error) {
          const blocked = repository(input.projectId).finish({
            projectId: input.projectId, callId: call.id, status: "BLOCKED", summary: null,
            error: { code: error instanceof RunToolSnapshotChangedError ? "TOOL_SCHEMA_CHANGED" : "CALL_FAILED",
              message: error instanceof RunToolSnapshotChangedError ? "Tool Schema changed" : "Tool call could not start" },
            completedAt: now().toISOString(), durationMs: 0,
          });
          options.audit?.({ requestId: call.id, callId: call.id, runId: null, projectId: call.projectId,
            connectionId: call.connectionId, toolName: call.toolName, policyDecision: "ALLOWED",
            status: blocked.status, durationMs: 0, errorCode: blocked.error?.code ?? null,
            redactionCount: argumentSanitization.redactionCount, truncated: argumentSanitization.truncated });
          if (error instanceof RunToolSnapshotChangedError) throw new AuthoringToolSchemaChangedError();
          return detail(blocked);
        }
        repository(input.projectId).markRunning(input.projectId, call.id, run.id, now().toISOString());
        try { await options.runs.waitForTerminal(input.projectId, run.id, effectiveSignal); }
        catch { /* Cancellation makes the Run terminal before rejecting the wait. */ }
        const terminalRun = options.runs.getRedacted(input.projectId, run.id);
        const currentCall = repository(input.projectId).get(input.projectId, call.id)!;
        const status = terminalStatus(currentCall, terminalRun);
        const finished = repository(input.projectId).finish({
          projectId: input.projectId, callId: call.id, status,
          summary: responseSummary(terminalRun), error: runError(terminalRun, secretValues),
          completedAt: terminalRun.completedAt ?? now().toISOString(), durationMs: terminalRun.durationMs ?? 0,
        });
        const responseSanitization = terminalRun.response?.result === undefined
          ? { value: null, redactionCount: 0, truncated: false }
          : sanitizeAuthoringValue(terminalRun.response.result, secretValues);
        const argumentOutputTruncated = boundAuthoringValue(sanitizedArguments, 256 * 1024).truncated;
        const responseOutputTruncated = terminalRun.response?.result === undefined ? false
          : boundAuthoringValue(responseSanitization.value, 512 * 1024).truncated;
        options.audit?.({ requestId: call.id, callId: call.id, runId: run.id, projectId: call.projectId,
          connectionId: call.connectionId, toolName: call.toolName, policyDecision: "ALLOWED",
          status: finished.status, durationMs: finished.durationMs, errorCode: finished.error?.code ?? null,
          redactionCount: argumentSanitization.redactionCount + responseSanitization.redactionCount,
          truncated: argumentSanitization.truncated || responseSanitization.truncated || argumentOutputTruncated ||
            responseOutputTruncated || terminalRun.response?.truncated === true });
        return detail(finished);
      } finally {
        activeCalls -= 1;
        activeControllers.delete(internalController);
        settle();
        activeSettlements.delete(settlement);
      }
    },
    get(projectId, callId) {
      const call = repository(projectId).get(projectId, callId);
      if (call === null) throw new AuthoringCallNotFoundError();
      return detail(call);
    },
    list(projectId, rawInput = {}) {
      const { projectId: _projectId, ...input } = authoringListToolCallsInputSchema.parse({ projectId, ...rawInput });
      const page = repository(projectId).list(projectId, input);
      return {
        items: page.items.map((call) => ({
          callId: call.id,
          projectId: call.projectId,
          connectionId: call.connectionId,
          toolName: call.toolName,
          context: call.context,
          purpose: call.purpose,
          status: call.status,
          runId: call.runId,
          mayHaveSideEffects: call.mayHaveSideEffects,
          createdAt: call.createdAt,
          startedAt: call.startedAt,
          completedAt: call.completedAt,
          durationMs: call.durationMs,
        })),
        nextCursor: page.nextCursor,
      };
    },
    async close() {
      acceptingCalls = false;
      for (const controller of activeControllers) controller.abort();
      await Promise.allSettled([...activeSettlements]);
    },
  };
}
