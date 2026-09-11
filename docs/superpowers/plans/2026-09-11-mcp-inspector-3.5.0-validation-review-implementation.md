# MCP Inspector 3.5.0 Evidence-Based Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an external AI author and execute evidence-backed Tool tests, ordered multi-Tool Scenarios, and Suites through Authoring MCP, while Inspector freezes the exact source revision, owns deterministic evidence, and reserves final expectation confirmation for a browser-authenticated human.

**Architecture:** Extend the existing Draft and test runners rather than creating a second execution engine. A new project-scoped Validation Session module atomically binds an exact Draft, Test Case, or Suite revision to its execution and immutable evidence; AI assessment is an untrusted versioned overlay, and Human Review is a separate browser-only state machine. Dynamic Scenario expectations resolve only from previously extracted variables. Existing Run, connection-policy, redaction, identity, and cleanup semantics remain authoritative.

**Tech Stack:** Node.js 22, TypeScript, Hono, MCP TypeScript SDK, Zod, better-sqlite3, React 19, Vitest, Testing Library, Playwright, QuickJS.

**Spec:** [`../specs/2026-09-11-mcp-inspector-3.5.0-validation-review-design.md`](../specs/2026-09-11-mcp-inspector-3.5.0-validation-review-design.md)

## Global Constraints

- Do not add a model Provider, embedded Agent loop, model credentials, repository reader, or chat interface.
- Read and follow `docs/FRONTEND-DEVELOPMENT-STANDARDS.md` before every client task.
- Treat migration `024_run_invocation_sources.sql` as the required baseline. Before creating migration 025, confirm 024 is committed and authoritative; do not edit it or migrations 001–023.
- Preserve project, connection, Tool snapshot, tab, Run, Draft, source revision, execution, session, evidence, and review identity isolation.
- Keep connection authentication keyed by connection ID. Source labels, locators, prose, and AI assessments never grant access.
- Keep secrets and source excerpts out of URLs, ordinary logs, Toast messages, default exports, browser storage, and persisted evidence values.
- Reuse shared Zod schemas at MCP, REST, service, repository, and client boundaries.
- A static Draft validation never freezes editing. Only atomically starting real Tool execution claims the active source slot.
- Never hold a SQLite transaction across a downstream Tool call.
- Completed executions, evidence versions, AI assessment versions, and Human Review decisions are append-only.
- Keep Scenario execution sequential. Use existing Suite concurrency for independent cases; do not add DAGs, runtime AI planning, or unbounded loops.
- Add a failing regression test before every behavior change. Run focused tests per task and `npm run verify` at every marked checkpoint.
- Commit only files belonging to the task. The worktree contains unrelated user changes; inspect `git status --short` before every commit and stage exact paths only.

## Fixed Contract Decisions

The implementation must use these discriminated unions consistently:

```ts
type ValidationSource =
  | { kind: "DRAFT"; draftId: string; revision: number; definitionDigest: string }
  | { kind: "TEST_CASE"; testCaseId: string; revision: number }
  | { kind: "TEST_SUITE"; suiteId: string; revision: number };

type ValidationExecutionMode = "MANUAL_EXECUTION" | "AGENT_DRIVEN";
type ValidationPhase =
  | "DRAFT" | "VALIDATED" | "READY" | "RUNNING" | "EVALUATING"
  | "COMPLETED" | "CANCELLED" | "INTERRUPTED" | "ERROR";
type MachineVerdict = "PASS" | "FAIL" | "INCONCLUSIVE" | "ERROR";
type ReviewState = "NOT_READY" | "PENDING" | "APPROVED" | "NEEDS_CHANGE" | "REJECTED";
```

Use `source_kind + source_id + source_revision` as the freeze identity. A Suite session freezes the Suite revision; each child Test Case revision is captured in the session snapshot and guarded separately while that Suite session is active. The partial unique index prevents two active sessions for the same primary source, while the mutation guard also checks captured Suite members.

Existing Scenario step storage continues to use its current statuses. Evidence projection derives `NOT_APPLICABLE` from a condition-false skip and `BLOCKED` from a dependency-failure skip; do not widen existing execution status enums merely to model review semantics.

---

## Slice A — Shared contracts and durable identity

### Task 1: Add Draft source provenance and expectation claims

**Files:**

- Modify: `src/shared/authoring/draft.ts`
- Modify: `src/server/authoring/authoring-draft-service.ts`
- Modify: `src/server/authoring/authoring-draft-validator.ts`
- Modify: `src/server/authoring/__tests__/authoring-draft-service.test.ts`
- Modify: `src/server/authoring/__tests__/authoring-draft-validator.test.ts`

