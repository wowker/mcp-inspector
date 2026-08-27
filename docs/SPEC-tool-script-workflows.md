# Spec: Tool Script Workflows

## Objective

Add optional JavaScript before/after scripts to a Tool debug Tab. A script can inspect and update the main Tool arguments, call other MCP Tools, extract JSON response values, keep execution-local variables, stage project/Server variables, assert outcomes, and emit durable structured logs. The feature must remain inert when no script is enabled and must not change the existing single-Run API, history, SSE, cancellation, saved-item, or Tab restoration contracts.

## Capability Map

| Module id | Responsibility | Depends on |
|---|---|---|
| `workflow-config` | Persist one versioned before script and one versioned after script per Tool | — |
| `environment-store` | Persist project/Server variables and protect secret values | — |
| `script-runtime` | Execute untrusted JavaScript in an isolated QuickJS child process and expose an allowlisted SDK | workflow-config |
| `workflow-execution` | Orchestrate before → main Tool → after and persist parent/child trace | script-runtime, environment-store |
| `workflow-ui` | Edit/debug scripts and inspect logs, argument diffs, calls, and variable changes | all previous modules |

Build order: `workflow-config`, `environment-store` → `script-runtime` → `workflow-execution` → `workflow-ui`.

## Approved Product Contract

### Script language

- JavaScript ES2022 with TypeScript declarations and editor completion.
- A script exports exactly one default async function:

```js
export default async function before(ctx) {
  const storeId = ctx.arguments.get("store_id");
  ctx.log.info("Resolving store", { storeId });
  const result = await ctx.tools.call({
    server: "current",
    name: "get_store",
    arguments: { store_id: storeId },
  });
  ctx.arguments.set("currency", ctx.json.get(result, "$.structuredContent.store.currency"));
}
```

- `import`, dynamic import, `require`, `eval`, `Function`, direct network, filesystem, OS process, database, browser storage, and Inspector credentials are unavailable.
- User-defined functions, standard JSON-compatible JavaScript values, `async`/`await`, and standard string/number/array methods are supported.

### Script SDK

The only host capabilities are:

```ts
interface ScriptContext {
  phase: "before" | "after";
  arguments: {
    get(path: string): JsonValue | undefined;
    set(path: string, value: JsonValue): void;
    remove(path: string): void;
    all(): Readonly<Record<string, JsonValue>>;
  };
  response: McpCallToolResult | null; // non-null only in after
  tools: {
    call(input: { server: "current" | string; name: string; arguments: Record<string, JsonValue> }): Promise<McpCallToolResult>;
  };
  variables: { get(name: string): JsonValue | undefined; set(name: string, value: JsonValue): void };
  env: {
    get(name: string, options?: { scope?: "project" | "server" }): JsonValue | undefined;
    set(name: string, value: JsonValue, options?: { scope?: "execution" | "project" | "server"; secret?: boolean }): void;
  };
  json: { get(value: JsonValue, path: string): JsonValue | undefined; parse(text: string): JsonValue };
  assert: {
    equal(actual: JsonValue, expected: JsonValue, message?: string): void;
    exists(value: JsonValue | undefined, message?: string): void;
    notEmpty(value: JsonValue | undefined, message?: string): void;
    match(value: string, pattern: string, message?: string): void;
    true(value: boolean, message?: string): void;
  };
  log: {
    debug(message: string, data?: JsonValue): void;
    info(message: string, data?: JsonValue): void;
    warn(message: string, data?: JsonValue): void;
    error(message: string, data?: JsonValue): void;
    inspect(label: string, data: JsonValue): void;
  };
}
```

`console.log/info/warn/error` map to `ctx.log`. Argument writes must use `ctx.arguments` so every mutation is auditable. Before may mutate main arguments; after receives a read-only main response and cannot retroactively mutate the completed main request.

### Limits and recursion

