# MCP Inspector 3.0.0 Authoring MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a local Streamable HTTP Authoring MCP endpoint that lets an external AI Host discover configured MCP Tools, diagnose them, author and trial deterministic automation Drafts, and atomically save validated tests without embedding a model in Inspector.

**Architecture:** Extend the existing single Node/Hono process with an authenticated `/mcp/authoring` adapter. Installation authentication lives in `registry.sqlite`; project policies, Drafts, executions, and Authoring call records live in each project database. Authoring services reuse `ConnectionRuntime`, Run, testing, suite, environment, workflow, and QuickJS services and never bypass their identity boundaries.

**Tech Stack:** Node.js 22, TypeScript, Hono, MCP TypeScript SDK, Zod, better-sqlite3, React 19, Vitest, Testing Library, Playwright.

**Spec:** [`../specs/2026-09-09-authoring-mcp-design.md`](../specs/2026-09-09-authoring-mcp-design.md)

## Global Constraints

- Do not add a model Provider, Agent loop, chat page, or model credential storage.
- Bind production only to `127.0.0.1`; preserve explicit port `0` for tests.
- Preserve project, connection, Tool, tab, Run, Draft, and execution identity isolation.
- Keep authentication keyed by connection ID and Authoring authentication separate from browser and downstream credentials.
- Never modify project migrations `001`–`020`; add registry migrations and project migrations `021`–`023` exactly as specified.
- Reuse shared Zod schemas across MCP, REST, services, and client boundaries.
- Redact Authoring output regardless of ordinary Run redaction settings.
- Add a regression test before every behavior change or bug fix.
- Run focused tests after each task and `npm run verify` at each slice checkpoint that changes runtime, authentication, persistence, routing, layout, or production entry.
- Commit only files belonging to the completed task; do not absorb unrelated worktree changes.

---

## Slice A — Runtime, registry authentication, and MCP transport

### Task 1: Establish the fixed-port startup contract

**Files:**

- Modify: `src/server/config/runtime-config.ts`
- Modify: `src/server/main.ts`
- Modify: `bin/mcp-inspector.mjs`
- Modify: `src/server/__tests__/main.test.ts`
- Modify: `src/server/__tests__/bin-entry.test.ts`

- [ ] Add failing tests for default port `8500`, explicit test port `0`, CLI `--port`, environment fallback, invalid values, and precedence `CLI > MCP_INSPECTOR_PORT > 8500`.
- [ ] Run `npx vitest run src/server/__tests__/main.test.ts src/server/__tests__/bin-entry.test.ts` and confirm the new assertions fail.
- [ ] Implement one exported port parser used by the bin entry and development entry; accept integers `1..65535` for user input and preserve programmatic `0`.
- [ ] Make occupied-port startup report an actionable sanitized message and never choose another port.
- [ ] Re-run the focused tests and `npm run typecheck`.
- [ ] Commit with `feat(runtime): add configurable authoring port contract`.

### Task 2: Add installation registry migrations and settings storage

**Files:**

- Create: `src/server/registry/registry-migrator.ts`
- Create: `src/server/registry/installation-settings-repository.ts`
- Create: `src/server/registry/migrations/001_registry_baseline.sql`
- Create: `src/server/registry/migrations/002_authoring_settings.sql`
- Create: `src/server/registry/__tests__/registry-migrations.test.ts`
- Modify: `src/server/projects/project-registry.ts`

- [ ] Write migration tests for a fresh install and a legacy `registry.sqlite` containing `project_registry` but no migration history.
- [ ] Assert project rows survive adoption and migration source/dist bytes are identical after packaging.
- [ ] Implement a transactional registry migrator that records numbered migrations and fails closed on checksum/history conflicts.
- [ ] Refactor `ProjectRegistry` to use the registry migrator instead of inline table creation and expose its database to installation settings without opening a second connection.
- [ ] Store only Authoring enabled state, Token digest/hint, creation/rotation timestamps, and non-secret installation settings.
- [ ] Run the registry migration tests and `npm run typecheck`.
- [ ] Commit with `feat(registry): add authoring installation settings`.

