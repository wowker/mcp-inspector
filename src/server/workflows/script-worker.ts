import { randomUUID } from "node:crypto";
import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";
import type {
  QuickJSContext,
  QuickJSDeferredPromise,
  QuickJSHandle,
  QuickJSRuntime,
} from "quickjs-emscripten-core";
import {
  parseSandboxMessage,
  type SandboxMessage,
} from "../../shared/script-workflow.js";
import type { JsonObject, JsonValue } from "../../shared/tool-definition.js";

type StartMessage = Extract<SandboxMessage, { type: "start" }>;
type ScriptError = Extract<SandboxMessage, { type: "failed" }>["error"];

function send(message: SandboxMessage): void {
  if (process.connected) process.send?.(message);
}

function sourceLocation(value: unknown): { line: number | null; column: number | null } {
  if (typeof value !== "object" || value === null) return { line: null, column: null };
  const stack = "stack" in value && typeof value.stack === "string" ? value.stack : "";
  const match = /workflow-script\.mjs:(\d+):(\d+)/.exec(stack);
  return match
    ? { line: Number(match[1]), column: Number(match[2]) }
    : { line: null, column: null };
}

function toScriptError(start: StartMessage, value: unknown): ScriptError {
  const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const name = typeof record.name === "string" ? record.name : "Error";
  const rawMessage = typeof record.message === "string" ? record.message : "Script execution failed";
  const interrupted = rawMessage.toLowerCase().includes("interrupted");
  const memoryLimited = /out of memory|memory limit/i.test(rawMessage);
  const stackLimited = /stack overflow|stack size/i.test(rawMessage);
  const syntax = name === "SyntaxError";
  const forbiddenModule = /module|import/i.test(rawMessage) && /load|resolve|dynamic/i.test(rawMessage);
  const forbiddenCapability = forbiddenModule || rawMessage === "Forbidden object path";
  const location = sourceLocation(value);
  return {
    code: interrupted ? "TIMEOUT" : memoryLimited ? "MEMORY_LIMIT" : stackLimited ? "STACK_LIMIT" : syntax ? "SYNTAX_ERROR" : forbiddenCapability ? "FORBIDDEN_CAPABILITY" : "RUNTIME_ERROR",
    message: interrupted
      ? `Script exceeded ${start.limits.timeoutMs} ms`
      : memoryLimited
        ? "Script exceeded its memory limit"
        : stackLimited
          ? "Script exceeded its stack limit"
      : syntax
        ? "Script contains invalid JavaScript"
        : forbiddenModule
          ? "Module imports are not available in scripts"
          : rawMessage.slice(0, 2_000),
    phase: start.phase,
    line: location.line,
    column: location.column,
    excerpt: null,
  };
}

