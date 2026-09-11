# MCP Inspector 3.5.0 Evidence-Based Validation and Human Review Design

## Status

| Field | Value |
|---|---|
| Status | Approved in design discussion; written review pending |
| Target release | `3.5.0` |
| Current application version | `3.0.0` |
| Current project migration baseline | `001`–`024` |
| Date | 2026-09-11 |
| Depends on | [MCP Inspector 3.0.0 Authoring MCP Design](./2026-09-09-authoring-mcp-design.md) |

## 1. Decision summary

MCP Inspector 3.5.0 keeps the 3.0.0 architecture in which an external AI Host owns
reasoning and conversation while Inspector exposes a local authenticated Authoring MCP
interface. Inspector does not embed a model, Provider configuration, an Agent loop, or a
chat page.

The release adds evidence-based validation and human review. An external AI may analyze
Tool definitions, product requirements, code, or natural-language expected behavior;
author Tool tests, scenarios, and suites; invoke authorized Tools through Inspector; and
submit an assessment of the results. Inspector remains authoritative for execution,
deterministic assertions, identity, permissions, audit, redaction, persistence, and
evidence. Only a human using the browser UI can confirm the final business expectation.

Two execution paths share one model:

1. The AI authors an initially disabled test asset that a human executes later.
2. The AI authors and trial-runs a Draft through Authoring MCP before human review.

Both paths create a `ValidationSession`, immutable execution evidence, an optional AI
assessment, and a human review. A failed assertion does not interrupt ordinary batch
execution. Failed, inconclusive, conflicting, or low-confidence expectations receive
attention priority in the review queue. Passing expectations can be batch-confirmed, but
they are not human-confirmed until that action occurs.

## 2. Product outcome

The user should be able to give an external AI a Tool description plus any combination of
requirements, code context, and natural-language expectations. The AI should turn that
context into executable test proposals and expected outcomes. Inspector should execute
those proposals without giving the AI direct access to credentials, SQLite, files, Node,
or internal application services. After execution, the user should see exactly:

- what was expected and why;
- what Inspector executed and observed;
- what deterministic assertions concluded;
- what the AI concluded and with what confidence;
- where the two conclusions disagree;
- which exact revision and evidence the human approved.

The product promise is:

> AI may propose a conclusion, Inspector proves what happened, and a human confirms what
> counts as correct business behavior.

## 3. Goals and non-goals

### Goals

- Support AI-authored expectations derived from Tool definitions, product requirements,
  code references, and user-provided behavior.
- Support both human-executed saved tests and AI-driven Draft trial execution.
- Reuse the existing Tool Test, Scenario, Suite, Draft, Run, assertion, workflow,
  environment, QuickJS, and connection policy models.
- Produce immutable, redacted evidence bound to exact project, connection, Tool Schema,
  Draft/test revision, execution, and Run identities.
- Keep Inspector deterministic verdicts separate from AI assessments.
- Provide an exception-prioritized browser review workflow with batch confirmation for
  passing expectations.
- Require a browser-authenticated human decision before an expectation or asset can be
  described as human-confirmed or verified.
- Preserve all released SQLite data and add only numbered migrations.

### Non-goals

- Embedding a model, Provider adapter, autonomous Agent loop, or chat UI.
- Inspector scanning a source repository or fetching requirement documents.
- Persisting model hidden reasoning or complete external AI conversations.
- Allowing an AI to approve its own assessment, update a baseline from actual output, or
  silently weaken an assertion.
- Remote or LAN Authoring access, multi-user roles, electronic signatures, or multiple
  Authoring Tokens.
- Defect-tracker integration, CI scheduling, or release gating.
- Allowing the AI to modify product code, connection credentials, secrets, shared Tool
  workflow scripts, schedules, or pressure tests.
- A second test-definition model or a second downstream invocation engine.

## 4. Domain model

### 4.1 Canonical terms

`SourceContext` is the bounded set of sources used to derive a test expectation.

`TestProposal` is an AI-authored Tool Test, Scenario, or Suite represented inside the
existing Authoring Draft model.

`ExpectationClaim` states one expected business outcome, connects it to one executable
assertion, and records its rationale, sources, and confidence.

`ValidationSession` binds an exact authored revision, execution mode, environment,
Tool snapshots, executions, evidence, assessment, and review lifecycle.

`ExecutionEvidence` is Inspector-owned, immutable, redacted proof of the input, actual
output, deterministic assertion, and Run lineage relevant to one expectation.