- [x] Add failing parsing tests for old Draft JSON, bounded `sourceRefs`, all four expectation target kinds, duplicate local IDs, missing source references, cross-test assertion references, low confidence, and conflicting authoritative sources.
- [x] Define strict shared schemas for `SourceReference`, `ExpectationTarget`, and `ExpectationClaim`. Add optional `sourceRefs: []` and `expectationClaims: []` defaults without changing the Draft definition version.
- [x] Keep provenance metadata bounded: local IDs 128 characters, labels 300, locators 2,000, excerpts 4,000, statements 2,000, rationales 4,000, and at most 500 sources/claims per Draft, still under the existing 2 MiB Draft cap.
- [x] Validate that every claim resolves to exactly one assertion in its own Tool Test or Scenario location. Reject prose-only claims with `EXPECTATION_CLAIM_INVALID`.
- [x] Treat two authoritative references to the same normalized locator with different digests as a source-revision conflict and mark the claim attention-required/inconclusive. Do not infer semantic conflict merely because two different sources have different digests; semantic conflict is surfaced by required review priority or an AI `REQUIREMENT_CONFLICT` assessment.
- [x] Include source references and claims in the existing canonical definition digest and whole-bundle replacement semantics.
- [x] Run `npx vitest run src/server/authoring/__tests__/authoring-draft-service.test.ts src/server/authoring/__tests__/authoring-draft-validator.test.ts` and `npm run typecheck`.
- [x] Commit with `feat(authoring): add expectation provenance contracts`.

### Task 2: Add variable-backed expected operands

**Files:**

- Modify: `src/shared/testing/assertions.ts`
- Modify: `src/shared/testing/assertion-engine.ts`
- Modify: `src/shared/testing/test-case.ts`
- Modify: `src/server/testing/scenario-runner.ts`
- Modify: `src/shared/testing/__tests__/assertion-engine.test.ts`
- Create: `src/shared/testing/__tests__/test-case.test.ts`
- Modify: `src/server/testing/__tests__/scenario-runner.test.ts`

- [x] Add failing tests for literal expected values remaining unchanged, `expectedSource: { source: "VARIABLE", path }`, mutual exclusion with `expected`, missing variables, redacted variables, and rejection on operators that do not consume an expected operand.
- [x] Define `assertionExpectedSourceSchema` in `assertions.ts` to avoid a circular import with `test-case.ts`; allow only `VARIABLE` in 3.5.0.
- [x] Extend `evaluateAssertion` to resolve the expected operand from the existing `AssertionContext`, returning `ERROR` when the path cannot be resolved and preserving the authored `expectedSource` in the definition snapshot.
- [x] Add current Scenario variables to each step assertion context. Do not expose environment secrets or persist a resolved secret as `expected`.
- [x] Extend static Scenario validation so dynamic expected variables must be created by an extractor in an earlier main-flow step; reject forward, cleanup-to-main, missing, and cross-Scenario references.
- [x] Run `npx vitest run src/shared/testing/__tests__/assertion-engine.test.ts src/shared/testing/__tests__/test-case.test.ts src/server/testing/__tests__/scenario-runner.test.ts` and `npm run typecheck`.
- [x] Commit with `feat(testing): support scenario variable expectations`.

### Task 3: Add Validation Session and evidence persistence

**Files:**

- Create: `src/server/projects/migrations/025_validation_sessions.sql`
- Create: `src/shared/authoring/validation-session.ts`
- Create: `src/server/authoring/validation-session-repository.ts`
- Create: `src/server/authoring/__tests__/validation-session-repository.test.ts`
- Modify: `src/server/projects/__tests__/migration-source.test.ts`
- Modify: `src/server/projects/__tests__/migration-dist-parity.test.ts`
- Modify: `src/server/projects/__tests__/project-migrations.test.ts`

