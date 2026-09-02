# Implementation Plan: Run History, Safe Replay, and Comparison

## Document status

| Item | Value |
|---|---|
| Status | Complete; independent review approved, awaiting explicit release authorization |
| Date | 2026-09-01 |
| Current schema | migrations 001–015 |
| Required new migrations | 014 and 015 |
| Final gate | Vitest 826/826, production Playwright 7/7, independent review approved |

## 1. Goal

Add searchable and pinnable Run history, explicit safe replay, and bounded structural comparison without duplicating the automated-testing 1.5.0 domain or bypassing the existing Run/Workflow invocation paths.

The existing “打开调试” action restores a historical request and response into a new Tool Tab. It is not replay: it does not call MCP. This plan keeps that behavior and introduces a separately named, explicitly confirmed “回放” action.

## 2. Rebaseline decisions

The previous plan is superseded by this document for these reasons:

1. Migration 006 is `saved_tool_items`; migration 007 is connection Headers. Replay lineage and pin state now use migration 014.
2. Migrations 012–013 implement automated testing and historical suite-member identity. Comparison rules now use migration 015.
3. Saved test cases, assertions, baseline updates, execution reports, and test-definition import/export are already delivered by automated testing 1.5.0 and are removed from replay scope.
4. UI work must use the internal Foundation, shared `zh-CN/en-US` resources, Phosphor icons, and the existing single-scroll-owner rules.
5. Replay must use connection ID and the existing Run/Workflow invocation seam. URL/domain matching and hidden debug Tabs remain prohibited.

## 3. Scope

### Included

- Project Run-history filters, pinning, lineage, and stable pagination.
- Read-only replay preflight with current Tool snapshot and risk/drift confirmation.
- One explicit replay execution through the existing Run engine.
- Source-versus-replay structural comparison and project ignore rules.
- Production E2E, bilingual UI, migrations, packaging, and security review.

### Excluded

- Creating test cases or updating test baselines from replay; existing automated-testing actions remain the only path.
- Automated retries, schedules, retention jobs, headless CI, arbitrary workflow graphs, or replaying against another Server.
- Import/export of Run history or comparison data.
- Executable JSONPath, remote schema references, JavaScript expressions, or client-supplied response data.

## 4. Architecture contracts

### Identity

- Every operation is fenced by `projectId` and stable Run IDs.
- Replay always targets the source Run's exact `connectionId` and Tool name; it never resolves a connection by URL or name.
- A replay Run receives its own ID, idempotency key, immutable Tool snapshot, request, response, events, and terminal state.
- Source Runs remain immutable. Lineage is additive and can only point to a Run in the same project.

### Safety

- Preflight performs no connection, Tool call, Tab mutation, environment mutation, or Run insertion.
- Unknown or destructive side effects require explicit confirmation. MCP annotations are hints, not trusted guarantees.
- Schema drift and side-effect risk are separate confirmations.
- Execution requires a digest over the source identity, exact canonical arguments, current Tool snapshot, annotations, and confirmation requirements. Catalog changes invalidate the digest before any call.
- Replay does not coerce, add, delete, or “repair” arguments and never retries automatically.

### Comparison

- Comparison reads stored project-owned Run results; the browser cannot submit result bodies to compare.
- Truncated, missing, active, corrupt, or non-JSON responses are explicitly non-comparable.
- JSONPath ignores use only `$`, property segments, bracket-quoted keys, numeric indexes, and `[*]`.
- Recursive descent, filters, scripts, unions, slices, prototype keys, excessive depth/count, and ambiguous syntax are rejected.
- Diff output is deterministic and bounded by node count and serialized byte size.

## 5. Data model

### Migration 014 — replay lineage and pin state

- Add a constrained `pinned` flag to `runs`, default false.
- Add nullable `replayed_from_run_id` with self-reference semantics and same-project enforcement.
- Add indexes for project/pinned/history and source-to-descendant lookup.
- Preserve every existing Run payload; new columns default safely.
- Never rewrite migration 005 or any released migration.

Implementation must prove SQLite behavior for connection cascade, source deletion, and lineage cleanup before selecting `SET NULL` versus explicit lineage cleanup. The chosen behavior must not make an existing Server undeletable as an accidental side effect.