### Task 3: Implement one-time Authoring Token management

**Files:**

- Create: `src/server/authoring/authoring-auth-service.ts`
- Create: `src/server/authoring/authoring-settings-routes.ts`
- Create: `src/shared/authoring/auth.ts`
- Create: `src/server/authoring/__tests__/authoring-auth-service.test.ts`
- Modify: `src/server/app.ts`

- [ ] Add failing tests for enable, one-time plaintext return, digest-only persistence, constant-time verification, rotation invalidation, disablement, and sanitized errors.
- [ ] Define shared REST request/response schemas without a reusable plaintext Token field.
- [ ] Implement high-entropy Token generation and a versioned cryptographic digest; never log or persist plaintext.
- [ ] Mount browser-session-protected enable/rotate/disable/status routes under `/api/authoring/settings`.
- [ ] Verify Token material does not appear in URLs, Toast-compatible messages, repository rows, or test log captures.
- [ ] Run focused auth/app tests and `npm run typecheck`.
- [ ] Commit with `feat(authoring): add installation token management`.

### Task 4: Mount the authenticated Streamable HTTP walking skeleton

**Files:**

- Create: `src/server/authoring/authoring-mcp-server.ts`
- Create: `src/server/authoring/authoring-mcp-routes.ts`
- Create: `src/shared/authoring/protocol.ts`
- Create: `src/server/authoring/__tests__/authoring-mcp-routes.test.ts`
- Modify: `package.json`

- [ ] Move `@modelcontextprotocol/sdk` from development to production dependencies and record the lockfile change.
- [ ] Add failing protocol tests for initialize, bounded stateful sessions, `inspector_get_capabilities`, missing/invalid Token, disabled service, invalid Origin, unsupported media, oversized body, and shutdown.
- [ ] Mount `/mcp/authoring` before the SPA fallback and outside browser session middleware.
- [ ] Authenticate every MCP request; treat session IDs as protocol state only, never authority.
- [ ] Return the stable success/error envelope and no stack, SQL, path, credential, or raw downstream body.
- [ ] Run focused protocol tests, `npm run typecheck`, then `npm run verify` as Checkpoint A.
- [ ] Commit with `feat(authoring): expose authenticated mcp transport`.

---

## Slice B — Discovery and connection policy

### Task 5: Add policy persistence and shared authorization semantics

**Files:**

- Create: `src/server/projects/migrations/021_authoring_connection_policies.sql`
- Create: `src/shared/authoring/policy.ts`
- Create: `src/server/authoring/authoring-policy-repository.ts`
- Create: `src/server/authoring/authoring-policy-service.ts`
- Create: `src/server/authoring/__tests__/authoring-policy-service.test.ts`

- [ ] Add migration and service tests covering missing=`DISABLED`, `READ_ONLY`, `CUSTOM`, deny-wins behavior, `FULL_ACCESS`, optimistic revision conflicts, deletion of a connection, and same-URL/different-connection isolation.
- [ ] Implement policy rows keyed by exact project ID and connection ID with cleanup, rate, concurrency, and duration limits.
- [ ] Make `FULL_ACCESS` allow all current/future downstream Tools while preserving all non-permission safety boundaries.
- [ ] Expose policy mutation only through browser-authorized service calls; MCP tools receive read-only summaries.
- [ ] Run the focused migration/policy tests and `npm run typecheck`.
- [ ] Commit with `feat(authoring): add connection access policies`.

### Task 6: Expose project, connection, and Tool discovery tools

**Files:**

- Create: `src/server/authoring/authoring-catalog-service.ts`
- Create: `src/shared/authoring/catalog.ts`
- Modify: `src/server/authoring/authoring-mcp-server.ts`
- Create: `src/server/authoring/__tests__/authoring-catalog-service.test.ts`
- Modify: `src/server/tools/tool-service.ts`