- [x] Preflight with `git status --short` and `git log -- src/server/projects/migrations/024_run_invocation_sources.sql`; stop if migration 024 is not an authoritative committed baseline.
- [x] Add failing fresh-install, 024-upgrade, rollback, source-byte, dist-parity, project-isolation, active-source uniqueness, and restart-interruption tests.
- [x] Create `validation_sessions` with source identity, mode, phase, aggregate verdict/review state, exact source snapshot JSON/digest, Tool Schema hashes JSON, linked Draft/Test/Suite execution IDs, timestamps, and optimistic revision.
- [x] Add a partial unique index on `(project_id, source_kind, source_id)` for phases `READY`, `RUNNING`, and `EVALUATING`.
- [x] Create append-only `validation_evidence_versions` and `validation_expectation_evidence` tables. Bound JSON columns, store redaction/truncation metadata, and foreign-key every row through project+session identity.
- [x] Create append-only `validation_ai_assessments` and `validation_ai_assessment_findings` tables with version, request hash, idempotency key, evidence digest, and bounded explanation.
- [x] Implement repository transactions for start/claim, phase transition, evidence completion, assessment append, and restart interruption. Terminal sessions and completed evidence must reject updates.
- [x] Export strict shared summary/detail/page/evidence schemas and project-bound cursor inputs.
- [x] Run the focused migration/repository tests, `npm run typecheck`, then `npm run verify` as Checkpoint A.
- [x] Commit with `feat(validation): persist sessions evidence and assessments`.

### Task 4: Add Human Review persistence

**Files:**

- Create: `src/server/projects/migrations/026_human_reviews.sql`
- Create: `src/shared/authoring/human-review.ts`
- Create: `src/server/authoring/human-review-repository.ts`
- Create: `src/server/authoring/__tests__/human-review-repository.test.ts`
- Modify: `src/server/projects/__tests__/migration-source.test.ts`
- Modify: `src/server/projects/__tests__/migration-dist-parity.test.ts`
- Modify: `src/server/projects/__tests__/project-migrations.test.ts`

- [ ] Add failing tests for upgrading from 025, optimistic review revisions, append-only decisions, exact evidence-digest binding, transaction rollback, batch audit rows, and exact formal-asset revision verification links.
- [ ] Create one `validation_reviews` aggregate row per session and append-only `validation_review_decisions` rows for the six approved decision kinds.
- [ ] Create `validation_review_batches` plus membership rows so one batch action remains auditable per expectation.
- [ ] Create `validated_asset_links` keyed by exact project, asset kind, asset ID, and asset revision; link session, evidence version, and approved review revision.
- [ ] Enforce foreign keys and triggers that prevent cross-project links, nonterminal evidence links, and verification of a revision different from the session snapshot.
- [ ] Run focused migration/repository tests, `npm run typecheck`, and `npm run verify` as Checkpoint B.
- [ ] Commit with `feat(review): persist human decisions and verification links`.

---

## Slice B — AI-driven Tool Test walking path

### Task 5: Implement the Validation Session state machine and source freeze

**Files:**

- Create: `src/server/authoring/validation-session-service.ts`
- Create: `src/server/authoring/validation-source-guard.ts`
- Create: `src/server/authoring/__tests__/validation-session-service.test.ts`
- Modify: `src/server/authoring/authoring-draft-service.ts`
- Modify: `src/server/authoring/__tests__/authoring-draft-service.test.ts`

- [ ] Add race tests for replace-versus-start, duplicate starts, static validation without a lock, terminal unlock, unchanged-revision rerun, cancel while cleanup is pending, and restart interruption before unlock.
- [ ] Expose `start`, `get`, `list`, `transition`, `completeEvidence`, `cancel`, and `interruptActive` behind one service; validate every phase transition against an explicit transition table.
- [ ] In one immediate SQLite transaction, recheck source revision/digest and validation digest, snapshot the full source plus Tool Schema hashes, create the session, and claim the active-source slot.
- [ ] Recheck the exact revision immediately before the first downstream call without holding the transaction open.
- [ ] Add `assertMutable(projectId, source)` to the source guard. Inject it into Draft replacement/discard/apply paths; translate its typed error to `DRAFT_VALIDATION_ACTIVE`.
- [ ] Cancellation sets intent, stops future business steps, and leaves the slot active until cleanup and evidence projection reach a terminal phase.
- [ ] On first repository access after restart, transition active sessions to `INTERRUPTED`, preserve completed evidence/Run links, and only then allow mutation.
- [ ] Run `npx vitest run src/server/authoring/__tests__/validation-session-service.test.ts src/server/authoring/__tests__/authoring-draft-service.test.ts` and `npm run typecheck`.
- [ ] Commit with `feat(validation): freeze active source revisions`.

### Task 6: Project deterministic Tool Test evidence

**Files:**

- Create: `src/server/authoring/validation-evidence-projector.ts`
- Create: `src/server/authoring/__tests__/validation-evidence-projector.test.ts`
- Modify: `src/shared/authoring/validation-session.ts`
- Modify: `src/server/authoring/authoring-redaction.ts`

