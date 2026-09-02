import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { JsonObject, JsonValue } from "../../shared/tool-definition.js";
import {
  parseSandboxMessage,
  type SandboxMessage,
} from "../../shared/script-workflow.js";

export type ScriptPhase = "before" | "after";
export type ScriptErrorCode = Extract<SandboxMessage, { type: "failed" }>["error"]["code"];

export interface ScriptLogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: JsonValue;
  line: number | null;
  column: number | null;
}

export interface ScriptRunResult {
  arguments: JsonObject;
  variables: JsonObject;
  stagedEnvironment: Array<{
    scope: "project" | "server";
    name: string;
    value: JsonValue;
    secret: boolean;
  }>;
  logs: ScriptLogEntry[];
}

export interface ScriptRunInput {
  evaluationId: string;
  phase: ScriptPhase;
  source: string;
  arguments: JsonObject;
  response: JsonValue | null;
  variables: JsonObject;
  environment: JsonObject;
  limits?: Partial<ScriptLimits>;
  onToolCall?: (
    input: { server: string; name: string; arguments: JsonObject },
    signal: AbortSignal,
  ) => Promise<JsonValue>;
  /** Internal syntax-only mode. The guest default export is compiled but never invoked. */
  validateOnly?: boolean;
  signal?: AbortSignal;
}

export interface ScriptLimits {
  timeoutMs: number;
  memoryBytes: number;
  stackBytes: number;
  maxLogs: number;
  maxLogBytes: number;
  maxToolCalls: number;
}

export interface ScriptRunnerOptions {
  workerUrl?: URL;
  execArgv?: string[];
}

export interface ScriptRunner {
  readonly activeCount: number;
  run(input: ScriptRunInput): Promise<ScriptRunResult>;
  close(): Promise<void>;
}

const DEFAULT_LIMITS: ScriptLimits = {
  timeoutMs: 5_000,
  memoryBytes: 32 * 1024 * 1024,
  stackBytes: 512 * 1024,
  maxLogs: 100,
  maxLogBytes: 64 * 1024,
  maxToolCalls: 20,
};

export class ScriptExecutionError extends Error {
  readonly code: ScriptErrorCode;
  readonly phase: ScriptPhase;
  readonly line: number | null;
  readonly column: number | null;
  readonly excerpt: string | null;

  constructor(error: Extract<SandboxMessage, { type: "failed" }>["error"]) {
    super(error.message);
    this.name = "ScriptExecutionError";
    this.code = error.code;
    this.phase = error.phase;
    this.line = error.line;
    this.column = error.column;
    this.excerpt = error.excerpt;
  }
}

function internalError(phase: ScriptPhase, message: string): ScriptExecutionError {
  return new ScriptExecutionError({
    code: "INTERNAL",
    message,
    phase,
    line: null,
    column: null,
    excerpt: null,
  });
}

function boundaryError(
  phase: ScriptPhase,
  code: "IPC_INVALID" | "CALL_LIMIT" | "OUTPUT_LIMIT",
  message: string,
): ScriptExecutionError {
  return new ScriptExecutionError({
    code,
    message,
    phase,
    line: null,
    column: null,
    excerpt: null,
  });
}

