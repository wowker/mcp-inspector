# Implementation Plan: MCP Run History and Replay

## Overview

Extend the shipped Core debugger with a deep history and replay slice: searchable and pinnable Run history, non-mutating replay preflight, explicit Schema/risk confirmation, replay through the existing isolated Run engine, and structured source-versus-replay comparison with safe project-level JSONPath ignore rules. The slice deliberately excludes saved test cases, import/export, OAuth, legacy SSE, retention jobs, and automatic retries.

This plan is grounded in the exercised seams now present in `RunRepository`/`RunService`, immutable Tool snapshots, `RunHistory`, `RunResultPanel`, `DebugWorkspace`, authenticated client decoders, and the production Playwright fixture.

## Architecture Decisions

- Persist replay provenance on the new Run (`replayedFromRunId`) and keep the source Run immutable. Replay creates a normal Run with its own request, response, events, idempotency key, and terminal state.
- Replay targets the source Run's connection and Tool name but resolves the current Tool snapshot at execution time. A missing/removed Tool or deleted connection blocks replay; preflight never connects or invokes the server.
- Replay does not require the original debug Tab. It runs independently and opens as an in-memory read-only result Tab; an unchanged compatible origin Tab may be referenced for navigation but its draft is never overwritten.
- Preflight returns source/current snapshot hashes, a deterministic Schema diff, Tool annotations, and two independent confirmation requirements: Schema drift and side-effect risk. Execution includes a preflight digest so catalog changes between confirmation and POST fail with a new preflight instead of racing silently.
- Unknown side effects are treated as confirmation-required. MCP annotations are displayed as hints, not trusted guarantees. Replay never automatically retries and never silently adds, deletes, or coerces arguments.
- History filtering is server-side. Every opaque cursor binds project ID plus the canonical filter set so a cursor cannot be reused with different filters or across projects.
- Comparisons are computed on demand from immutable Run responses. Persist only replay lineage, pin state, and project ignore rules; do not duplicate result payloads.
- JSONPath support is a documented, non-executable subset: root `$`, property segments (`.name` and bracket-quoted keys), numeric indexes, and `[*]`. Reject recursive descent, filters, scripts, unions, slices, prototype keys, excessive depth, and oversized rules.
- A truncated or unavailable response is never treated as a complete comparable value. The comparison reports a non-comparable side with hash/size metadata.

## Existing Seams to Reuse

- `src/server/runs/run-repository.ts`: canonical Run ordering, project-bound cursor, immutable request/response/events, atomic terminal writes.
- `src/server/runs/run-service.ts`: validation, idempotency, current Tool lookup, shared connection runtime, per-Run isolation, cancellation, and trace recording.
- `src/server/tools/tool-repository.ts`: current Tool and historical snapshot lookup by connection/name/hash.
- `src/client/features/runs/RunHistory.tsx`: project/Tab history surface and read-only Run opening.
- `src/client/features/runs/RunResultPanel.tsx`: safe result/request/protocol rendering and copy behavior.
- `src/client/features/tabs/DebugWorkspace.tsx`: active-versus-inspected Run separation and in-memory read-only result Tabs.
- `e2e/core-debugger.spec.ts`: production-build fixture, deterministic concurrent-call barrier, reload and history assertions.

## Task List

### Phase 1: Durable History Foundations

## Task 1: Persist replay lineage and Run pin state

**Description:** Add the minimum append-only schema and repository contract needed to identify replay descendants and protect user-selected history without changing existing Run execution.

**Acceptance criteria:**
- [ ] Migration 006 adds nullable self-referencing `replayed_from_run_id` (`ON DELETE SET NULL`), a constrained `pinned` flag, and indexes needed for lineage/history lookup; existing databases migrate without rewriting Runs.
- [ ] Run summary/detail decoding exposes lineage and pin state, rejects corrupt rows, and preserves foreign-key/project ownership rules.
- [ ] Creating replay lineage atomically pins the source Run so future retention cannot orphan normal lineage; repository tests cover pin toggles, source deletion fallback, migration 1→6, duplicate migration, and source/dist byte equality.

**Verification:**
- [ ] Tests pass: `npx vitest run src/server/runs src/server/projects`
- [ ] Build succeeds: `npm run typecheck && npm run build`
- [ ] Manual check: inspect an upgraded SQLite database and confirm existing Runs remain readable with `pinned = 0` and null lineage.