function bootstrap(start: StartMessage): string {
  const serialized = JSON.stringify({
    arguments: start.arguments,
    response: start.response,
    variables: start.variables,
    environment: start.environment,
  });
  return `
    (() => {
      "use strict";
      const initial = ${serialized};
      const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
      const clone = (value) => {
        if (value === undefined) return undefined;
        const text = JSON.stringify(value);
        if (text === undefined) throw new TypeError("Only JSON values are supported");
        return JSON.parse(text);
      };
      const freeze = (value) => {
        if (value && typeof value === "object" && !Object.isFrozen(value)) {
          Object.freeze(value);
          for (const child of Object.values(value)) freeze(child);
        }
        return value;
      };
      const parts = (path) => {
        if (typeof path !== "string" || path.trim() === "") throw new TypeError("Path must be a non-empty string");
        const normalized = path.trim()
          .replace(/^\\$\\.?/, "")
          .replace(/\\[(\\d+)\\]/g, ".$1")
          .replace(/\\[['\"]([^'\"]+)['\"]\\]/g, ".$1");
        const result = normalized.split(".").filter(Boolean);
        if (result.some((key) => forbiddenKeys.has(key))) throw new Error("Forbidden object path");
        return result;
      };
      const get = (root, path) => parts(path).reduce((value, key) => value == null ? undefined : value[key], root);
      const set = (root, path, value) => {
        const keys = parts(path);
        let cursor = root;
        keys.slice(0, -1).forEach((key, index) => {
          const nextKey = keys[index + 1];
          if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = /^\\d+$/.test(nextKey) ? [] : {};
          cursor = cursor[key];
        });
        cursor[keys[keys.length - 1]] = clone(value);
      };
      const remove = (root, path) => {
        const keys = parts(path);
        const parent = keys.slice(0, -1).reduce((value, key) => value == null ? undefined : value[key], root);
        if (parent && typeof parent === "object") {
          if (Array.isArray(parent) && /^\\d+$/.test(keys[keys.length - 1])) parent.splice(Number(keys[keys.length - 1]), 1);
          else delete parent[keys[keys.length - 1]];
        }
      };
      const state = {
        arguments: clone(initial.arguments),
        variables: clone(initial.variables),
        environment: clone(initial.environment),
        stagedEnvironment: [],
      };
      const canMutateArguments = ${JSON.stringify(start.phase === "before")};
      const requireBefore = () => {
        if (!canMutateArguments) throw new Error("After scripts cannot modify completed request arguments");
      };
      const log = (level, message, data) => __hostLog(level, String(message), data);
      const ctx = {
        arguments: Object.freeze({
          get: (path) => clone(get(state.arguments, path)),
          set: (path, value) => { requireBefore(); set(state.arguments, path, value); },
          remove: (path) => { requireBefore(); remove(state.arguments, path); },
          all: () => clone(state.arguments),
        }),
        response: freeze(clone(initial.response)),
        variables: Object.freeze({
          get: (name) => clone(state.variables[name]),
          set: (name, value) => { state.variables[name] = clone(value); },
          remove: (name) => { delete state.variables[name]; },
          all: () => clone(state.variables),
        }),
        env: Object.freeze({
          get: (name, options = {}) => {
            const scope = options.scope;
            if (scope && state.environment[scope] && typeof state.environment[scope] === "object") {
              return clone(state.environment[scope][name]);
            }
            for (const candidate of ["execution", "server", "project"]) {
              if (state.environment[candidate] && Object.prototype.hasOwnProperty.call(state.environment[candidate], name)) {
                return clone(state.environment[candidate][name]);
              }
            }
            return clone(state.environment[name]);
          },
          set: (name, value, options = {}) => {
            const scope = options.scope || "execution";
            if (!["execution", "project", "server"].includes(scope)) throw new TypeError("Environment scope is invalid");
            if (scope !== "execution") {
              state.stagedEnvironment.push({ scope, name: String(name), value: clone(value), secret: options.secret === true });
            }
            state.environment[name] = clone(value);
          },
        }),
        tools: Object.freeze({
          call: (input) => __hostToolCall({
            server: input && input.server,
            name: input && input.name,
            arguments: clone(input && input.arguments || {}),
          }),
        }),
        json: Object.freeze({
          get: (value, path) => clone(get(value, path)),
          parse: (value) => JSON.parse(value),
        }),
        assert: Object.freeze({
          equal: (actual, expected, message = "Values are not equal") => { if (actual !== expected) throw new Error(message); },
          exists: (value, message = "Value does not exist") => { if (value === undefined || value === null) throw new Error(message); },
          notEmpty: (value, message = "Value is empty") => {
            if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) throw new Error(message);
          },
          match: (value, pattern, message = "Value does not match") => { if (!(new RegExp(pattern)).test(value)) throw new Error(message); },
          true: (value, message = "Value is not true") => { if (value !== true) throw new Error(message); },
          deepEqual: (actual, expected, message = "Values are not deeply equal") => {
            if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
          },
        }),
        log: Object.freeze({
          debug: (message, data) => log("debug", message, data),
          info: (message, data) => log("info", message, data),
          warn: (message, data) => log("warn", message, data),
          error: (message, data) => log("error", message, data),
          inspect: (message, data) => log("info", message, data),
        }),
      };
      globalThis.__workflowContext = Object.freeze(ctx);
      globalThis.__workflowResult = () => clone({
        arguments: state.arguments,
        variables: state.variables,
        stagedEnvironment: state.stagedEnvironment,
      });
      globalThis.console = Object.freeze({
        debug: ctx.log.debug,
        log: ctx.log.info,
        info: ctx.log.info,
        warn: ctx.log.warn,
        error: ctx.log.error,
      });
      const constructors = [
        (() => {}).constructor,
        (async () => {}).constructor,
        (function* () {}).constructor,
        (async function* () {}).constructor,
      ];
      for (const ctor of constructors) {
        try { Object.defineProperty(ctor.prototype, "constructor", { value: undefined }); } catch {}
      }
      Object.defineProperty(globalThis, "eval", { value: undefined, configurable: false, writable: false });
      Object.defineProperty(globalThis, "Function", { value: undefined, configurable: false, writable: false });
    })();
  `;
}