- [ ] Add failing tests for paginated project/connection/Tool lists, opaque cursor/filter binding, schema hash stability, disabled-policy hiding, stale Tool snapshots, and bounded sanitized descriptions.
- [ ] Register `inspector_list_projects`, `inspector_list_connections`, `inspector_list_tools`, and `inspector_describe_tool`.
- [ ] Resolve all resources by stable IDs; reject name/URL-based identity substitution.
- [ ] Treat downstream names, descriptions, schemas, and annotations as untrusted data and truncate them at documented limits.
- [ ] Run focused catalog/MCP tests and `npm run typecheck`.
- [ ] Commit with `feat(authoring): expose bounded catalog discovery`.

### Task 7: Add the Server Authoring permission UI

**Files:**

- Modify: `src/client/api/api-client.ts`
- Modify: `src/client/features/connections/ConnectionPanel.tsx`
- Modify: `src/client/features/connections/ConnectionDialogs.tsx`
- Modify: `src/client/app/redesign.css`
- Modify: `src/client/app/InspectorWorkbench.test.tsx`
- Modify: `src/shared/i18n/locales/zh-CN/app.ts`
- Modify: `src/shared/i18n/locales/en-US/app.ts`

- [ ] Add failing UI tests for loading policy by project+connection, saving each mode, explicit FULL_ACCESS confirmation, keyboard operation, stale-response fencing, and project switch clearing.
- [ ] Add an `Authoring MCP 权限` Disclosure using existing Button, Select/SearchableSelect, Dialog, FormField, and Phosphor primitives.
- [ ] Explain that FULL_ACCESS includes future and destructive Tools; do not infer permission from annotations.
- [ ] Preserve the current connection and Tool-tab state while editing policy.
- [ ] Add zh-CN/en-US strings in the existing locale resources touched by the feature.
- [ ] Run focused client tests and `npm run verify` as Checkpoint B.
- [ ] Commit with `feat(ui): add connection authoring permissions`.

---

## Slice C — Standalone Tool calls, audit, and Run lineage

### Task 8: Add Draft and call storage migrations in release order

**Files:**

- Create: `src/server/projects/migrations/022_authoring_drafts.sql`
- Create: `src/server/projects/migrations/023_authoring_tool_calls.sql`
- Modify: `src/server/projects/project-store.ts`
- Create: `src/server/projects/__tests__/authoring-migrations.test.ts`

- [ ] Add tests upgrading a migration-020 fixture through 021–023 without changing any released migration bytes.
- [ ] Define Draft bundle/revision, validation, execution, Apply/idempotency mapping, and Authoring call tables with project-local foreign keys and bounded JSON columns.
- [ ] Add indexes for stable pagination and uniqueness for scoped idempotency keys.
- [ ] Verify rollback on each injected migration failure and source/dist migration parity.
- [ ] Run focused migration tests and `npm run typecheck`.
- [ ] Commit with `feat(storage): add authoring draft and call schema`.

### Task 9: Implement policy-enforced standalone calls

**Files:**

- Create: `src/server/authoring/authoring-call-repository.ts`
- Create: `src/server/authoring/authoring-call-service.ts`
- Create: `src/shared/authoring/calls.ts`
- Modify: `src/server/runs/run-service.ts`
- Create: `src/server/authoring/__tests__/authoring-call-service.test.ts`

- [ ] Add failing tests for all four policy modes, schema-hash mismatch, invalid arguments, call limits, concurrent limits, timeout, cancellation, idempotency replay/conflict, and uncertain non-idempotent outcomes.
- [ ] Implement `STANDALONE` and `DRAFT` call contexts; require exact project, connection, Tool name, schema hash, purpose, arguments, and idempotency key.
- [ ] Persist intent before invoking downstream, then terminal status and ordinary `runId`; map uncertain writes to `UNKNOWN` and prohibit automatic retry.
- [ ] Reuse `ConnectionRuntime` and Run lifecycle rather than creating a second invocation engine.
- [ ] Apply mandatory Authoring redaction and response truncation before returning or storing Authoring-visible material.
- [ ] Run focused call/Run tests and `npm run typecheck`.
- [ ] Commit with `feat(authoring): add audited standalone tool calls`.

### Task 10: Expose call history and Authoring Run origin

**Files:**

