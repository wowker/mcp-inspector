import { randomUUID } from "node:crypto";
import type { JsonObject, JsonValue } from "../../shared/tool-definition.js";
import {
  workflowDebugInputSchema,
  type WorkflowDebugResult,
} from "../../shared/script-workflow.js";
import type { ConnectionService } from "../connections/connection-service.js";
import type { EnvironmentService } from "../environment/environment-service.js";
import type { RunServiceWithEvents } from "../runs/run-service.js";
import type { ToolService } from "../tools/tool-service.js";
import { createScriptRunner, ScriptExecutionError, type ScriptRunner } from "./script-runner.js";

export class InvalidWorkflowDebugError extends Error {
  constructor() { super("Workflow debug payload is invalid"); this.name = "InvalidWorkflowDebugError"; }
}

export interface WorkflowDebugService {
  run(projectId: string, connectionId: string, toolName: string, input: unknown, signal?: AbortSignal): Promise<WorkflowDebugResult>;
  close(): Promise<void>;
}

function secretStrings(environment: { project: Record<string, JsonValue>; server: Record<string, JsonValue>; secretNames: string[] }): string[] {
  return environment.secretNames.flatMap((name) => {
    const value = Object.hasOwn(environment.server, name) ? environment.server[name] : environment.project[name];
    if (value === undefined || value === null) return [];
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    return serialized.length === 0 ? [] : [serialized];
  }).sort((left, right) => right.length - left.length);
}

function redact(value: JsonValue, secrets: string[]): JsonValue {
  if (typeof value === "string") return secrets.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value);
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secrets)]));
  return value;
}

function containsSecret(value: JsonValue, secrets: string[]): boolean {
  if (secrets.length === 0) return false;
  const serialized = JSON.stringify(value);
  return secrets.some((secret) => serialized.includes(secret));
}

export function createWorkflowDebugService(deps: {
  connections: ConnectionService;
  tools: ToolService;
  environment: EnvironmentService;
  runs: RunServiceWithEvents;
  scriptRunner?: ScriptRunner;
}): WorkflowDebugService {
  const runner = deps.scriptRunner ?? createScriptRunner();
  return {
    async run(projectId, connectionId, toolName, raw, signal) {
      const parsed = workflowDebugInputSchema.safeParse(raw);
      if (!parsed.success) throw new InvalidWorkflowDebugError();
      deps.tools.get(projectId, connectionId, toolName);
      const environment = deps.environment.resolve(projectId, connectionId);
      const secrets = secretStrings(environment);
      let helperOrdinal = 0;
      let result: Awaited<ReturnType<ScriptRunner["run"]>>;
      try {
        result = await runner.run({
        evaluationId: randomUUID(), phase: parsed.data.phase, source: parsed.data.source,
        arguments: parsed.data.arguments, response: parsed.data.response, variables: {},
        environment: { project: environment.project, server: environment.server, execution: {} },
        limits: { timeoutMs: parsed.data.timeoutMs }, signal,
        onToolCall: async (input, callSignal) => {
          const connection = input.server === "current"
            ? deps.connections.get(projectId, connectionId)
            : deps.connections.list(projectId).find((item) => item.id === input.server || item.name === input.server);
          if (connection === undefined) throw new Error("Helper Server is not available");
          const helper = deps.tools.get(projectId, connection.id, input.name);
          if (helper.tool.currentSnapshot.definition.annotations?.destructiveHint === true && parsed.data.allowDestructiveHelpers !== true) {
            throw new Error("Destructive helper Tool requires confirmation");
          }
          if (containsSecret(input.arguments, secrets)) {
            throw new Error("Secret environment values cannot be persisted as Tool arguments");
          }
          const run = deps.runs.startInvocation({ projectId, connectionId: connection.id, toolName: input.name,
            idempotencyKey: `debug:${randomUUID()}:${helperOrdinal++}`, arguments: input.arguments });
          const detail = await deps.runs.waitForTerminal(projectId, run.id, callSignal);
          if (detail.status !== "succeeded" || detail.response?.result === null || detail.response?.result === undefined) {
            throw new Error("Helper Tool call failed");
          }
          return detail.response.result as JsonValue;
        },
        });
      } catch (error) {
        if (error instanceof ScriptExecutionError) {
          throw new ScriptExecutionError({
            code: error.code, phase: error.phase, line: error.line, column: error.column,
            excerpt: error.excerpt === null ? null : redact(error.excerpt, secrets) as string,
            message: redact(error.message, secrets) as string,
          });
        }
        throw error;
      }
      return {
        phase: parsed.data.phase,
        arguments: redact(result.arguments, secrets) as JsonObject,
        variables: redact(result.variables, secrets) as JsonObject,
        stagedEnvironment: result.stagedEnvironment.map((item) => ({ ...item,
          value: item.secret ? "[REDACTED]" : redact(item.value, secrets) })),
        logs: result.logs.map((item) => ({ ...item,
          message: redact(item.message, secrets) as string,
          ...(item.data === undefined ? {} : { data: redact(item.data, secrets) }) })),
      };
    },
    close: () => runner.close(),
  };
}