`AIAssessment` is an untrusted, versioned recommendation submitted by the external AI.
It never changes an expectation or evidence.

`HumanReview` is the browser-authenticated decision that confirms, corrects, classifies,
or rejects an expectation. It is the only source of human-confirmed status.

### 4.2 Source authority

```ts
type SourceAuthority = "AUTHORITATIVE" | "INFORMATIVE" | "OBSERVED";

type SourceKind =
  | "TOOL_DEFINITION"
  | "PRODUCT_REQUIREMENT"
  | "CODE_REFERENCE"
  | "USER_EXPECTATION";

interface SourceReference {
  localId: string;
  kind: SourceKind;
  authority: SourceAuthority;
  label: string;
  locator?: string;
  digest?: string;
  excerpt?: string;
}
```

User-designated requirements and explicit user expectations may be authoritative. Tool
descriptions, Tool Schemas, design prose, and code analysis are informative by default.
Historical and current executions are observed. Observed behavior never replaces an
authoritative expectation automatically. Conflicting authoritative sources produce an
inconclusive result that requires individual review.

Inspector captures Tool definition and Schema snapshots itself. AI-supplied labels,
locators, digests, and excerpts are untrusted provenance metadata, not authority to read
files, open URLs, grant permissions, or alter identity.

### 4.3 Expectation claims

```ts
interface ExpectationClaim {
  localId: string;
  testCaseLocalId: string;
  assertionId: string;
  statement: string;
  rationale: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  sourceRefs: string[];
  reviewPriority: "NORMAL" | "REQUIRED";
}
```

Every claim must reference an assertion in the same Draft test case. Natural-language
claims without an executable assertion are validation errors. A low-confidence claim may
execute, but it is always attention-required during review.

### 4.4 Orthogonal states

One field must not mix execution, verdict, and review semantics.

```ts
type ValidationPhase =
  | "DRAFT"
  | "VALIDATED"
  | "READY"
  | "RUNNING"
  | "EVALUATING"
  | "COMPLETED"
  | "CANCELLED"
  | "INTERRUPTED"
  | "ERROR";

type MachineVerdict = "PASS" | "FAIL" | "INCONCLUSIVE" | "ERROR";

type ReviewState =
  | "NOT_READY"
  | "PENDING"
  | "APPROVED"
  | "NEEDS_CHANGE"
  | "REJECTED";
```

Machine verdict and review state exist per expectation. A session also stores derived
aggregates. Its machine verdict uses severity order `ERROR`, `INCONCLUSIVE`, `FAIL`, then
`PASS`. Its review aggregate remains `PENDING` while any expectation is undecided, becomes
`REJECTED` if the test is rejected, becomes `NEEDS_CHANGE` when correction or more
evidence is required, and becomes `APPROVED` only when every expectation has been human
confirmed or classified as a confirmed implementation defect.

Completed sessions enter `PENDING`, including passing sessions. Passing claims are
eligible for batch confirmation. Failed, inconclusive, error, conflicting, and
low-confidence claims require individual review and cannot be included in a passing
batch action. `APPROVED` means the expectations were reviewed; it does not mean the
current implementation passed them. Current conformance is always shown from the
separate machine verdict.

## 5. Architecture and module seams

```text
External AI Host
├── code/requirement/Tool analysis
├── Authoring MCP client
└── test proposal and assessment reasoning
              │
              ▼
MCP Inspector process
├── Authoring MCP adapter
├── existing Draft module, extended with provenance and claims
├── Validation Session module
├── Evidence module
├── AI Assessment module
├── Human Review module
├── existing ConnectionRuntime and RunService
├── existing deterministic test runners and assertions
├── existing project SQLite storage
└── browser review workbench
              │ exact connectionId
              ▼
Configured downstream MCP Servers
```

### 5.1 Draft module

The Draft module remains the only pending representation of tests and suites. It accepts
optional source references and expectation claims in addition to the existing definition.
Replacement remains whole-bundle, revisioned, digest-bound, and idempotent. Editing a
Draft increments its revision and makes older validation, execution, and review decisions
inapplicable to the new revision while retaining their history.

### 5.2 Validation Session module

This is the primary deep module introduced by 3.5.0. Its interface accepts an exact Draft
or AI-authored formal asset revision and execution mode. Its implementation coordinates
existing validation, execution, Run creation, cleanup, deterministic assertions,
evidence projection, assessment readiness, cancellation, and restart recovery.