- Modify: `src/server/authoring/authoring-mcp-server.ts`
- Modify: `src/server/runs/routes.ts`
- Modify: `src/client/features/runs/RunHistory.tsx`
- Modify: `src/client/api/api-client.ts`
- Create: `src/server/authoring/__tests__/authoring-call-tools.test.ts`

- [ ] Add failing tests for `inspector_call_tool`, `inspector_list_tool_calls`, `inspector_get_tool_call`, project-bound pagination, sanitized detail, and Run source filtering.
- [ ] Register the three call tools and return both `callId` and `runId`.
- [ ] Add an Authoring source filter without changing ordinary debug/test history behavior.
- [ ] Ensure opening Authoring history never mutates an active Tool tab or Run.
- [ ] Run focused server/client tests and `npm run verify` as Checkpoint C.
- [ ] Commit with `feat(authoring): expose call history and run lineage`.

---

## Slice D — Draft authoring and validation

### Task 11: Define the Draft Bundle contract and revision service

**Files:**

- Create: `src/shared/authoring/draft.ts`
- Create: `src/server/authoring/authoring-draft-repository.ts`
- Create: `src/server/authoring/authoring-draft-service.ts`
- Create: `src/server/authoring/__tests__/authoring-draft-service.test.ts`
- Modify: `src/server/authoring/authoring-mcp-server.ts`

- [ ] Add contract tests rejecting server-owned IDs, enablement, scheduling, deletes, pressure tests, shared script mutation, oversized/unknown fields, broken Draft-local references, and stale revisions.
- [ ] Reuse existing Tool test, scenario, assertion, mapping, extractor, polling, cleanup, and suite schemas via explicit Draft adapters.
- [ ] Implement create-empty, create-from-call, create-from-current-asset-revision, list, get, and full replace with `expectedRevision` and idempotency.
- [ ] Register `inspector_create_draft`, `inspector_create_draft_from_call`, `inspector_list_drafts`, `inspector_get_draft`, and `inspector_replace_draft`.
- [ ] Run focused shared/service/MCP tests and `npm run typecheck`.
- [ ] Commit with `feat(authoring): add revisioned draft bundles`.

### Task 12: Add deterministic Draft validation and asset discovery

**Files:**

- Create: `src/server/authoring/authoring-draft-validator.ts`
- Create: `src/shared/authoring/validation.ts`
- Create: `src/server/authoring/authoring-asset-service.ts`
- Modify: `src/server/authoring/authoring-mcp-server.ts`
- Create: `src/server/authoring/__tests__/authoring-draft-validator.test.ts`

- [ ] Add failing table tests for current Tool hashes, arguments, references, JSON paths, assertion operands, suite membership, policy, cleanup requirement, secret-shaped literals, and source revision conflicts.
- [ ] Produce validation results bound to `draftId + revision + definitionDigest + toolSchemaHashes`; validation must never call downstream Tools.
- [ ] Register validate/list-assets/get-asset tools with bounded sanitized results.
- [ ] Require exact source revision for existing asset updates and never expose enable/delete operations.
- [ ] Run focused validation/asset tests and `npm run typecheck`.
- [ ] Commit with `feat(authoring): validate drafts against current assets`.

### Task 13: Build the Authoring MCP workspace shell

**Files:**

- Create: `src/client/features/authoring/AuthoringPage.tsx`
- Create: `src/client/features/authoring/AuthoringWorkspace.tsx`
- Create: `src/client/features/authoring/authoring.css`
- Modify: `src/client/app/InspectorWorkbench.tsx`
- Modify: `src/client/app/InspectorWorkbench.test.tsx`
- Modify: `src/shared/i18n/locales/zh-CN/app.ts`
- Modify: `src/shared/i18n/locales/en-US/app.ts`