- Default script wall timeout: 5 seconds; configurable maximum: 60 seconds.
- Default QuickJS memory limit: 32 MiB; stack limit: 512 KiB; parent also terminates a child that exceeds the configured wall/RSS guard.
- Maximum 100 logs, 64 KiB per log, 20 Tool calls, and 2 MiB script source.
- Child Tool calls never execute their own workflows. This makes nesting depth exactly one and prevents accidental recursion.
- Cancellation closes observations, cancels the currently active child Run, terminates the sandbox, and records one terminal workflow outcome.

### Variables

- `execution`: exists only for the current workflow and is never persisted.
- `project`: persisted in the current project SQLite database.
- `server`: persisted against one connection and inaccessible to other connections.
- Project/Server mutations are staged and committed atomically only after the whole workflow succeeds.
- Secret values are never returned by list APIs, are redacted from logs/events/exports by default, and exports omit their values.

### Tool calls and side effects

- Each `ctx.tools.call()` creates a normal child Run with `tabId = null` and the existing immutable request/response/events model.
- The main Tool creates the same normal Tab-bound Run used today.
- A new parent Workflow Execution links ordered child Runs and the main Run; existing Run readers remain valid.
- A helper Tool with `destructiveHint: true` requires a confirmation captured before workflow start. Annotations are hints, not a security guarantee.
- No automatic retry and no rollback claim. Completed external effects remain completed if a later step fails.

### Debugging

- Users can validate syntax, debug before alone, debug after against a selected historical/saved/manual response, or execute the full workflow.
- Before-debug produces an argument diff and does not write it back until the user chooses Apply.
- Debug mode stages but does not persist environment mutations by default.
- Logs contain level, timestamp, phase, source location, message, optional bounded JSON data, and redaction metadata.
- Tool calls show actual arguments, Run link, result/error, HTTP/RPC trace, and duration.
- Script errors use stable categories and bounded source excerpts; internal stack or credentials are never exposed.

## Architecture

### Compatibility seam

`POST /api/projects/:projectId/runs` and `RunService.start()` remain unchanged. The UI calls them whenever the Tool has no enabled script. Enabled workflows use a new Workflow Execution endpoint. Internally, an additive `RunService.startInvocation()` accepts a validated connection/Tool target and nullable Tab for helper calls; existing `start()` delegates through the same proven state machine.

### Persistence

Additive migration 011 creates:

- `tool_workflows`: project/connection/tool identity, revision, before/after source, enable flags, timeout, timestamps.
- `environment_variables`: project scope plus nullable connection scope, name, JSON value, secret flag, timestamps.
- `workflow_executions`: parent status/timestamps, Tab/main Tool/snapshot identity, initial/final arguments, script snapshot, response/error, idempotency key.
- `workflow_execution_runs`: ordered phase/ordinal to existing Run IDs.
- `workflow_events`: ordered durable logs, diffs, calls, variable changes, and terminal status.

All foreign keys are project-scoped where the existing schema permits, deletion behavior is explicit, and migration 1→11 plus duplicate-open behavior is tested. Existing tables are not rewritten.

### API resources

- `GET|PUT /projects/:projectId/connections/:connectionId/tools/:toolName/workflow`
- `POST /projects/:projectId/connections/:connectionId/tools/:toolName/workflow/validate`
- `GET|PUT|DELETE /projects/:projectId/variables/...`
- `POST /projects/:projectId/workflow-executions`
- `GET /projects/:projectId/workflow-executions/:executionId`
- `POST /projects/:projectId/workflow-executions/:executionId/cancel`
- `GET /projects/:projectId/workflow-executions/:executionId/events`
- `POST /projects/:projectId/workflow-debug-sessions`

Every route uses the existing Inspector session/Origin boundary, strict request schemas, project/connection/Tool ownership checks, bounded payloads, stable error codes, and defensive client decoding. Workflow update uses a revision precondition and returns `409 WORKFLOW_REVISION_CONFLICT` on stale edits.

### Sandbox boundary

- One sanitized Node child process per script evaluation.
- The child creates one isolated QuickJS runtime/context; no module loader or host globals are exposed.
- QuickJS interrupt, memory, and stack limits are defense in depth. The parent owns the wall deadline, cancellation, IPC validation, call count, output bounds, and child termination.
- Async host operations use QuickJS deferred promises plus explicit pending-job execution, not Asyncify.
- Parent and child accept only versioned, strictly validated JSON IPC messages. Unknown, duplicate, late, or over-limit messages terminate the evaluation.