- [ ] Add failing fixture tests for PASS, FAIL, assertion ERROR, missing actual, unknown non-idempotent outcome, redacted values, oversized/deep results, stable ordering, and stable evidence digests.
- [ ] Project one evidence item per expectation claim with target locator, sanitized arguments, expected/actual or absence reason, assertion result, Run ID, connection ID, Tool name, Schema hash, timing, and truncation/redaction counts.
- [ ] Map deterministic results without AI input: assertion pass→`PASS`, assertion fail→`FAIL`, resolver/runtime corruption→`ERROR`, and unknown external effect or authoritative conflict→`INCONCLUSIVE`.
- [ ] Canonicalize evidence in claim/step/attempt order and hash the completed bounded projection. Never digest before redaction and never persist raw MCP responses.
- [ ] Derive the session verdict by severity `ERROR > INCONCLUSIVE > FAIL > PASS`; a session with zero resolved claims is `ERROR`.
- [ ] Run `npx vitest run src/server/authoring/__tests__/validation-evidence-projector.test.ts` and `npm run typecheck`.
- [ ] Commit with `feat(validation): project immutable tool evidence`.

### Task 7: Attach Draft execution to Validation Sessions

**Files:**

- Modify: `src/shared/authoring/execution.ts`
- Modify: `src/server/authoring/authoring-draft-execution-service.ts`
- Modify: `src/server/authoring/__tests__/authoring-draft-execution-service.test.ts`
- Modify: `src/server/authoring/authoring-workspace-routes.ts`
- Modify: `src/server/authoring/__tests__/authoring-workspace-routes.test.ts`

- [ ] Add failing tests proving a claimed Draft execution returns `validationSessionId`, binds the exact execution ID, freezes before the first call, completes evidence after assertions, and unlocks only after terminal evidence projection.
- [ ] Add optional `validationSessionId` to execution summary/detail schemas so 3.0.0 clients remain compatible.
- [ ] When claims exist, make `start` call the Validation Session service first and persist the returned session ID on the Draft execution before scheduling work.
- [ ] Feed Tool Test results and Run identities into the evidence projector. Transition `READY → RUNNING → EVALUATING → terminal` around existing execution phases.
- [ ] Preserve current independent-test continuation behavior after ordinary assertion failure. On cancel, still run already-applicable Scenario cleanup before completing the session.
- [ ] If session creation or execution scheduling fails, roll back the start operation so no orphan active lock remains.
- [ ] Run focused Draft execution/workspace route tests and `npm run typecheck`.
- [ ] Commit with `feat(authoring): validate draft executions with evidence`.

### Task 8: Expose session reads and AI assessment over MCP

**Files:**

- Create: `src/server/authoring/ai-assessment-service.ts`
- Create: `src/server/authoring/__tests__/ai-assessment-service.test.ts`
- Modify: `src/server/authoring/authoring-mcp-server.ts`
- Modify: `src/server/authoring/__tests__/authoring-mcp-routes.test.ts`
- Modify: `src/shared/authoring/protocol.ts`

- [ ] Add failing tests for paginated session reads, one bounded detail, incomplete findings, stale evidence digest, idempotent replay, conflicting reuse, version preservation, disagreement with machine verdict, prompt-like prose, and attempted review mutation.
- [ ] Implement `submit` so findings cover every current expectation exactly once, use the completed evidence digest, and append a new assessment version without changing evidence, claims, authority, machine verdict, or review state.
- [ ] Register `inspector_list_validation_sessions`, `inspector_get_validation_session`, `inspector_submit_ai_assessment`, and `inspector_get_review_status` using the existing Authoring envelope and project-bound cursors.
- [ ] Add stable error translation for session/evidence/assessment errors. Keep approval, correction, rejection, batch confirmation, and verification mutations absent from MCP.
- [ ] Extend capabilities with protocol feature flags rather than changing existing Tool names or response fields.
- [ ] Run focused assessment/MCP tests, `npm run typecheck`, then `npm run verify` as Checkpoint C.
- [ ] Commit with `feat(authoring): expose validation assessment tools`.

---

## Slice C — Human-executed saved tests

### Task 9: Carry Draft claims through atomic Apply mappings

**Files:**