let acceptHostResult: ((message: Extract<SandboxMessage, { type: "host-result" }>) => void) | undefined;

function jsonHandle(vm: QuickJSContext, value: JsonValue): QuickJSHandle {
  return unwrap(vm, vm.evalCode(`(${JSON.stringify(value)})`, "host-result.json"));
}

function installToolCaller(vm: QuickJSContext, runtime: QuickJSRuntime, start: StartMessage): void {
  const pending = new Map<string, QuickJSDeferredPromise>();
  let callCount = 0;
  const caller = vm.newFunction("__hostToolCall", (inputHandle) => {
    callCount += 1;
    if (callCount > start.limits.maxToolCalls) {
      return { error: vm.newError({ name: "CallLimitError", message: "Script Tool call limit exceeded" }) };
    }
    const input = vm.dump(inputHandle) as Record<string, unknown>;
    if (
      typeof input !== "object" || input === null
      || typeof input.server !== "string" || input.server.trim() === ""
      || typeof input.name !== "string" || input.name.trim() === ""
      || typeof input.arguments !== "object" || input.arguments === null || Array.isArray(input.arguments)
    ) {
      return { error: vm.newError({ name: "TypeError", message: "tools.call requires server, name and object arguments" }) };
    }
    const requestId = randomUUID();
    const deferred = vm.newPromise();
    pending.set(requestId, deferred);
    send({
      version: 1,
      type: "host-call",
      requestId,
      capability: "tools.call",
      input: {
        server: input.server,
        name: input.name,
        arguments: input.arguments as JsonObject,
      },
    });
    return deferred.handle;
  });
  vm.setProp(vm.global, "__hostToolCall", caller);
  caller.dispose();

  acceptHostResult = (message) => {
    const deferred = pending.get(message.requestId);
    if (!deferred) return;
    pending.delete(message.requestId);
    if (message.ok && message.value !== undefined) {
      const value = jsonHandle(vm, message.value);
      deferred.resolve(value);
      value.dispose();
    } else {
      const error = vm.newError({
        name: "HostCallError",
        message: message.error?.message ?? "Tool call failed",
      });
      deferred.reject(error);
      error.dispose();
    }
    runtime.executePendingJobs();
    deferred.dispose();
  };
}