**Dependencies:** None

**Files likely touched:**
- `src/server/projects/migrations/006_history_replay.sql`
- `src/server/runs/run-types.ts`
- `src/server/runs/run-repository.ts`
- `src/server/runs/__tests__/run-service.test.ts`
- `src/server/projects/__tests__/project-service.test.ts`

**Estimated scope:** Medium

## Task 2: Add filtered history and pin APIs

**Description:** Extend Run history as one end-to-end server/client slice with stable filters and explicit pin mutation.

**Acceptance criteria:**
- [ ] History filters support status, connection, exact Tool name, replay/original lineage, pinned state, and canonical UTC time bounds; ordering remains `createdAt DESC, id DESC`.
- [ ] The opaque cursor cryptographically or canonically binds the full normalized filter set, project, and optional Tab; malformed/mismatched cursors receive the stable cursor error.
- [ ] Authenticated API/client contracts defensively validate every returned Run and pin response, including project/Tab/filter identity and duplicate IDs.

**Verification:**
- [ ] Tests pass: `npx vitest run src/server/runs src/client/api`
- [ ] Build succeeds: `npm run typecheck`
- [ ] Manual check: paginate two interleaved Tools with a status filter and confirm no skipped/duplicated Run after pinning.

**Dependencies:** Task 1

**Files likely touched:**
- `src/server/runs/run-types.ts`
- `src/server/runs/run-repository.ts`
- `src/server/runs/run-service.ts`
- `src/server/runs/routes.ts`
- `src/client/api/api-client.ts`

**Estimated scope:** Medium

## Task 3: Turn Run History into a searchable explorer

**Description:** Add accessible filter, lineage, and pin controls to the existing project and per-Tab history without changing read-only inspection semantics.

**Acceptance criteria:**
- [ ] Project history exposes filters with an explicit Apply/Reset model, stable pagination, loading/error recovery, and shareable copy of a Run ID; current-Tab history keeps its Tab fence.
- [ ] Rows show original/replay lineage and pin state; opening or pinning a Run never executes a Tool or replaces an editable Tab draft.
- [ ] Project/Tab/filter changes abort or fence stale pages and mutations; keyboard and screen-reader semantics are covered.

**Verification:**
- [ ] Tests pass: `npx vitest run src/client/features/runs src/client/features/tabs`
- [ ] Build succeeds: `npm run typecheck && npm run build`
- [ ] Manual check: filter, paginate, pin, open, and unpin a Run while another Tab is executing.

**Dependencies:** Task 2

**Files likely touched:**
- `src/client/features/runs/RunHistory.tsx`
- `src/client/features/runs/__tests__/RunHistory.test.tsx`
- `src/client/features/tabs/DebugWorkspace.tsx`
- `src/client/app/app.css`

**Estimated scope:** Medium

### Checkpoint: History foundation

- [ ] Tasks 1–3 pass focused tests, full Vitest, typecheck, and build.
- [ ] Existing Core Playwright vertical slice remains green.
- [ ] Independent review finds no Critical or Required history/cursor/ownership issues.

### Phase 2: Safe Replay

## Task 4: Build deterministic replay preflight

**Description:** Add a read-only preflight that compares the source snapshot with the current Tool and decides what the user must confirm before replay.

**Acceptance criteria:**
- [ ] Preflight returns immutable source arguments, source/current snapshot identity, deterministic Schema changes, current Tool annotations, blocking reasons, confirmation requirements, and a digest bound to all execution-relevant fields.
- [ ] Missing project/source/connection/current Tool and removed Tool cases use stable errors; preflight performs no network I/O, Tab mutation, or Run creation.
- [ ] Schema comparison handles boolean/object schemas and future valid JSON Schema fields without executing or resolving remote references.

**Verification:**
- [ ] Tests pass: `npx vitest run src/server/replay src/server/tools`
- [ ] Build succeeds: `npm run typecheck`
- [ ] Manual check: refresh a Tool to a changed Schema and inspect a preflight showing both hashes and confirmation reasons.

**Dependencies:** Task 1

**Files likely touched:**
- `src/server/replay/replay-types.ts`
- `src/server/replay/schema-diff.ts`
- `src/server/replay/replay-service.ts`
- `src/server/replay/routes.ts`
- `src/server/replay/__tests__/replay-service.test.ts`