- Modify: `src/server/authoring/authoring-apply-service.ts`
- Modify: `src/server/authoring/authoring-apply-repository.ts`
- Modify: `src/server/authoring/__tests__/authoring-apply-service.test.ts`
- Modify: `src/server/authoring/authoring-asset-service.ts`
- Modify: `src/shared/authoring/apply.ts`

- [ ] Add failing tests that applied assets remain disabled/unverified, map each formal asset revision to its exact Draft revision/local test ID, reject stale or absent claim mappings, and never duplicate AI prose into formal test definitions.
- [ ] Extend Apply result reads with optional validation provenance and verified-state summaries while preserving the existing atomic Apply behavior.
- [ ] Resolve future claims only through `authoring_draft_asset_mappings` plus the immutable Draft revision; fail closed when the formal asset revision no longer matches.
- [ ] Ensure `inspector_save_draft` cannot describe an asset as verified without an exact `validated_asset_links` row.
- [ ] Run focused Apply/asset tests and `npm run typecheck`.
- [ ] Commit with `feat(authoring): preserve validation provenance on apply`.

### Task 10: Link ordinary Test Case execution to manual Validation Sessions

**Files:**

- Modify: `src/server/testing/test-case-service.ts`
- Modify: `src/server/testing/test-execution-service.ts`
- Modify: `src/server/testing/__tests__/test-case-service.test.ts`
- Modify: `src/server/testing/__tests__/test-execution-service.test.ts`
- Modify: `src/shared/testing/test-execution.ts`
- Modify: `src/server/testing/test-case-routes.ts`

- [ ] Add failing tests for starting an applied AI-authored asset, automatic `MANUAL_EXECUTION` session creation, exact revision binding, mutation/removal rejection while active, normal Runs, terminal evidence, and post-terminal editing into a new revision.
- [ ] Inject the source guard into `TestCaseService.update/remove` and return `TEST_ASSET_VALIDATION_ACTIVE` from browser routes.
- [ ] Add an optional validation coordinator to `TestExecutionService.start`; when an applicable Apply mapping exists, claim the Test Case revision before queuing execution and store `validationSessionId` on the execution.
- [ ] Reuse the same evidence projector and phase transitions as Draft execution. Do not alter behavior for ordinary tests with no Authoring provenance.
- [ ] Prevent baseline update from using results of an active or completed claimed validation as an implicit expectation correction; correction must go through Human Review and a new Draft revision.
- [ ] Run focused test-case/execution/route tests and `npm run typecheck`.
- [ ] Commit with `feat(testing): validate ai-authored saved tests`.

### Task 11: Aggregate Suite execution into a manual Validation Session

**Files:**

- Modify: `src/server/testing/test-suite-service.ts`
- Modify: `src/server/testing/test-suite-execution-service.ts`
- Modify: `src/server/testing/__tests__/test-suite-service.test.ts`
- Modify: `src/server/testing/__tests__/test-suite-execution-service.test.ts`
- Modify: `src/shared/testing/test-suite-execution.ts`

- [ ] Add failing tests for exact Suite revision plus member-revision snapshotting, Suite and member mutation locks, existing independent concurrency, partial member completion, cancellation, aggregate evidence, and restart interruption.
- [ ] Claim the Suite as primary source and record each member Test Case revision in the session snapshot before dispatch.
- [ ] Make the source guard reject Suite mutation and mutation of captured members while the Suite session is active.
- [ ] Link each child `TEST_SUITE` Test execution and its Runs to the parent session. Aggregate expectation evidence after all runnable members terminate; preserve child errors rather than flattening them into generic failure.
- [ ] Keep Suite concurrency and stop/continue settings unchanged. Do not introduce cross-member variables.
- [ ] Run focused Suite tests, `npm run typecheck`, then `npm run verify` as Checkpoint D.
- [ ] Commit with `feat(testing): aggregate suite validation evidence`.

---

## Slice D — Ordered multi-Tool Scenario depth

### Task 12: Instrument Scenario data flow and skip reasons

**Files:**

- Modify: `src/server/testing/scenario-runner.ts`
- Modify: `src/server/testing/__tests__/scenario-runner.test.ts`
- Modify: `src/server/authoring/authoring-draft-execution-service.ts`
- Modify: `src/server/testing/test-execution-service.ts`
- Modify: `src/shared/authoring/validation-session.ts`