function installLogger(vm: QuickJSContext, start: StartMessage): void {
  let logCount = 0;
  let logBytes = 0;
  const logger = vm.newFunction("__hostLog", (levelHandle, messageHandle, dataHandle) => {
    const level = vm.getString(levelHandle) as "debug" | "info" | "warn" | "error";
    const message = vm.getString(messageHandle);
    const data = dataHandle === undefined ? undefined : vm.dump(dataHandle) as JsonValue;
    const bytes = Buffer.byteLength(message) + (data === undefined ? 0 : Buffer.byteLength(JSON.stringify(data)));
    logCount += 1;
    logBytes += bytes;
    if (logCount > start.limits.maxLogs || logBytes > start.limits.maxLogBytes) {
      return { error: vm.newError({ name: "OutputLimitError", message: "Script log limit exceeded" }) };
    }
    send({
      version: 1,
      type: "log",
      level,
      message,
      ...(data === undefined ? {} : { data }),
      line: null,
      column: null,
    });
    return vm.undefined;
  });
  vm.setProp(vm.global, "__hostLog", logger);
  logger.dispose();
}

function unwrap(vm: QuickJSContext, result: ReturnType<QuickJSContext["evalCode"]>): QuickJSHandle {
  if (result.error !== undefined) {
    const dumped = vm.dump(result.error);
    result.error.dispose();
    throw dumped;
  }
  return result.value;
}

async function evaluate(start: StartMessage): Promise<void> {
  const QuickJS = await getQuickJS();
  let runtime: QuickJSRuntime | undefined;
  let vm: QuickJSContext | undefined;
  try {
    runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(start.limits.memoryBytes);
    runtime.setMaxStackSize(start.limits.stackBytes);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + start.limits.timeoutMs));
    vm = runtime.newContext();
    installLogger(vm, start);
    installToolCaller(vm, runtime, start);

    unwrap(vm, vm.evalCode(bootstrap(start), "workflow-bootstrap.js")).dispose();
    const namespace = unwrap(vm, vm.evalCode(start.source, "workflow-script.mjs", { type: "module" }));
    const fn = vm.getProp(namespace, "default");
    namespace.dispose();
    if (vm.typeof(fn) !== "function") {
      fn.dispose();
      throw { name: "TypeError", message: "Script must export a default function" };
    }
    if (start.operation === "validate") {
      fn.dispose();
      send({
        version: 1,
        type: "completed",
        arguments: start.arguments,
        variables: start.variables,
        stagedEnvironment: [],
      });
      return;
    }
    const context = vm.getProp(vm.global, "__workflowContext");
    const call = vm.callFunction(fn, vm.undefined, context);
    context.dispose();
    fn.dispose();
    const promiseHandle = call.error !== undefined
      ? (() => { const dumped = vm!.dump(call.error); call.error.dispose(); throw dumped; })()
      : call.value;
    const resolvedPromise = vm.resolvePromise(promiseHandle);
    runtime.executePendingJobs();
    const resolved = await resolvedPromise;
    promiseHandle.dispose();
    if (resolved.error !== undefined) {
      const dumped = vm.dump(resolved.error);
      resolved.error.dispose();
      throw dumped;
    }
    resolved.value.dispose();

    const stateHandle = unwrap(vm, vm.evalCode("JSON.stringify(globalThis.__workflowResult())"));
    const state = JSON.parse(vm.getString(stateHandle)) as {
      arguments: JsonObject;
      variables: JsonObject;
      stagedEnvironment: Extract<SandboxMessage, { type: "completed" }>["stagedEnvironment"];
    };
    stateHandle.dispose();
    send({ version: 1, type: "completed", ...state });
  } catch (error) {
    send({ version: 1, type: "failed", error: toScriptError(start, error) });
  } finally {
    acceptHostResult = undefined;
    try { vm?.dispose(); } catch {}
    try { runtime?.dispose(); } catch {}
  }
}

let started = false;
process.on("message", (raw: unknown) => {
  let message: SandboxMessage;
  try {
    message = parseSandboxMessage(raw);
  } catch {
    process.exitCode = 1;
    process.disconnect?.();
    return;
  }
  if (message.type === "host-result") {
    acceptHostResult?.(message);
    return;
  }
  if (started || message.type !== "start") return;
  started = true;
  void evaluate(message).finally(() => {
    process.disconnect?.();
  });
});