```ts
type ValidationExecutionMode = "MANUAL_EXECUTION" | "AGENT_DRIVEN";
type ValidationSource =
  | { kind: "DRAFT"; draftId: string; revision: number; definitionDigest: string }
  | { kind: "TEST_ASSET"; assetId: string; revision: number };
```

The module never interprets AI prose as permission or as a deterministic assertion. It
does not hold a SQLite transaction while awaiting MCP. It records external-effect intent
before invocation and preserves `UNKNOWN` outcomes through an inconclusive verdict.

### 5.3 Evidence module

Evidence is a bounded projection, not a copy of complete Run payloads. The module stores
stable evidence IDs, expectation ID, sanitized arguments, expected value, actual value or
absence reason, assertion result, Run ID, Tool Schema hash, timing, redaction count, and
truncation metadata. Complete protocol data remains in the existing Run model.

Every completed projection receives an `evidenceDigest`. Assessment and review writes
must provide the exact digest. Evidence is immutable after completion.

### 5.4 AI Assessment module

The AI may submit one versioned assessment per expectation at a time:

```ts
interface SubmitAIAssessmentInput {
  projectId: string;
  sessionId: string;
  evidenceDigest: string;
  idempotencyKey: string;
  findings: Array<{
    expectationLocalId: string;
    verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
    confidence: "HIGH" | "MEDIUM" | "LOW";
    explanation: string;
    suggestedClassification?:
      | "IMPLEMENTATION_DEFECT"
      | "EXPECTATION_DEFECT"
      | "REQUIREMENT_CONFLICT"
      | "ENVIRONMENT_ISSUE"
      | "MORE_EVIDENCE_REQUIRED";
  }>;
}
```

New assessment versions preserve the previous version. An assessment cannot change
source authority, an assertion, expected value, actual value, machine verdict, execution,
or review state.

### 5.5 Human Review module

Review mutation is available only through browser-session-protected routes. The module
supports:

- `CONFIRM_EXPECTATION`;
- `CORRECT_EXPECTATION`;
- `IMPLEMENTATION_DEFECT`;
- `ENVIRONMENT_ISSUE`;
- `MORE_EVIDENCE_REQUIRED`;
- `REJECT_TEST`.

Correcting an expectation creates a new Draft revision. It never changes the completed
session or evidence. Batch confirmation accepts only claims whose machine verdict and AI
assessment are passing, whose confidence is not low, and whose sources are not in
conflict. Every review binds project ID, session ID, source revision, evidence digest,
decision, optional explanation, and browser session audit metadata.

`IMPLEMENTATION_DEFECT` confirms that the expectation is correct while preserving a
failing current-conformance verdict. It may therefore contribute to an approved review,
but it can never make the execution appear to have passed. `ENVIRONMENT_ISSUE` and
`MORE_EVIDENCE_REQUIRED` leave the expectation unresolved.

## 6. User journeys

### 6.1 AI design, human execution

1. The AI discovers Tools and analyzes external source context.
2. It creates and validates an Authoring Draft containing tests and claims.
3. It applies the Draft as disabled, unverified formal assets.
4. The UI labels the assets as AI-authored, not executed, and not human-confirmed.
5. A human starts the ordinary test execution later.
6. Inspector creates a `MANUAL_EXECUTION` Validation Session and links the normal Runs.
7. Inspector creates evidence and deterministic verdicts.
8. The AI may read the session and add an assessment.
9. The human reviews the result. Only then may the exact asset revision be marked
   verified.

### 6.2 AI-driven execution

1. The AI creates and validates a Draft.
2. It calls the existing Draft execution interface.
3. Inspector creates an `AGENT_DRIVEN` Validation Session and executes within current
   connection policy.
4. Ordinary assertion failure does not pause the remaining independent work.
5. Unknown non-idempotent effect, unsafe cleanup failure, stale identity, or a hard budget
   stops dependent work.
6. Inspector creates evidence; the AI submits its assessment.
7. The session appears in the review queue.
8. The human batch-confirms eligible passing claims and individually handles attention
   items.
9. Applying or revising assets remains bound to the exact reviewed Draft revision.

## 7. Interface changes

### 7.1 Backward-compatible Authoring MCP evolution

The existing 3.0.0 tools remain. Draft source and expectation fields are optional, so an
existing client may continue creating ordinary Drafts. Existing Draft execution creates a
Validation Session when claims are present and adds `validationSessionId` as an optional
result field.