**Estimated scope:** Medium

## Task 5: Execute replay through the existing Run engine

**Description:** Reuse the proven Run state machine for a confirmed replay while preserving exact arguments and recording lineage.

**Acceptance criteria:**
- [ ] Replay POST requires a fresh idempotency key, the current preflight digest, and explicit required confirmations; stale digest or missing confirmation performs no Tool call.
- [ ] The new Run uses byte-equivalent canonical source arguments, the current Tool snapshot, nullable/compatible Tab association, and `replayedFromRunId`; the source Run is unchanged.
- [ ] Duplicate activation creates at most one Run, cancellation/timeout/`isError`/trace failures retain existing semantics, and replay never retries automatically.

**Verification:**
- [ ] Tests pass: `npx vitest run src/server/replay src/server/runs src/server/connections`
- [ ] Build succeeds: `npm run typecheck && npm run build`
- [ ] Manual check: replay an orphaned source Run and inspect the descendant's exact request, new snapshot ID, and lineage.

**Dependencies:** Task 4

**Files likely touched:**
- `src/server/runs/run-repository.ts`
- `src/server/runs/run-service.ts`
- `src/server/replay/replay-service.ts`
- `src/server/replay/routes.ts`
- `src/server/replay/__tests__/replay-service.test.ts`

**Estimated scope:** Medium

## Task 6: Add the replay confirmation workflow

**Description:** Let a tester initiate replay from any historical Run, understand drift/risk, explicitly confirm when necessary, and follow the new Run without disturbing existing drafts.

**Acceptance criteria:**
- [ ] Replay is available for succeeded and failed historical Runs; preflight blockers, Schema changes, annotations, and exact immutable arguments are shown before execution.
- [ ] Required drift and side-effect confirmations are separate, accessible controls; stale-preflight responses refresh the dialog instead of silently proceeding.
- [ ] Starting replay opens/focuses an in-memory read-only descendant result, uses existing live observation, hard-gates rapid activation, and leaves all editable Tab drafts untouched.

**Verification:**
- [ ] Tests pass: `npx vitest run src/client/features/replay src/client/features/runs src/client/features/tabs`
- [ ] Build succeeds: `npm run typecheck && npm run build`
- [ ] Manual check: replay a changed, unknown-side-effect Tool from a deleted Tab and cancel the new Run.

**Dependencies:** Task 5

**Files likely touched:**
- `src/client/features/replay/ReplayDialog.tsx`
- `src/client/features/replay/__tests__/ReplayDialog.test.tsx`
- `src/client/features/runs/RunResultPanel.tsx`
- `src/client/features/tabs/DebugWorkspace.tsx`
- `src/client/api/api-client.ts`

**Estimated scope:** Medium

### Checkpoint: Replay safety

- [ ] Original and replay Runs are independently persisted and observable.
- [ ] Drift/risk confirmation and stale-digest rejection are proven with no network call on failure.
- [ ] Same-Tool multi-Tab execution remains isolated under concurrent replay.
- [ ] Independent security/code review passes.

### Phase 3: Structured Comparison

## Task 7: Implement safe structural diff and JSONPath ignores

**Description:** Create a pure shared comparison engine for JSON-compatible Run results with a deliberately restricted JSONPath grammar.

**Acceptance criteria:**
- [ ] Diff reports added, removed, changed, and type-changed nodes with deterministic JSON Pointer locations and bounded output.
- [ ] Ignore rules accept only the documented non-executable subset and reject dangerous prototype keys, recursive descent, filters/scripts, invalid escapes, excessive depth/count, and ambiguous syntax.
- [ ] Applying ignores is immutable, handles arrays/wildcards predictably, and explicitly reports truncated/unavailable inputs as non-comparable.

**Verification:**
- [ ] Tests pass: `npx vitest run src/shared/__tests__/run-diff.test.ts`
- [ ] Build succeeds: `npm run typecheck`
- [ ] Manual check: compare nested object/array results with quoted property names and wildcard ignores.

**Dependencies:** None

**Files likely touched:**
- `src/shared/run-diff.ts`
- `src/shared/__tests__/run-diff.test.ts`

**Estimated scope:** Small

## Task 8: Persist project comparison rules

