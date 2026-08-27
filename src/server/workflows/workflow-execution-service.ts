import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { JsonObject, JsonValue } from "../../shared/tool-definition.js";
import type { ConnectionService } from "../connections/connection-service.js";
import type { EnvironmentService, StagedEnvironmentMutation } from "../environment/environment-service.js";
import type { ProjectService } from "../projects/project-service.js";
import { RunValidationError, type RunServiceWithEvents } from "../runs/run-service.js";
import type { RunDetail } from "../runs/run-types.js";
import type { TabService } from "../tabs/tab-service.js";
import { ToolRepository } from "../tools/tool-repository.js";
import { canonicalJson } from "../tools/tool-service.js";
import { ScriptExecutionError, createScriptRunner, type ScriptRunner } from "./script-runner.js";
import type { WorkflowService } from "./workflow-service.js";
import {
  WorkflowExecutionRepository,
  type WorkflowExecutionDetail,
} from "./workflow-execution-repository.js";

const startSchema = z.object({
  projectId: z.uuid(), connectionId: z.uuid(), tabId: z.uuid(), idempotencyKey: z.string().min(1).max(200),
  arguments: z.record(z.string(), z.unknown()),
  allowDestructiveHelpers: z.boolean().optional(),
}).strict();
const terminal = new Set(["succeeded", "failed", "cancelled", "interrupted"]);

function secretStrings(environment: {
  project: Record<string, JsonValue>; server: Record<string, JsonValue>; secretNames: string[];
}): string[] {
  return environment.secretNames.flatMap((name) => {
    const value = Object.hasOwn(environment.server, name) ? environment.server[name] : environment.project[name];
    if (value === undefined || value === null) return [];
    if (typeof value === "string") return value.length === 0 ? [] : [value];
    return [JSON.stringify(value)];
  }).filter((value, index, values) => value.length > 0 && values.indexOf(value) === index)
    .sort((left, right) => right.length - left.length);
}

function redactText(value: string, secrets: string[]): string {
  return secrets.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value);
}

function redactJson(value: JsonValue, secrets: string[]): JsonValue {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactJson(item, secrets));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactJson(item, secrets)]));
  }
  const serialized = JSON.stringify(value);
  return secrets.includes(serialized) ? "[REDACTED]" : value;
}

function containsSecret(value: JsonValue, secrets: string[]): boolean {
  if (secrets.length === 0) return false;
  const serialized = JSON.stringify(value);
  return secrets.some((secret) => serialized.includes(secret));
}

function schemaIssueMessage(keyword: string): string {
  if (keyword === "required") return "请输入必填参数";
  if (keyword === "type") return "参数类型不符合 Tool Schema";
  if (keyword === "enum") return "请选择 Tool Schema 允许的值";
  if (keyword === "format") return "参数格式不符合 Tool Schema";
  if (keyword === "pattern") return "参数内容不符合格式约束";
  if (["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"].includes(keyword)) {
    return "参数数值超出允许范围";
  }
  if (["minLength", "maxLength"].includes(keyword)) return "参数长度不符合约束";
  return `参数不符合 ${keyword} 约束`;
}

function executionFailure(
  error: unknown,
  cancelled: boolean,
  afterBeforeScript: boolean,
): { code: string; message: string } {
  if (error instanceof ScriptExecutionError) return { code: error.code, message: error.message };
  if (cancelled) return { code: "CANCELLED", message: "Workflow execution was cancelled" };
  if (error instanceof RunValidationError) {
    const prefix = afterBeforeScript
      ? "前置脚本执行后的参数不符合 Tool Schema："
      : "参数不符合 Tool Schema：";
    const details = error.issues
      .map((issue) => `${issue.path || "/"} ${schemaIssueMessage(issue.keyword)}`)
      .join("；");
    return { code: "INVALID_ARGUMENTS", message: `${prefix}${details}`.slice(0, 2_000) };
  }
  return { code: "WORKFLOW_FAILED", message: "Workflow execution failed" };
}

export class InvalidWorkflowExecutionError extends Error {
  constructor(message = "Workflow execution payload is invalid") { super(message); this.name = "InvalidWorkflowExecutionError"; }
}
export class WorkflowExecutionNotFoundError extends Error {
  constructor() { super("Workflow execution not found"); this.name = "WorkflowExecutionNotFoundError"; }
}
export class WorkflowExecutionConflictError extends Error {
  constructor() { super("Workflow execution idempotency conflict"); this.name = "WorkflowExecutionConflictError"; }
}

export interface WorkflowExecutionService {
  start(input: unknown): WorkflowExecutionDetail;
  get(projectId: string, id: string): WorkflowExecutionDetail;
  activeForTab(projectId: string, tabId: string): WorkflowExecutionDetail | null;
  cancel(projectId: string, id: string): boolean;
  close(): Promise<void>;
}

interface ActiveExecution { controller: AbortController; allowDestructiveHelpers: boolean }