### Migration 015 — comparison ignore rules

- Store ordered project-scoped rules with stable IDs and timestamps.
- Enforce project ownership and bounded unique normalized expressions.
- Rules contain paths only, never response values or secrets.
- Deleting a project cascades rules; deleting Runs does not mutate rules.

## 6. Delivery tasks

### Task 1: Lock shared contracts and migration 014

Deliver exhaustive runtime schemas for history filters, lineage, pin mutation, replay preflight, replay request, and stable errors. Add migration 014 with 001–013 byte-preservation and upgrade tests.

Acceptance:

- [x] Run summary/detail expose `pinned` and nullable replay source without weakening existing decoders.
- [x] Same-project lineage is enforced in service and SQLite.
- [x] Existing 1.0.x/1.5 data opens without data loss; migration is repeat-safe through the project migration runner.
- [x] Source/dist migration bytes match after build.

Verification: shared schema tests, migration upgrade/foreign-key tests, `npm run typecheck && npm run build`.

### Task 2: Deliver filtered history and pinning

Extend repository, API, client, and history page as one vertical slice.

Acceptance:

- [x] Filters cover status, connection ID, exact Tool name, original/replay, pinned state, and canonical UTC bounds.
- [x] Cursor binds project, optional Tab, normalized filters, sort key, and limit; mismatches return a stable cursor error.
- [x] Pin/unpin is explicit, project-fenced, idempotent, and never opens or executes a Tool.
- [x] Project and current-Tab history keep separate fences; project/filter changes discard stale pages and mutations.
- [x] UI supports Apply/Reset, pagination, keyboard operation, bilingual copy, and Foundation primitives.

Verification: Run repository/routes/API/UI tests and full existing Run-history regression.

### Task 3: Deliver deterministic replay preflight

Build a read-only service and endpoint over a source Run and the current Tool catalog.

Acceptance:

- [x] Returns immutable source arguments, source/current snapshot IDs and hashes, deterministic schema changes, annotations, blockers, confirmations, and digest.
- [x] Missing source/current Tool/connection and removed Tool use stable errors.
- [x] Performs zero MCP calls and creates zero Runs/Tabs on every success and failure path.
- [x] Boolean/object schemas and unknown valid JSON Schema fields are handled without remote-reference resolution.

Verification: pure schema-diff tests, service tests with no-call spies, adversarial payload tests.

### Task 4: Execute replay through the existing Run engine

Add a replay start seam that reuses normal Run persistence, connection runtime, cancellation, trace, redaction, and terminal handling.

Acceptance:

- [x] Requires fresh idempotency key, current preflight digest, and every required confirmation.
- [x] Stale digest or missing confirmation creates no Run and makes no network call.
- [x] Uses exact canonical source arguments, source connection ID, current Tool snapshot, and nullable Tab association.
- [x] Persists lineage atomically and pins the source only according to the reviewed pin contract.
- [x] Duplicate activation creates at most one replay Run; cancellation and late completion preserve existing terminal CAS semantics.

Verification: replay/Run/connection integration tests, same-URL different-connection authentication fixture.

### Task 5: Deliver the replay confirmation UI

Add replay to historical Run actions without changing the current “打开调试” restore flow.

Acceptance:

- [x] Dialog shows exact connection, Tool, immutable arguments, blockers, schema drift, and side-effect risk.
- [x] Drift and risk confirmations are separate and accessible; stale responses refresh preflight rather than proceeding.
- [x] Successful start opens a read-only observed replay result and leaves every editable Tab draft unchanged.
- [x] Rapid activation is hard-gated; project/Run changes cancel or fence pending requests.
- [x] Chinese/English, dark/light, focus return, Escape, and keyboard flow are tested.

Verification: replay UI tests, DebugWorkspace/RunResultPanel regressions, production browser smoke.

### Task 6: Deliver bounded diff engine and migration 015

Implement the pure comparison engine and persisted project ignore-rule CRUD.

Acceptance:

- [x] Added/removed/changed/type-changed nodes use deterministic JSON Pointer locations.
- [x] Output limits return explicit truncation metadata instead of freezing or silently omitting changes.
- [x] Safe JSONPath subset is parsed without `eval`; prototype and executable syntax are rejected.
- [x] Ignore application is immutable and array wildcard behavior is deterministic.
- [x] Rule CRUD validates the complete ordered set atomically; migration 015 passes upgrade and byte tests.