Add the following MCP tools:

```text
inspector_list_validation_sessions
inspector_get_validation_session
inspector_submit_ai_assessment
inspector_get_review_status
```

The tools use the existing Authoring success/failure envelope, project-scoped opaque
cursors, strict shared Zod schemas, mandatory redaction, request limits, and idempotency
rules. Review status is read-only over MCP. There is no MCP approval, correction, batch
confirmation, or verified-status mutation tool.

`inspector_save_draft` continues to create disabled formal assets. Without an applicable
approved Human Review, those assets are `UNVERIFIED`; its name and current atomic Apply
semantics remain backward compatible.

### 7.2 Browser routes

Browser-session-protected routes expose:

- paginated review queues and filters;
- one complete bounded review package;
- one individual decision;
- batch confirmation of eligible passing claims;
- correction-to-new-Draft-revision;
- verified asset linkage.

All mutation requests require expected review revision and evidence digest. Stale writes
return a conflict and create no partial decision.

### 7.3 Stable errors

Add stable errors without exposing source excerpts, raw responses, paths, SQL, stacks, or
credentials:

```text
SOURCE_CONTEXT_INVALID
SOURCE_AUTHORITY_CONFLICT
EXPECTATION_CLAIM_INVALID
EXPECTATION_UNSUPPORTED
VALIDATION_SESSION_NOT_FOUND
VALIDATION_SESSION_STALE
VALIDATION_SESSION_ACTIVE
EVIDENCE_NOT_READY
EVIDENCE_STALE
ASSESSMENT_INCOMPLETE
ASSESSMENT_CONFLICT
REVIEW_NOT_READY
REVIEW_STALE
REVIEW_ITEM_REQUIRES_INDIVIDUAL_ACTION
REVIEW_DECISION_CONFLICT
```

## 8. Persistence

Released migrations `001`–`024` remain byte-identical.

`025_validation_sessions.sql` adds session identity, source kind/revision/digest,
execution mode, phase, machine verdict, timestamps, linked ordinary execution IDs,
bounded evidence projections, evidence digest, and versioned AI assessments.

`026_human_reviews.sql` adds review state/revision, individual decisions, batch audit
records, and exact formal asset revision verification links.

Source references and expectation claims remain in the existing versioned Draft JSON,
using backward-compatible optional fields. Formal test definitions do not duplicate AI
prose. Before human execution, the existing atomic Apply mapping links each unverified
formal asset revision back to the exact Draft revision and Draft-local test ID that owns
its claims. Validation Session creation resolves claims through that mapping and fails
closed if it is absent or stale. Verification metadata points to the immutable session
and review records.

No table stores credentials, resolved secret environment values, complete external AI
conversation, hidden reasoning, or duplicate raw MCP responses.

## 9. Review workbench

Add a `验证` view to the existing Authoring MCP page. It follows the existing high-density
workbench design and uses the current tokens, primitives, Phosphor icons, i18n, split-pane
behavior, and accessibility rules.

```text
Validation list       Expectation and decisions       Execution evidence
Needs attention       Expected statement              Arguments and actual value
Pending               Deterministic verdict           Assertion and Run lineage
Approved              AI assessment/confidence        Tool/source snapshots
Rejected              Human decision/explanation      Timeline and redaction state
```

Default ordering prioritizes unknown/inconclusive outcomes, authoritative-source
conflicts, deterministic failures, Inspector/AI disagreement, low confidence, then
ordinary passing work. Passing items may be selected and batch-confirmed. Attention items
must be opened and decided individually.

Correcting an expectation opens a new Draft revision with a visible old/new difference.
The completed evidence remains read-only. Project changes clear prior-project selection
and fence late responses by project, session, expectation, execution, review revision,
and request generation.

## 10. Safety and failure semantics

- Authorization remains keyed by exact project ID and connection ID, never URL, domain,
  display name, AI description, or source locator.
- Downstream Tool prose, code excerpts, source locators, responses, and AI assessments are
  untrusted data and never instructions to Inspector.
- Existing Authoring connection policies remain the execution permission boundary.
- Inspector records call intent before an external effect.
- Unknown non-idempotent outcomes are inconclusive and never automatically retried.
- Cleanup continues after ordinary failure and cancellation when its inputs are known.
- An unsafe cleanup failure blocks dependent work and receives attention priority.
- A changed Draft revision, Tool Schema, source digest, policy, environment identity, or
  evidence digest makes older decisions stale.