- [ ] Add failing tests for navigation, service status, one-time Token flow, endpoint/client-config copy, Draft/call lists, project-switch reset, and menu-switch state restoration.
- [ ] Add `Authoring MCP` to primary navigation using the existing Shell and Phosphor icon system.
- [ ] Use list/detail or split-pane workbench patterns, not nested dashboard cards; keep one scroll owner per axis.
- [ ] Persist filters, selection, scroll position, and unsaved Draft editor state by project while clearing them across project identity changes.
- [ ] Add loading, empty, stale, unauthorized, disabled, interrupted, and error states from authoritative server data.
- [ ] Run focused UI tests, keyboard/a11y checks, and `npm run verify` as Checkpoint D.
- [ ] Commit with `feat(ui): add authoring workspace`.

---

## Slice E — Trial execution and step-local QuickJS

### Task 14: Extend shared scenarios with bounded `argumentTransform`

**Files:**

- Modify: `src/shared/testing/test-case.ts`
- Modify: `src/shared/script-workflow.ts`
- Modify: `src/server/testing/scenario-runner.ts`
- Create: `src/shared/__tests__/authoring-argument-transform.test.ts`
- Modify: `src/server/testing/__tests__/scenario-runner.test.ts`

- [ ] Add failing backward-compatibility tests proving old revisions parse unchanged and transforms are optional.
- [ ] Add sandbox tests for deterministic input/output, time/memory/output limits, thrown errors, forbidden network/filesystem/Node/environment/Tool access, and secret redaction.
- [ ] Execute the transform only at its step boundary and include source digest in the formal revision.
- [ ] Replace generic scenario-step failure with the precise transform/path/evaluation error where applicable.
- [ ] Run focused schema/runner tests and `npm run typecheck`.
- [ ] Commit with `feat(testing): add step argument transforms`.

### Task 15: Implement asynchronous Draft trial execution

**Files:**

- Create: `src/server/authoring/authoring-draft-execution-repository.ts`
- Create: `src/server/authoring/authoring-draft-execution-service.ts`
- Create: `src/shared/authoring/execution.ts`
- Modify: `src/server/authoring/authoring-mcp-server.ts`
- Create: `src/server/authoring/__tests__/authoring-draft-execution-service.test.ts`

- [ ] Add failing tests for start/get/cancel, one active execution per Draft, captured revision/digest, per-step ordinary Runs, expected/actual assertion output, cleanup on success/failure/cancel, and restart interruption.
- [ ] Return execution ID immediately; execute the exact validated revision with current environment resolution and existing runners.
- [ ] Store Draft-level results separately instead of manufacturing formal test IDs.
- [ ] Fence late completions after cancellation and map active executions on restart to `INTERRUPTED`; map unresolved calls according to idempotency certainty.
- [ ] Register execute/get/cancel tools and stable execution errors.
- [ ] Run focused execution tests and `npm run verify` as Checkpoint E.
- [ ] Commit with `feat(authoring): add asynchronous draft trials`.

---

## Slice F — Atomic Apply and editor handoff

### Task 16: Save the exact validated Draft revision atomically

**Files:**

- Create: `src/server/authoring/authoring-apply-service.ts`
- Create: `src/server/authoring/authoring-apply-repository.ts`
- Modify: `src/server/testing/test-case-repository.ts`
- Modify: `src/server/testing/test-suite-repository.ts`
- Create: `src/server/authoring/__tests__/authoring-apply-service.test.ts`

- [ ] Add failing tests for stale revision, invalid digest, Tool/policy/source drift, idempotency replay/conflict, transaction rollback at every write stage, and concurrent Apply.
- [ ] In one project SQLite transaction create/revise all test cases, test revisions, suites, members, and Draft-to-formal mappings.
- [ ] Force newly created formal tests disabled; preserve enablement only when editing an existing exact source revision.
- [ ] Never expose enable, delete, schedule, pressure-test, secret-management, or shared-workflow mutation through Apply.
- [ ] Mark the Draft `APPLIED` only after commit and return stable formal asset IDs/revisions.
- [ ] Run focused Apply/repository tests and `npm run typecheck`.
- [ ] Commit with `feat(authoring): atomically apply validated drafts`.

### Task 17: Complete MCP save and UI handoff

**Files:**