**Description:** Store and edit project-level ignore rules independently from Runs so future comparisons reuse a reviewed configuration.

**Acceptance criteria:**
- [ ] Migration 007 stores ordered, validated project rules with timestamps and project cascade; migration upgrades and duplicate execution are safe.
- [ ] Authenticated CRUD rejects invalid/duplicate/oversized rules atomically and returns a stable ordered representation.
- [ ] Client decoding fences project identity and malformed rules; no rule string is ever evaluated as code.

**Verification:**
- [ ] Tests pass: `npx vitest run src/server/comparisons src/server/projects src/client/api`
- [ ] Build succeeds: `npm run typecheck && npm run build`
- [ ] Manual check: save, reorder, reload, and delete ignore rules containing quoted safe property names.

**Dependencies:** Task 7

**Files likely touched:**
- `src/server/projects/migrations/007_comparison_rules.sql`
- `src/server/comparisons/comparison-rule-repository.ts`
- `src/server/comparisons/routes.ts`
- `src/server/comparisons/__tests__/comparison-rule-repository.test.ts`
- `src/client/api/api-client.ts`

**Estimated scope:** Medium

## Task 9: Expose source-versus-replay comparison

**Description:** Provide an authenticated comparison endpoint that loads two project-owned Runs and applies the shared engine plus current project rules.

**Acceptance criteria:**
- [ ] Comparison validates both Run IDs belong to the project and either share replay lineage or require explicit arbitrary-compare mode; it never trusts client-supplied result data.
- [ ] Response includes statuses/errors, result comparability, applied rule snapshot, deterministic bounded changes, and source/replay metadata needed by the UI.
- [ ] Comparing active, missing, corrupt, or truncated Runs returns explicit stable states/errors without mutating or pinning either Run implicitly.

**Verification:**
- [ ] Tests pass: `npx vitest run src/server/comparisons src/server/runs src/client/api`
- [ ] Build succeeds: `npm run typecheck`
- [ ] Manual check: compare successful, failed, and truncated replay pairs with and without ignore rules.

**Dependencies:** Tasks 5, 7, and 8

**Files likely touched:**
- `src/server/comparisons/comparison-types.ts`
- `src/server/comparisons/comparison-service.ts`
- `src/server/comparisons/routes.ts`
- `src/server/comparisons/__tests__/comparison-service.test.ts`
- `src/client/api/api-client.ts`

**Estimated scope:** Medium

## Task 10: Render accessible result comparison

**Description:** Add a comparison view to Run details that defaults replay descendants against their source and clearly separates ignored from material changes.

**Acceptance criteria:**
- [ ] The UI renders source/replay identity, status/error differences, added/removed/changed/type-changed nodes, ignored paths, and non-comparable/truncated warnings without unsafe HTML.
- [ ] Users can edit/save project ignore rules, preview their effect before saving, reset filters, and copy a deterministic comparison summary; clipboard/API failures are accessible.
- [ ] Project/run/rule changes fence stale responses, preserve the selected result tab, and never trigger replay or alter a debug draft.

**Verification:**
- [ ] Tests pass: `npx vitest run src/client/features/comparisons src/client/features/runs`
- [ ] Build succeeds: `npm run typecheck && npm run build`
- [ ] Manual check: compare a replay, add an ignore rule, confirm the diff updates, reload, and confirm the rule persists.

**Dependencies:** Task 9

**Files likely touched:**
- `src/client/features/comparisons/RunComparison.tsx`
- `src/client/features/comparisons/__tests__/RunComparison.test.tsx`
- `src/client/features/runs/RunResultPanel.tsx`
- `src/client/app/app.css`

**Estimated scope:** Medium

### Checkpoint: Comparison

- [ ] Pure diff property/fuzz tests and API ownership tests pass.
- [ ] Replay descendants compare correctly across success, failure, and truncation states.
- [ ] Full Vitest, typecheck, build, and existing production Playwright pass.
- [ ] Independent review finds no unsafe JSONPath behavior or stale-response races.

### Phase 4: Production Acceptance

## Task 11: Prove History and Replay end to end

**Description:** Extend the production-build Playwright fixture and documentation to prove the complete history→preflight→replay→comparison workflow.