- [ ] Add a create→poll→read→cleanup fixture spanning multiple connection IDs and Tools, with literal/input/environment/variable/step-response mappings and a variable-backed expected operand.
- [ ] Extend runner result metadata—not persisted argument values—with one `ScenarioDataFlowEvidence` record per resolved mapping: target step/path, source kind, optional source step/path, value digest, and redaction flag.
- [ ] Compute the digest from the redacted canonical resolved value. For a secret environment source, emit only a keyed/non-reversible digest plus `isRedacted: true`; never expose the value to persistence.
- [ ] Add an internal skip reason `CONDITION_FALSE` or `DEPENDENCY_BLOCKED` while preserving the current stored step status. Project these to review semantics `NOT_APPLICABLE` and `BLOCKED`.
- [ ] Keep every polling attempt linked to its own Run. Verify the authored terminal condition determines the step result and the AI cannot alter the loop at runtime.
- [ ] Pass instrumentation through both Draft and ordinary Test execution adapters without changing invocation authorization.
- [ ] Run focused Scenario, Draft execution, and Test execution tests and `npm run typecheck`.
- [ ] Commit with `feat(testing): record scenario data flow evidence`.

### Task 13: Project hierarchical Scenario verdicts and cleanup evidence

**Files:**

- Modify: `src/server/authoring/validation-evidence-projector.ts`
- Modify: `src/server/authoring/__tests__/validation-evidence-projector.test.ts`
- Modify: `src/shared/authoring/validation-session.ts`
- Modify: `src/server/authoring/authoring-draft-validator.ts`
- Modify: `src/server/authoring/__tests__/authoring-draft-validator.test.ts`

- [ ] Add failing evidence fixtures for main PASS/cleanup PASS, main PASS/cleanup FAIL, main FAIL/cleanup PASS, unknown non-idempotent call, missing extraction, condition-false skip, dependency block, polling exhaustion, and cancellation with cleanup.
- [ ] Preflight all main/cleanup targets, Schema hashes, policies, mapping/extractor order, conditions, bounded polling, transforms, dynamic expected sources, and worst-case call budget before claiming execution readiness.
- [ ] Project hierarchy `scenario → main/cleanup → step → attempt → Run → assertion/extraction/data-flow` with stable IDs and ordering.
- [ ] Derive `mainFlow`, `cleanup`, and `overall` separately. Cleanup failure can prevent overall PASS but must never replace or hide the main-flow verdict/error.
- [ ] Use the approved mappings: business assertion failure→FAIL; required mapping/extraction missing→ERROR; unknown non-idempotent effect→INCONCLUSIVE; condition-false→NOT_APPLICABLE; dependency failure→BLOCKED.
- [ ] Verify cleanup continues after ordinary failure/cancellation when inputs are known and never claims to roll back the external effect.
- [ ] Run focused projector/validator tests, `npm run typecheck`, then `npm run verify` as Checkpoint E.
- [ ] Commit with `feat(validation): add hierarchical scenario verdicts`.

---

## Slice E — Browser-only Human Review workbench

### Task 14: Implement Human Review rules and browser routes

**Files:**

- Create: `src/server/authoring/human-review-service.ts`
- Create: `src/server/authoring/human-review-routes.ts`
- Create: `src/server/authoring/__tests__/human-review-service.test.ts`
- Create: `src/server/authoring/__tests__/human-review-routes.test.ts`
- Modify: `src/server/app.ts`

- [ ] Add failing tests for every individual decision, passing-only batch confirmation, low confidence, source conflict, AI/machine disagreement, stale review revision, stale evidence digest, confirmed implementation defect, correction, and exact verification link creation.
- [ ] Implement eligibility: batch confirmation requires machine PASS, AI PASS, AI confidence not LOW, no authoritative conflict, and no existing attention condition. Return `REVIEW_ITEM_REQUIRES_INDIVIDUAL_ACTION` atomically if any selection is ineligible.
- [ ] Derive review aggregate: unresolved→PENDING; reject→REJECTED; correction/more evidence/environment issue→NEEDS_CHANGE; all confirmed or classified implementation defects→APPROVED.
- [ ] Keep current conformance separate: `IMPLEMENTATION_DEFECT` confirms the expectation but leaves machine FAIL visible.
- [ ] Implement `CORRECT_EXPECTATION` by creating a new editable Draft revision/source with a required correction reason; never mutate completed evidence or the reviewed source.
- [ ] Mount list/detail/individual/batch/correction routes only after browser session authentication. Do not pass the service to `AuthoringMcpServer`.
- [ ] Require expected review revision and evidence digest on every mutation; stale requests must create no decision rows.
- [ ] Run focused service/route/app auth tests and `npm run typecheck`.
- [ ] Commit with `feat(review): add browser-only human decisions`.