- Modify: `src/server/authoring/authoring-mcp-server.ts`
- Modify: `src/client/features/authoring/AuthoringWorkspace.tsx`
- Modify: `src/client/features/testing/TestCasesPage.tsx`
- Modify: `src/client/features/testing/TestSuitesPage.tsx`
- Modify: `src/client/app/InspectorWorkbench.test.tsx`

- [ ] Add failing tests for `inspector_save_draft`, exact validation requirement, idempotent response, Apply mapping display, and opening the saved case/suite by stable ID.
- [ ] Register save with exact revision, validation digest, and idempotency key.
- [ ] Add validate, execute, cancel, save, and “open asset” actions with correct loading/disabled explanations.
- [ ] Preserve existing testing editor tabs and unsaved state while navigating from Authoring; do not auto-enable the saved asset.
- [ ] Run focused MCP/UI tests and `npm run verify` as Checkpoint F.
- [ ] Commit with `feat(authoring): complete draft save workflow`.

---

## Slice G — Hardening and release

### Task 18: Close security, abuse, restart, and observability gaps

**Files:**

- Create: `src/server/authoring/authoring-redaction.ts`
- Create: `src/server/authoring/authoring-limits.ts`
- Modify: `src/server/main.ts`
- Create: `src/server/authoring/__tests__/authoring-security.test.ts`
- Create: `src/server/authoring/__tests__/authoring-restart.test.ts`

- [ ] Add adversarial tests for prompt-like downstream text, prototype keys, cursor tampering, traversal-shaped IDs, oversized schemas/results/Drafts, Origin spoofing, Token leakage, and cross-project/connection access.
- [ ] Enforce documented request, session, call, concurrency, duration, Draft, output, and pagination bounds outside AI-controlled input.
- [ ] Emit sanitized audit fields: request/tool IDs, stable resource IDs, policy decision, status, duration, error code, redaction count, and truncation only.
- [ ] Implement bounded shutdown ordering: reject new work, cancel Draft executions, settle/mark calls, close MCP sessions, then close existing runtimes and databases.
- [ ] Run security/restart tests and `npm run typecheck`.
- [ ] Commit with `fix(authoring): harden local authoring boundary`.

### Task 19: Complete E2E, documentation, packaging, and release gates

**Files:**

- Create: `e2e/authoring-mcp.spec.ts`
- Modify: `README.md`
- Modify: `docs/UPGRADE-3.0.0.md`
- Modify: `scripts/check-release-artifacts.mjs`
- Modify: `package.json`

- [ ] Add an E2E fixture AI client and downstream MCP server covering enable/token/configure/discover/standalone call/Draft/validate/execute/Apply/open asset.
- [ ] Add E2E isolation cases for same URL with different connection auth, project switching, cancellation, Token rotation, FULL_ACCESS confirmation, and mandatory redaction.
- [ ] Verify keyboard, focus, Disclosure/SplitPane semantics, light/dark themes, zh-CN/en-US, 1024px desktop, and narrow layout behavior.
- [ ] Document endpoint configuration for external AI Hosts without exposing a real Token or suggesting query-string credentials.
- [ ] Update release artifact checks so registry migrations, project migrations, MCP server SDK, client assets, and production entry are packaged.
- [ ] Run `npm run verify`, `npm run verify:release-artifacts`, `npm pack --dry-run --json`, and `git diff --check`.
- [ ] Perform independent correctness, security/privacy, migration, and accessibility review; resolve every Critical/Required finding.
- [ ] Commit with `chore(release): complete authoring mcp 3.0 gates`.

## Execution Order and Stop Conditions

Execute Tasks 1–19 in order. Do not begin a new slice until the prior checkpoint is green. Stop and request a design decision if implementation would require any non-goal, alter a released migration, weaken identity isolation, persist plaintext credentials, expose a non-loopback listener, or introduce a second execution engine.

Progress is tracked in [`../../../tasks/upgrade-3.0.0-authoring-todo.md`](../../../tasks/upgrade-3.0.0-authoring-todo.md). The previous `tasks/upgrade-3.0.0-plan.md` and `tasks/upgrade-3.0.0-todo.md` describe the superseded embedded-Agent proposal and are retained as historical records only.