This double boundary is required because QuickJS offers runtime limits but the upstream project currently has open reports concerning host memory growth. The sandbox must fail closed if it cannot establish every limit.

## UI

- Add `脚本` after `Tool 定义` in the existing Tool Tab navigation.
- Layout: Before editor, central current-Tool marker, After editor; each script has enabled state, timeout, validate, debug, and reset controls.
- Editor provides JavaScript syntax highlighting and SDK type completion. Dependency selection occurs only after measuring bundle/package impact; a plain textarea fallback remains functional.
- Execution button changes to `执行流水线` only while a script is enabled and shows before/main/after count.
- Result tabs add `执行概览`, `前置步骤`, and `后置步骤` without altering existing request/result, call detail, HTTP, RPC, or timeline views for normal Runs.
- All menus, editors, status, log filters, diffs, and dialogs are keyboard reachable and expose accessible names/live status.

## Commands

- Focused tests: `npx vitest run <affected paths>`
- Full unit/integration tests: `npm run test`
- Type check: `npm run typecheck`
- Production build: `npm run build`
- Browser acceptance: `npm run test:e2e`
- Full gate: `npm run verify`
- Package inspection: `npm pack --dry-run --json`

## Testing Strategy

- Pure unit tests: path access, JSONPath subset, assertions, redaction, mutation diff, IPC codecs, state transitions.
- SQLite/service tests: migrations, ownership, revision conflicts, variable scopes, atomic staged commit, lineage.
- Sandbox integration tests: syntax/runtime error, timeout, infinite loop, memory/stack pressure, forbidden globals/imports, multiple sequential awaits, cancellation, late IPC, log/output/call bounds, disposal.
- Run/workflow integration tests: before mutation, helper success/failure, main validation, after extraction, cancellation at every phase, idempotency, trace failure, unchanged legacy Run behavior.
- React tests: editor persistence fences, debug/apply flow, logs/diffs/calls, destructive confirmation, stale project/Tab responses, accessibility.
- Production Playwright: one normal Run proves backward compatibility; one workflow proves before helper → main → after variable and reload/history recovery.

## Boundaries

### Always

- RED test before each behavior, strict boundary validation, additive schema/API changes, feature disabled when no script is enabled, deterministic cleanup, and full regression gates.

### Ask first

- Any change to existing Run/Tab/history response fields or semantics, a second runtime/editor dependency, allowing imports/network/filesystem, changing secret export behavior, recursive workflows, automatic retries, or replacing the approved limits.

### Never

- Use Node `vm` as the sole security boundary; expose `process`, `require`, `fetch`, Inspector credentials, raw database access, or filesystem; log secrets; silently run destructive Tools; rewrite old migrations; or coerce existing arguments without an auditable mutation.

## Success Criteria

1. With workflows absent/disabled, existing API payloads, Run rows/events, UI behavior, E2E, and package entry remain unchanged.
2. A before script can read/update arguments, sequentially await helper Tools, and produce durable redacted logs and diffs.
3. The mutated arguments are revalidated against the current immutable Tool snapshot before the main Tool is called.
4. An after script can inspect the main response, call helpers, assert, and atomically stage project/Server variables.
5. Every real Tool call is a normal independently inspectable Run linked to one ordered parent execution.
6. Timeout, cancellation, script error, helper error, main error, trace persistence failure, and server disconnect each produce one deterministic terminal workflow result with no leaked child process or pending mutation.
7. Script code cannot access non-allowlisted host capabilities, and resource/output/call limits have adversarial automated tests.
8. Full `npm run verify`, package allowlist, migration byte checks, clean-process checks, and independent quality/security review pass.

## References

- QuickJS Emscripten exposes no host capabilities by default and supports host functions and deferred Promise bridging: <https://github.com/justjake/quickjs-emscripten/blob/main/README.md>
- QuickJS runtime CPU, memory, and stack limits: <https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten/classes/QuickJSRuntime.md>