### Task 15: Wire runtime services in one ownership graph

**Files:**

- Modify: `src/server/main.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/__tests__/main.test.ts`
- Modify: `src/server/authoring/__tests__/authoring-restart.test.ts`

- [ ] Add failing bootstrap tests proving Draft, Test Case, and Suite executions share one Validation Session/source-guard instance and all services close once in reverse dependency order.
- [ ] Construct workflow/test/test-suite execution services in `main.ts` before Authoring MCP and browser routes, then inject them into `createApp`; remove duplicate fallback construction for the production path.
- [ ] Inject Validation Session into Draft/Test/Suite execution, AI assessment, Human Review, MCP reads, and browser routes. Keep the Human Review mutation service out of MCP dependencies.
- [ ] On startup, interrupt active Validation Sessions after project migrations and before accepting source mutations. On shutdown, cancel/close runners before closing repositories/projects.
- [ ] Verify no circular dependency is introduced: runners emit results; the coordinator projects evidence; source services consult only the narrow guard interface.
- [ ] Run focused main/restart tests, `npm run typecheck`, and `npm run verify` as Checkpoint F.
- [ ] Commit with `refactor(server): wire validation service ownership`.

### Task 16: Add client contracts and review data controller

**Files:**

- Modify: `src/client/api/api-client.ts`
- Create: `src/client/features/authoring/useValidationReview.ts`
- Create: `src/client/features/authoring/__tests__/useValidationReview.test.tsx`
- Modify: `src/shared/i18n/locales/zh-CN/app.ts`
- Modify: `src/shared/i18n/locales/en-US/app.ts`

- [ ] Add failing tests for strict response decoding, prioritized filters, pagination, detail loading, individual/batch mutations, correction, cancellation, and stale-response fencing.
- [ ] Add typed API methods for session list/detail, review package, individual decision, batch confirmation, correction, and active-source status.
- [ ] Implement one controller that keys state by project ID, session ID, expectation ID, execution ID, review revision, and request generation; clear selection and abort/ignore late responses on project change.
- [ ] Never store evidence or review data in `localStorage`; keep only existing locale preferences there.
- [ ] Add complete zh-CN/en-US terms for machine verdict, review state, decisions, freeze state, main/cleanup flow, redaction, truncation, and data-flow sources.
- [ ] Run focused hook/API tests and `npm run typecheck`.
- [ ] Commit with `feat(review): add client validation controller`.

### Task 17: Build the three-pane Validation workbench

**Files:**

- Modify: `src/client/features/authoring/AuthoringPage.tsx`
- Modify: `src/client/features/authoring/AuthoringWorkspace.tsx`
- Create: `src/client/features/authoring/ValidationWorkspace.tsx`
- Create: `src/client/features/authoring/ValidationQueue.tsx`
- Create: `src/client/features/authoring/ExpectationReview.tsx`
- Create: `src/client/features/authoring/ValidationEvidence.tsx`
- Modify: `src/client/features/authoring/authoring.css`
- Modify: `src/client/features/authoring/__tests__/AuthoringPage.test.tsx`
- Create: `src/client/features/authoring/__tests__/ValidationWorkspace.test.tsx`

- [ ] Re-read `docs/FRONTEND-DEVELOPMENT-STANDARDS.md`; add failing keyboard, focus, screen-reader, project-switch, long bilingual content, responsive, and reduced-motion tests.
- [ ] Add a `验证` view using existing tabs, split panes, tokens, Buttons, Dialogs, form fields, and Phosphor icons. Default queue order is inconclusive/unknown, source conflict, fail, AI disagreement, low confidence, then ordinary pass.
- [ ] Show expected statement, sources/authority, deterministic verdict, AI assessment/confidence, Human Review state, and current implementation conformance as separate fields.
- [ ] Allow batch selection only for eligible passing claims. Force attention items through the individual decision dialog with explanation where required.
- [ ] Render Scenario evidence collapsed at overall/main/cleanup first, expandable through step, attempt, assertion, extraction, data-flow edge, and linked Run.
- [ ] While a source is active, make its editor read-only, identify frozen revision/session, and expose cancel only. After terminal, show `再次执行` and `继续修改` with the required reason selector.
- [ ] Correction opens a visible old/new expectation difference and creates a new revision; completed evidence remains read-only.
- [ ] Preserve current Draft/Call workspace behavior and clear all validation selection on project change.
- [ ] Run focused UI tests, `npm run typecheck`, and `npm run verify` as Checkpoint G.
- [ ] Commit with `feat(ui): add validation review workbench`.