- AI disagreement cannot overwrite the deterministic verdict.
- Human correction cannot overwrite completed evidence.
- New formal tests remain disabled; enablement is a separate human action.

## 11. Verification matrix

### Unit and contract

- Strict parsing, size limits, cross-reference validation, source authority conflicts,
  and backward-compatible Draft parsing.
- Orthogonal state transitions and terminal-state immutability.
- Deterministic evidence projection and digest stability.
- AI assessment versioning, idempotency, and forbidden mutation attempts.
- Individual review decisions, passing-only batch confirmation, stale revisions, and
  correction-to-new-revision behavior.

### Migration and persistence

- Fresh installation and upgrade from migration 024.
- Byte identity of migrations 001–024.
- Atomic migration failure rollback and source/dist migration parity.
- Restart interruption of active sessions without loss of completed evidence or reviews.
- Transaction rollback for review and verification-link failures.

### Integration and adversarial

- Same-URL/different-auth connections remain isolated end to end.
- Prompt-like Tool descriptions, response bodies, code excerpts, and assessments cannot
  alter authorization or review state.
- Non-idempotent timeout remains unknown and is not retried.
- Schema, Draft, source, policy, and evidence drift fail before mutation.
- Redaction covers credentials, resolved secrets, sensitive fields, and source excerpts.
- Large and deeply nested evidence is bounded without freezing the UI.

### UI and production E2E

- Complete AI-driven Draft-to-review flow.
- Complete AI-authored saved-test-to-manual-execution-to-review flow.
- Passing batch confirmation and individual attention-item decisions.
- Expectation correction creates a new revision and preserves old evidence.
- Keyboard, focus, screen-reader semantics, light/dark themes, reduced motion, long
  bilingual content, responsive layout, and project-switch identity fencing.
- `npm run verify`, release artifact checks, packaged migration parity, and an independent
  security/privacy/accessibility review.

## 12. Delivery slices

1. Contracts and persistence: Draft provenance/claims, Validation Session, Evidence,
   Assessment, Review, and migrations 025–026.
2. AI-driven Tool Test walking slice: Draft execution through evidence, assessment, and
   one browser review decision.
3. Human-executed saved-test slice: unverified formal asset through ordinary execution,
   automatic session linkage, and verification.
4. Scenario and Suite depth: multi-step evidence, polling, cleanup, transforms, aggregate
   verdicts, and partial independent execution.
5. Review workbench: prioritized queue, three-pane detail, passing batch confirmation,
   attention decisions, and correction diff.
6. Release hardening: isolation, restart, unknown outcomes, redaction, limits,
   accessibility, production E2E, documentation, and independent review.

Each slice must deliver a working vertical path. Migration files and shared contracts
must have one owner. Independent UI fixtures and adversarial tests may proceed in
parallel only after the relevant shared contracts are fixed.

## 13. Acceptance criteria

- An external AI can derive test proposals and claims from Tool definitions plus bounded
  requirement/code/user source references without Inspector reading those sources.
- Both execution modes produce the same Validation Session, Evidence, Assessment, and
  Review representation.
- Every formal asset described as verified points to an approved review of its exact
  revision, evidence digest, Tool Schema hashes, and executions.
- Human-confirmed expectation status is displayed separately from current implementation
  conformance; a confirmed implementation defect remains visibly failing.
- The AI cannot approve, batch-confirm, correct, reject, or mark an asset verified over
  MCP.
- No observed actual value can silently become a new expected value.
- Passing work does not interrupt execution and can be batch-confirmed later.
- Failed, inconclusive, error, conflicting, and low-confidence items cannot be approved by
  the passing batch path.
- Every downstream invocation remains a normal traceable Run using the exact connection
  identity and current authorization policy.
- Unknown non-idempotent effects are never automatically retried.
- Existing projects, Draft clients, tests, Runs, and SQLite data continue to work.
- The full repository verification and release gates pass with no unresolved critical or
  required independent-review finding.

## 14. Implementation-plan boundary

The implementation plan must follow the six vertical slices above, use tests before each
behavior change, list exact files and interfaces per task, preserve migrations 001–024,
and require `npm run verify` at checkpoints affecting persistence, core execution,
routing, layout, or production entry. It must not revive the historical embedded
Provider/autonomous Agent plans that the 3.0.0 Authoring MCP design superseded.