export function createWorkflowExecutionService(deps: {
  projects: ProjectService;
  connections: ConnectionService;
  tabs: TabService;
  workflows: WorkflowService;
  environment: EnvironmentService;
  runs: RunServiceWithEvents;
  scriptRunner?: ScriptRunner;
  createId?: () => string;
  now?: () => Date;
}): WorkflowExecutionService {
  const createId = deps.createId ?? randomUUID;
  const now = deps.now ?? (() => new Date());
  const runner = deps.scriptRunner ?? createScriptRunner();
  const active = new Map<string, ActiveExecution>();
  const operations = new Set<Promise<void>>();
  const recoveredProjects = new Set<string>();
  const timestamp = () => now().toISOString();
  const key = (projectId: string, id: string) => `${projectId}:${id}`;
  const repo = (projectId: string) => {
    const repository = new WorkflowExecutionRepository(deps.projects.open(projectId));
    if (!recoveredProjects.has(projectId)) {
      repository.interruptActive(projectId, timestamp());
      recoveredProjects.add(projectId);
    }
    return repository;
  };

  const get = (projectId: string, id: string): WorkflowExecutionDetail => {
    if (!z.uuid().safeParse(id).success) throw new WorkflowExecutionNotFoundError();
    const execution = repo(projectId).get(projectId, id);
    if (execution === null) throw new WorkflowExecutionNotFoundError();
    return execution;
  };

  const elapsed = (from: string, to: string): number => Math.max(0, Date.parse(to) - Date.parse(from));

  async function execute(projectId: string, id: string): Promise<void> {
    const current = active.get(key(projectId, id));
    if (current === undefined) return;
    const execution = get(projectId, id);
    const workflow = execution.workflowSnapshot as unknown as ReturnType<WorkflowService["get"]>;
    let argumentsValue = structuredClone(execution.initialArguments);
    let variables: JsonObject = {};
    let response: JsonValue | null = null;
    const staged: StagedEnvironmentMutation[] = [];
    let ordinal = 0;
    const environment = deps.environment.resolve(projectId, execution.connectionId);
    const secrets = secretStrings(environment);

    const runTool = async (
      phase: "helper-before" | "helper-after",
      input: { server: string; name: string; arguments: JsonObject },
      signal: AbortSignal,
    ): Promise<JsonValue> => {
      const connection = input.server === "current"
        ? deps.connections.get(projectId, execution.connectionId)
        : deps.connections.list(projectId).find((item) => item.id === input.server || item.name === input.server);
      if (connection === undefined) throw new Error("Helper Server is not available");
      const helper = new ToolRepository(deps.projects.open(projectId)).get(projectId, connection.id, input.name);
      if (helper === null || helper.tool.status === "removed") throw new Error("Helper Tool is not available");
      if (helper.tool.currentSnapshot.definition.annotations?.destructiveHint === true && !current.allowDestructiveHelpers) {
        throw new Error("Destructive helper Tool requires confirmation");
      }
      if (containsSecret(input.arguments, secrets)) {
        throw new Error("Secret environment values cannot be persisted as Tool arguments");
      }
      const run = deps.runs.startInvocation({
        projectId,
        connectionId: connection.id,
        toolName: input.name,
        idempotencyKey: `${id}:helper:${ordinal}`,
        arguments: input.arguments,
      });
      repo(projectId).linkRun(projectId, id, run.id, phase, ordinal++, timestamp());
      const detail = await deps.runs.waitForTerminal(projectId, run.id, signal);
      if (detail.status !== "succeeded" || detail.response?.result === null || detail.response?.result === undefined) {
        throw new Error("Helper Tool call failed");
      }
      return detail.response.result as JsonValue;
    };

    try {
      if (workflow.before.enabled) {
        repo(projectId).transition(projectId, id, ["queued"], "before", timestamp());
        const before = await runner.run({
          evaluationId: randomUUID(), phase: "before", source: workflow.before.source,
          arguments: argumentsValue, response: null, variables,
          environment: { project: environment.project, server: environment.server, execution: {} },
          limits: { timeoutMs: workflow.timeoutMs }, signal: current.controller.signal,
          onToolCall: (input, signal) => runTool("helper-before", input, signal),
        });
        argumentsValue = before.arguments;
        variables = before.variables;
        staged.push(...before.stagedEnvironment);
        for (const log of before.logs) {
          repo(projectId).append(projectId, id, "script-log", timestamp(), redactJson({ phase: "before", ...log }, secrets));
        }
      }

      repo(projectId).transition(projectId, id, workflow.before.enabled ? ["before"] : ["queued"], "main", timestamp());
      if (containsSecret(argumentsValue, secrets)) {
        throw new Error("Secret environment values cannot be persisted as Tool arguments");
      }
      const main = deps.runs.start({
        projectId,
        connectionId: execution.connectionId,
        tabId: execution.tabId!,
        idempotencyKey: `${id}:main`,
        arguments: argumentsValue,
      });
      repo(projectId).linkRun(projectId, id, main.id, "main", ordinal++, timestamp());
      const mainDetail: RunDetail = await deps.runs.waitForTerminal(projectId, main.id, current.controller.signal);
      response = (mainDetail.response?.result ?? null) as JsonValue | null;
      if (mainDetail.status !== "succeeded") throw new Error("Main Tool call failed");

      if (workflow.after.enabled) {
        repo(projectId).transition(projectId, id, ["main"], "after", timestamp());
        const after = await runner.run({
          evaluationId: randomUUID(), phase: "after", source: workflow.after.source,
          arguments: argumentsValue, response, variables,
          environment: { project: environment.project, server: environment.server, execution: {} },
          limits: { timeoutMs: workflow.timeoutMs }, signal: current.controller.signal,
          onToolCall: (input, signal) => runTool("helper-after", input, signal),
        });
        variables = after.variables;
        staged.push(...after.stagedEnvironment);
        for (const log of after.logs) {
          repo(projectId).append(projectId, id, "script-log", timestamp(), redactJson({ phase: "after", ...log }, secrets));
        }
      }

      deps.environment.commit(projectId, execution.connectionId, staged);
      const completedAt = timestamp();
      repo(projectId).finish(projectId, id, "succeeded", completedAt,
        elapsed(execution.createdAt, completedAt), redactJson(argumentsValue, secrets) as JsonObject,
        response === null ? null : redactJson(response, secrets), null);
    } catch (error) {
      const completedAt = timestamp();
      const cancelled = current.controller.signal.aborted ||
        (error instanceof ScriptExecutionError && error.code === "CANCELLED") ||
        (error instanceof DOMException && error.name === "AbortError");
      const failure = executionFailure(error, cancelled, workflow.before.enabled);
      repo(projectId).finish(projectId, id, cancelled ? "cancelled" : "failed", completedAt,
        elapsed(execution.createdAt, completedAt), redactJson(argumentsValue, secrets) as JsonObject,
        response === null ? null : redactJson(response, secrets), {
          code: failure.code,
          message: redactText(failure.message, secrets),
        });
    } finally {
      active.delete(key(projectId, id));
    }
  }

  return {
    start(raw) {
      const parsed = startSchema.safeParse(raw);
      if (!parsed.success) throw new InvalidWorkflowExecutionError();
      const input = parsed.data;
      const tab = deps.tabs.get(input.projectId, input.tabId);
      if (tab.connectionId !== input.connectionId) {
        throw new InvalidWorkflowExecutionError("Workflow Tab belongs to a different connection");
      }
      const workflow = deps.workflows.get(input.projectId, tab.connectionId, tab.toolName);
      if (!workflow.before.enabled && !workflow.after.enabled) throw new InvalidWorkflowExecutionError("Tool workflow is disabled");
      const tool = new ToolRepository(deps.projects.open(input.projectId)).get(input.projectId, tab.connectionId, tab.toolName);
      if (tool === null || tool.tool.status === "removed") throw new InvalidWorkflowExecutionError("Tool is not available");
      const id = createId();
      if (!z.uuid().safeParse(id).success) throw new Error("Workflow execution ID generator returned an invalid UUID");
      const createdAt = timestamp();
      const result = repo(input.projectId).create({
        id, projectId: input.projectId, connectionId: tab.connectionId, tabId: tab.id, toolName: tab.toolName,
        toolSnapshotId: tool.tool.currentSnapshot.id, idempotencyKey: input.idempotencyKey,
        initialArguments: input.arguments as JsonObject, workflowSnapshot: workflow as unknown as JsonObject, createdAt,
      });
      if (!result.created) {
        if (result.execution.tabId !== tab.id || result.execution.toolSnapshotId !== tool.tool.currentSnapshot.id ||
            canonicalJson(result.execution.initialArguments) !== canonicalJson(input.arguments)) {
          throw new WorkflowExecutionConflictError();
        }
        return result.execution;
      }
      active.set(key(input.projectId, id), {
        controller: new AbortController(), allowDestructiveHelpers: input.allowDestructiveHelpers === true,
      });
      queueMicrotask(() => {
        const operation = execute(input.projectId, id).catch(() => undefined);
        operations.add(operation);
        void operation.finally(() => operations.delete(operation));
      });
      return result.execution;
    },
    get,
    activeForTab(projectId, tabId) {
      if (!z.uuid().safeParse(tabId).success) throw new WorkflowExecutionNotFoundError();
      return repo(projectId).activeForTab(projectId, tabId);
    },
    cancel(projectId, id) {
      const execution = get(projectId, id);
      if (terminal.has(execution.status)) return false;
      const running = active.get(key(projectId, id));
      running?.controller.abort();
      return running !== undefined;
    },
    async close() {
      for (const execution of active.values()) execution.controller.abort();
      await Promise.allSettled([...operations]);
      await runner.close();
      active.clear();
    },
  };
}