Verification: property/adversarial diff tests, rules repository/routes/API tests, typecheck/build.

### Task 7: Deliver comparison API and UI

Compare a replay with its source using server-loaded results and a snapshot of current project rules.

Acceptance:

- [x] Both Runs must belong to the project and share direct replay lineage; unrelated arbitrary comparison is deferred.
- [x] Response includes statuses/errors, comparability, rule snapshot, bounded changes, and source/replay metadata.
- [x] Active, missing, truncated, corrupt, and failed Runs produce explicit states without mutation.
- [x] UI clearly separates material and ignored changes, supports rule preview/save, and copies a deterministic summary.
- [x] Rule/project/Run changes fence stale responses; JSON rendering uses existing safe viewer boundaries.

Verification: comparison service/API/UI tests and accessibility/identity-race regressions.

### Task 8: Close production acceptance

Extend the production fixture through history → preflight → confirmed replay → comparison.

Acceptance:

- [x] E2E changes a Tool schema, proves both confirmations and stale-digest rejection, then verifies exact arguments, lineage, traces, pin persistence, and one MCP call.
- [x] E2E applies a safe ignore rule and verifies deterministic comparison after reload.
- [x] Existing automated tests, reports, baseline updates, import/export, scripts, auth modes, and debug flows remain green.
- [x] README/CHANGELOG describe only delivered behavior and limitations.
- [x] Independent Spec/Quality/Security review has zero open Critical/Required.
- [x] `npm run verify`, migration 001–015 byte checks, `npm pack --dry-run --json`, `git diff --check`, and process cleanup pass.

## 7. Dependency graph

```text
Task 1 contracts + migration 014
  ├─> Task 2 filtered history + pin
  └─> Task 3 replay preflight -> Task 4 replay execution -> Task 5 replay UI

Task 6 diff + migration 015 -> Task 7 comparison API/UI

Tasks 2 + 5 + 7 -> Task 8 production acceptance
```

Migration work remains sequential: 014 must land before 015. No task may allocate another migration number without rebaselining this plan.

## 8. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Catalog changes after confirmation | High | Digest every execution-relevant preflight field; reject stale digest before Run creation |
| Replay causes destructive side effects | High | Separate risk confirmation, exact arguments, no retry, unknown means confirmation required |
| Connection authentication crosses same URL | Critical | Reuse exact source `connectionId`; integration fixture with distinct authentication |
| Replay bypasses Run isolation | Critical | Reuse existing Run state machine and observer; no hidden Tab or second MCP runtime |
| Cursor/filter identity mixes projects | High | Canonical cursor binding plus strict server/client ownership validation |
| JSONPath becomes executable | Critical | Small parser, no eval, reject prototype/expression syntax, adversarial tests |
| Large diff blocks UI | High | Server node/byte limits, explicit truncated result, progressive Disclosure rendering |
| Lineage changes Server delete behavior | High | Prove cascade semantics before migration approval; do not accidentally restrict existing deletion |
| Stale UI overwrites current project | High | Request generation fences and AbortSignals at report, replay, and rules boundaries |

## 9. Approval gate

This rebaseline is documentation only. Implementation begins only after human confirmation of:

1. Migration allocation 014 for Run pin/lineage and 015 for comparison rules.
2. Replay is limited to the source connection and current Tool; cross-Server replay is excluded.
3. First comparison release only compares a replay with its direct source; unrelated arbitrary Run comparison is deferred.
4. Pinning protects user-selected Runs from future retention, but must not accidentally block existing Server deletion behavior.

## 10. Definition of done

- Every behavior change has a regression test that fails without the change.
- Shared runtime schemas validate every client/server and SQLite JSON boundary.
- Existing project, connection, tab, Run, workflow, test, and authentication isolation remains intact.
- No secret enters URLs, Toasts, ordinary logs, browser storage, comparison rules, or default exports.
- UI follows `FRONTEND-DEVELOPMENT-STANDARDS.md` and provides matching `zh-CN/en-US` keys.
- Full verify, package, migrations, diff checks, process cleanup, and independent review pass.