**Acceptance criteria:**
- [ ] E2E executes a source Run, changes the Tool Schema, proves replay is blocked until drift/risk confirmations, then releases a deterministic replay and verifies lineage plus exact original arguments.
- [ ] E2E proves source and replay protocol traces/results remain isolated, history filters/pins survive reload, comparison applies a persisted ignore rule, and no action sends a duplicate Tool call.
- [ ] README documents only the delivered History/Replay/Diff behavior and its safety limits; package allowlist, shutdown, auth, migrations 001–007, and Core E2E remain green.

**Verification:**
- [ ] Tests pass: `npm run verify`
- [ ] Package succeeds: `npm pack --dry-run --json`
- [ ] Manual check: run the packaged CLI, complete one replay comparison, close it, and confirm no listener/process remains.

**Dependencies:** Tasks 3, 6, and 10

**Files likely touched:**
- `e2e/history-replay.spec.ts`
- `src/server/connections/__tests__/streamable-session.integration.test.ts`
- `README.md`
- `package.json`

**Estimated scope:** Medium

### Checkpoint: Complete

- [ ] All task acceptance criteria and the standing Definition of Done are satisfied.
- [ ] `npm run verify`, package allowlist, migration byte checks, diff checks, and open-handle checks pass.
- [ ] Independent Spec/Quality/Security review returns no Critical or Required findings.
- [ ] Human reviews and approves before merge or release.

## Dependency Graph

```text
Task 1 lineage/pin ──> Task 2 history API ──> Task 3 history UI ───────────────┐
          │                                                                  │
          └────────────> Task 4 preflight ─> Task 5 replay ─> Task 6 replay UI├─> Task 11 E2E
                                                              │              │
Task 7 diff engine ──> Task 8 rules ──> Task 9 compare API ─> Task 10 diff UI ┘
```

Tasks 4 and 7 may proceed in parallel after Task 1's public Run lineage contract is fixed. Tasks 3 and 5 may also proceed in parallel because they share only the reviewed Run types/API contract. Migration tasks remain sequential (006 before 007).

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Tool Schema changes after user confirms replay | High | Bind execution to a preflight digest over current snapshot, annotations, source arguments, and confirmation requirements; stale digest returns a new preflight without calling MCP. |
| Destructive Tool replay | High | Treat destructive or unknown annotations as confirmation-required; show exact arguments and connection/Tool; never auto-retry. |
| Replay bypasses proven Run isolation | High | Route replay into the existing Run state machine and observer path; add concurrent original/replay tests and deterministic E2E barriers. |
| Cursor reuse leaks/mixes filters | High | Canonically bind project, Tab, and every normalized filter into the cursor; validate server and client identities. |
| JSONPath becomes code execution or prototype mutation | High | Implement a small parser, never `eval`; reject unsupported syntax and prototype keys; immutable traversal with limits and adversarial tests. |
| Large diffs freeze the browser | Medium | Bound server diff nodes/serialized bytes, report truncation, and progressively render/collapse UI sections. |
| Source or replay result was already truncated | Medium | Mark non-comparable explicitly and show stored size/hash metadata; never compare previews as full values. |
| Original Tab/Tool/connection disappears | Medium | Replay is Tab-independent but requires the source connection and current Tool; block with stable diagnostics and never create a partial Run. |
| History/replay response races overwrite another project | High | Reuse project/run generation fences, AbortSignals, and strict runtime decoders at every client boundary. |

## Open Questions

- Saved test cases should later reuse `ReplayPreflight` and comparison rules, but are intentionally excluded from this slice.
- Retention cleanup should treat `pinned` Runs and replay/comparison references as protected; the cleanup job remains a separate hardening plan.
- Arbitrary comparison between unrelated Runs is designed as an explicit mode; the first implementation may ship replay-lineage comparison only if UI scope needs to remain smaller.

## Definition of Done

- Every behavior change has a test that fails without it and passes with it.
- Full existing and new tests, typecheck, production build, real MCP integration, and production Playwright pass.
- Migration source/dist copies are byte-identical and upgrades are tested from every prior schema version.
- Auth, project ownership, untrusted JSON/result rendering, replay side effects, and JSONPath parsing receive independent security review.
- Public behavior and limitations are documented in timeless language; no deferred capability is claimed.
- Package contents remain allowlisted, shutdown leaves no listener/open handles, and the worktree is clean.
- Human approval is required before merge or release.
