# Tool Script Workflows — Task Checklist

## Phase 1: Additive Foundations

### Task 1: Lock sandbox dependency and persistence contracts

- [x] Add the reviewed QuickJS dependency/variant without editor dependencies.
- [x] Migration 011 adds workflow, variable, execution, execution-Run, and event tables without altering 001–010.
- [x] Shared/server types and strict codecs define configuration, variables, IPC, execution summaries, and stable errors.
- Verify: migration 1→11/duplicate/FK/byte tests, dependency audit/provenance review, `npm run typecheck`, `npm run build`, packed-artifact inspection.
- Dependencies: none. Estimated scope: Medium, split dependency and migration commits if needed.

### Task 2: Configure scripts per Tool

- [x] GET/PUT/validate routes enforce project/connection/Tool ownership, source/timeout limits, and revision conflicts.
- [x] Client defensively decodes every field and fences stale project/Tool completions.
- [x] Disabled/empty configurations never affect legacy Run execution.
- Verify: focused repository/service/route/client tests plus full Vitest.
- Dependencies: Task 1. Likely files: workflow repository/service/routes, app wiring, API client/tests.

### Task 3: Manage scoped environment variables

- [x] Project, Server, execution, and secret behavior follows the spec.
- [x] Secret list/get/export responses never disclose stored values; ownership and name/value limits are strict.
- [x] A staged mutation batch commits atomically or not at all.
- Verify: repository/service/route/client tests including two DB handles, scope isolation, redaction, rollback, deletion.
- Dependencies: Task 1. Likely files: environment repository/service/routes, API client/tests.

### Checkpoint: Foundation

- [x] Existing full tests, typecheck, build, migration copy, and package smoke pass.
- [x] Normal `startRun` produces byte/shape-equivalent observable behavior.

## Phase 2: Isolated Runtime

### Task 4: Evaluate JavaScript and capture logs safely

- [x] Dedicated child process evaluates the required default async export in QuickJS.
- [x] Structured `ctx.log` and console mapping preserve order/source location and enforce redaction/size/count limits.
- [x] Syntax/runtime/infinite-loop/memory/stack/timeout/cancel/forbidden-global/import/late-IPC cases fail closed and leak no child.
- Verify: focused child-process integration suite, production-built worker smoke, open-handle/process check.
- Dependencies: Task 1. Likely files: script IPC schema, parent runner, worker entry, runtime tests, build config.

### Task 5: Add deterministic local SDK capabilities

- [x] Arguments, JSONPath subset, variables, staged env, assertions, and diffs match the SDK contract.
- [x] All guest/host values are bounded JSON with prototype keys rejected and immutable snapshots preserved.
- [x] Before and after phase capability differences are enforced.
- Verify: pure unit tests and parent/child integration tests; no MCP/network required.
- Dependencies: Task 4. Likely files: SDK bridge, path/JSON utilities, runtime tests.

### Task 6: Call helper Tools through normal child Runs

- [x] Additive internal Run invocation supports nullable Tab and waits/cancels without changing the public start route.
- [x] `ctx.tools.call()` validates target ownership/availability, creates an inspectable child Run, returns the full result, and never recurses.
- [x] Twenty-call bound, sequential awaits, disconnect/timeout/isError/cancel/trace failure, and destructive confirmation are deterministic.
- Verify: Run regression tests plus real loopback MCP sandbox integration.
- Dependencies: Tasks 2, 4, 5. Likely files: Run service/types tests, workflow call bridge/tests.

### Checkpoint: Runtime

- [x] Security adversarial tests and existing real Streamable HTTP fixture pass.
- [x] No child process, Run, timer, observer, or DB handle remains after cancellation/close.

## Phase 3: Workflow Product

### Task 7: Persist and execute the full workflow

- [x] Parent execution snapshots configuration/arguments/environment and orders before/helper/main/after Runs/events.
- [x] Main arguments are validated after before; persistent variables commit only on whole-workflow success.
- [x] Idempotency, terminal CAS, cancellation at every phase, reload, and late events converge to one terminal outcome.
- Verify: service/routes/client integration tests plus failure-injection matrix.
- Dependencies: Tasks 2, 3, 6. Likely files: execution repository/service/routes, app wiring, API client/tests.

### Task 8: Edit and debug scripts

- [x] Accessible Script Tab edits before/after source, enable state, and timeout with revision-safe persistence.
- [x] Validate, debug-before, debug-after with a manual response, argument apply, logs, calls, and staged variables are usable without executing the main Tool.
- [x] Project/Tab/Tool switches abort or fence every stale save/debug completion.
- Verify: React Testing Library focused suites, keyboard/a11y checks, build.
- Dependencies: Tasks 2, 3, 5, 6. Likely files: script components/styles/API tests/DebugWorkspace integration.

### Task 9: Execute and inspect workflows

- [x] Enabled scripts use `执行流水线`; absent/disabled scripts retain existing `执行` behavior.
- [x] Parent status, ordered events, main/child Run trace, script logs, errors, cancellation, and reload recovery are available.
- [x] Existing normal Run result views and saved/history restoration remain unchanged.
- Verify: component/integration tests and production browser workflow.
- Dependencies: Tasks 7, 8. Likely files: workflow result components, DebugWorkspace, Run history integration, styles/tests.

### Checkpoint: Product

- [x] One normal Run and one before/main/after workflow pass against production build.
- [x] Existing multi-Tab concurrency and history restoration remain green.

## Phase 4: Release Gate

### Task 10: Security, quality, and packaging acceptance

- [x] Independent five-axis review and focused threat-model review have no Critical/Required findings.
- [x] `npm run verify`, dependency audit, migrations 001–011 byte checks, `git diff --check`, npm-pack contents, and process cleanup pass.
- [x] README documents SDK, limits, side effects, variables, debugging, export/redaction, and failure semantics.
- Dependencies: Tasks 1–9.

### Checkpoint: Complete

- [x] All user-requested success criteria are proven by focused, integration, and production-browser tests.
- [x] Existing behavior changes outside the approved additive seams: none.