export function createScriptRunner(options: ScriptRunnerOptions = {}): ScriptRunner {
  const sourceRuntime = fileURLToPath(import.meta.url).endsWith(".ts");
  const workerUrl = options.workerUrl ?? (sourceRuntime
    ? new URL("./script-worker.ts", import.meta.url)
    : new URL("./workflows/script-worker.js", import.meta.url));
  const workerExecArgv = options.execArgv ?? (sourceRuntime ? ["--import", "tsx"] : undefined);
  const children = new Set<ChildProcess>();
  let closed = false;

  const terminate = async (child: ChildProcess): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const fallback = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 250);
      fallback.unref();
      child.once("exit", () => {
        clearTimeout(fallback);
        resolve();
      });
      child.kill("SIGTERM");
    });
  };

  return {
    get activeCount() {
      return children.size;
    },

    async run(input): Promise<ScriptRunResult> {
      if (closed) throw internalError(input.phase, "Script runner is closed");
      const limits = { ...DEFAULT_LIMITS, ...input.limits };
      const child = fork(fileURLToPath(workerUrl), [], {
        execArgv: workerExecArgv,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        serialization: "json",
        env: {
          NODE_ENV: process.env.NODE_ENV ?? "production",
        },
      });
      children.add(child);

      return await new Promise<ScriptRunResult>((resolve, reject) => {
        const logs: ScriptLogEntry[] = [];
        const hostCalls = new AbortController();
        const pendingHostCalls = new Set<string>();
        let hostCallCount = 0;
        let logBytes = 0;
        let settled = false;
        const hardTimeout = setTimeout(() => {
          finish(() => reject(new ScriptExecutionError({
            code: "TIMEOUT",
            message: `Script exceeded ${limits.timeoutMs} ms`,
            phase: input.phase,
            line: null,
            column: null,
            excerpt: null,
          })));
        }, limits.timeoutMs + 5_000);
        hardTimeout.unref();

        const cleanup = (): void => {
          clearTimeout(hardTimeout);
          hostCalls.abort();
          children.delete(child);
          child.removeAllListeners();
          input.signal?.removeEventListener("abort", abortEvaluation);
          void terminate(child);
        };
        const finish = (callback: () => void): void => {
          if (settled) return;
          settled = true;
          cleanup();
          callback();
        };
        const abortEvaluation = (): void => {
          finish(() => reject(new ScriptExecutionError({
            code: "CANCELLED",
            message: "Script execution was cancelled",
            phase: input.phase,
            line: null,
            column: null,
            excerpt: null,
          })));
        };
        input.signal?.addEventListener("abort", abortEvaluation, { once: true });
        if (input.signal?.aborted) {
          abortEvaluation();
          return;
        }

        child.on("message", (raw: unknown) => {
          let messageBytes: number;
          try {
            messageBytes = Buffer.byteLength(JSON.stringify(raw));
          } catch {
            finish(() => reject(boundaryError(input.phase, "IPC_INVALID", "Invalid sandbox response")));
            return;
          }
          if (messageBytes > limits.memoryBytes) {
            finish(() => reject(boundaryError(input.phase, "OUTPUT_LIMIT", "Script output limit exceeded")));
            return;
          }
          let message: SandboxMessage;
          try {
            message = parseSandboxMessage(raw);
          } catch {
            finish(() => reject(boundaryError(input.phase, "IPC_INVALID", "Invalid sandbox response")));
            return;
          }
          if (message.type === "log") {
            const bytes = Buffer.byteLength(message.message) +
              (message.data === undefined ? 0 : Buffer.byteLength(JSON.stringify(message.data)));
            logBytes += bytes;
            if (logs.length >= limits.maxLogs || logBytes > limits.maxLogBytes) {
              finish(() => reject(boundaryError(input.phase, "OUTPUT_LIMIT", "Script log limit exceeded")));
              return;
            }
            logs.push({
              level: message.level,
              message: message.message,
              ...(message.data === undefined ? {} : { data: message.data }),
              line: message.line,
              column: message.column,
            });
            return;
          }
          if (message.type === "host-call") {
            hostCallCount += 1;
            if (hostCallCount > limits.maxToolCalls) {
              finish(() => reject(boundaryError(input.phase, "CALL_LIMIT", "Script Tool call limit exceeded")));
              return;
            }
            if (pendingHostCalls.has(message.requestId)) {
              finish(() => reject(boundaryError(input.phase, "IPC_INVALID", "Duplicate sandbox request ID")));
              return;
            }
            pendingHostCalls.add(message.requestId);
            const reply = (result: SandboxMessage): void => {
              if (!settled && pendingHostCalls.delete(message.requestId) && child.connected) child.send(result);
            };
            if (!input.onToolCall) {
              reply({
                version: 1,
                type: "host-result",
                requestId: message.requestId,
                ok: false,
                error: {
                  code: "HOST_CALL_FAILED",
                  message: "Tool calls are not available for this script",
                  phase: input.phase,
                  line: null,
                  column: null,
                  excerpt: null,
                },
              });
              return;
            }
            void input.onToolCall(message.input, hostCalls.signal).then(
              (value) => reply({
                version: 1,
                type: "host-result",
                requestId: message.requestId,
                ok: true,
                value,
              }),
              () => reply({
                version: 1,
                type: "host-result",
                requestId: message.requestId,
                ok: false,
                error: {
                  code: "HOST_CALL_FAILED",
                  message: "Tool call failed",
                  phase: input.phase,
                  line: null,
                  column: null,
                  excerpt: null,
                },
              }),
            );
            return;
          }
          if (message.type === "completed") {
            if (pendingHostCalls.size > 0) {
              finish(() => reject(boundaryError(input.phase, "IPC_INVALID", "Sandbox completed with pending host calls")));
              return;
            }
            finish(() => resolve({
              arguments: message.arguments,
              variables: message.variables,
              stagedEnvironment: message.stagedEnvironment,
              logs,
            }));
            return;
          }
          if (message.type === "failed") {
            finish(() => reject(new ScriptExecutionError(message.error)));
            return;
          }
          finish(() => reject(boundaryError(input.phase, "IPC_INVALID", "Unexpected sandbox message direction")));
        });
        child.once("error", () => {
          finish(() => reject(internalError(input.phase, "Unable to start script sandbox")));
        });
        child.once("exit", (code, signal) => {
          finish(() => reject(internalError(
            input.phase,
            code === 0 && signal === null
              ? "Script sandbox exited without a result"
              : "Script sandbox terminated unexpectedly",
          )));
        });

        const start: SandboxMessage = {
          version: 1,
          type: "start",
          operation: input.validateOnly === true ? "validate" : "execute",
          evaluationId: input.evaluationId,
          phase: input.phase,
          source: input.source,
          arguments: input.arguments,
          response: input.response,
          variables: input.variables,
          environment: input.environment,
          limits,
        };
        child.send(start, (error) => {
          if (error) finish(() => reject(internalError(input.phase, "Unable to initialize script sandbox")));
        });
      });
    },

    async close(): Promise<void> {
      closed = true;
      await Promise.all([...children].map(terminate));
      children.clear();
    },
  };
}