---

## Slice F — Hardening and release

### Task 18: Add adversarial integration and production E2E coverage

**Files:**

- Create: `src/server/authoring/__tests__/validation-security.test.ts`
- Create: `e2e/validation-review.spec.ts`
- Modify: `playwright.config.ts` only if the existing project matrix cannot run the new spec unchanged

- [ ] Cover same-URL/different-auth connection isolation from Draft through Run and evidence.
- [ ] Cover prompt-like Tool descriptions, response bodies, source excerpts, and AI explanations; prove they cannot change authorization, assertions, review, or verification.
- [ ] Cover non-idempotent timeout as unknown/inconclusive without retry.
- [ ] Cover schema, Draft/source revision, policy, environment identity, and evidence-digest drift before mutation.
- [ ] Cover create→poll→read→cleanup Scenario lineage, separate cleanup verdict, condition skip, blocked dependency, dynamic expected value, and data-flow digests.
- [ ] Cover both end-to-end paths, passing batch confirmation, individual implementation-defect classification, correction to a new revision, active freeze, cancellation cleanup, and restart interruption.
- [ ] Verify secrets never appear in URL, logs, Toasts, default export, browser storage, evidence JSON, or screenshots.
- [ ] Run `npx vitest run src/server/authoring/__tests__/validation-security.test.ts`, the focused Playwright spec, and `npm run verify`.
- [ ] Commit with `test(validation): cover adversarial review flows`.

### Task 19: Finish accessibility, documentation, and release metadata

**Files:**

- Modify: `README.md`
- Create: `docs/authoring-mcp.md`
- Create: `docs/validation-and-human-review.md`
- Create: `docs/reviews/2026-09-11-release-3.5-independent-review.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Document the external-AI/Inspector/human trust boundary, both execution modes, Scenario freeze/edit lifecycle, MCP tools, browser-only review operations, evidence limits, and stable errors.
- [ ] State clearly that `APPROVED` confirms expectations, not current conformance, and that a confirmed implementation defect remains failing.
- [ ] Document migration/backup expectations and that active sessions become interrupted rather than replayed after restart.
- [ ] Complete manual keyboard, focus, screen reader, light/dark, reduced-motion, narrow/wide viewport, and long zh-CN/en-US checks from the frontend standard.
- [ ] Run `npm run verify`, `npm run verify:release-artifacts`, and `npm run test:e2e`.
- [ ] Conduct an independent security/privacy/accessibility review; resolve every critical or required finding and record the result in the release notes.
- [ ] Update package version to `3.5.0` only after every prior checkpoint passes.
- [ ] Inspect `git diff --check` and `git status --short`; ensure migrations 001–024 are byte-identical and no unrelated user changes are staged.
- [ ] Commit with `chore(release): prepare mcp inspector 3.5.0`.

## Final Acceptance Checklist

- [ ] Both `AGENT_DRIVEN` Draft and `MANUAL_EXECUTION` saved-asset paths produce the same session/evidence/assessment/review representation.
- [ ] Real execution freezes the exact source atomically; static validation does not; cleanup completion controls terminal unlock.
- [ ] Old sessions, evidence, assessments, and reviews cannot approve or verify a newer Draft/Test/Suite revision.
- [ ] AI assessment cannot change deterministic verdicts, expected values, authority, reviews, or verified links.
- [ ] Only browser-authenticated Human Review mutations can confirm, correct, classify, reject, batch-confirm, or verify.
- [ ] Passing batch execution does not pause for a human; every completed expectation still remains pending until reviewed.
- [ ] Scenario execution stays authored, sequential, bounded, and reproducible, with per-attempt Runs and inspectable data lineage.
- [ ] Cleanup failure affects overall verdict without concealing main-flow outcome.
- [ ] Every downstream call uses the exact project/connection identity and current Authoring policy.
- [ ] Migrations 001–024 remain byte-identical; fresh install, upgrade, packaged parity, and rollback tests pass.
- [ ] `npm run verify`, release artifact verification, production E2E, and independent review pass.

## Execution Handoff

Recommended execution order is strictly Task 1 through Task 19 because shared schemas and migration ownership are serial dependencies. Within a task, only independent fixture writing or visual verification may be delegated after the relevant contract is fixed. Stop at each checkpoint if the full gate fails; diagnose and repair the failure before beginning the next slice.
