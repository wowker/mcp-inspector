# Development Plan: AI-Assisted Test Scenario and Suite Generation

## Document status

| Item | Value |
|---|---|
| Status | Proposed; implementation requires provider and data-sharing approval |
| Date | 2026-09-04 |
| Target users | MCP developers and testers building repeatable multi-Tool coverage |
| Scope | AI-generated test scenario and test-suite proposals |
| Task checklist | `tasks/ai-test-generation-todo.md` |
| Migration | Provisional next migration is 019; re-check immediately before implementation |

## 1. Problem statement

How might MCP Inspector help developers and testers turn a natural-language testing goal into valid, traceable scenario and suite definitions without giving an AI model authority to execute Tools, access credentials, or mutate the project without review?

Today users must understand every Tool schema, manually assemble scenario inputs, steps, mappings, extractors, assertions, cleanup, and suite membership. The difficult part is not entering JSON; it is translating a business flow into a structurally valid test design while preserving connection, Tool, step, Run, and secret boundaries.

Success means a user can describe a goal, select the exact Tools that may participate, receive a useful and explainable proposal, review it, and explicitly apply it as disabled test definitions that remain editable through the existing scenario and suite editors.

## 2. Product exploration and recommended direction

Six directions were evaluated:

| Direction | Value | Feasibility | Risk | Decision |
|---|---|---|---|---|
| Autonomous agent that creates and executes tests | High ceiling | Low | Critical agency and side effects | Reject for MVP |
| One-shot structured proposal for scenarios and suites | High | High | Manageable with validation and review | **MVP** |
| Copilot embedded in every scenario field | Medium | Medium | Fragmented UX and prompt cost | Later |
| Coverage expansion from existing tests | High | Medium | Needs coverage model and history context | Phase 2 |
| Failure-driven repair suggestions | High | Medium | Can normalize bad tests to flaky behavior | Phase 3 |
| Local-model-only generation | Medium | Provider-dependent | Lower data-sharing risk, variable quality | Adapter after MVP |

The recommended product is not an AI chat with workspace permissions. It is an **AI test-design proposal pipeline**:

```text
User intent + explicitly selected Tool metadata
→ bounded provider request
→ untrusted proposal AST
→ deterministic server compiler and validators
→ review with assumptions/warnings
→ explicit atomic apply as disabled definitions
→ ordinary editors and existing execution gates
```

This direction solves the core authoring problem while keeping the existing test definitions, services, Run/Workflow execution, destructive confirmation, and reports authoritative.

## 3. Key assumptions to validate

### Must be true

- [ ] Tool names, descriptions, input/output schemas, and annotations provide enough context for a model to propose useful multi-step flows. Validate with a fixed corpus of at least 20 representative Tool catalogs.
- [ ] A constrained proposal AST can express useful scenarios without allowing raw executable code. Validate with happy-path, error, boundary, polling, and cleanup fixtures.
- [ ] Users are willing to review AI proposals before persistence. Validate with task-completion tests comparing manual authoring against proposal review.

### Should be true

- [ ] Generating disabled definitions does not create excessive cleanup work. Measure accepted-without-major-rewrite rate.
- [ ] Opaque Tool aliases do not materially reduce model quality. Compare alias-based prompts with raw identity prompts offline.
- [ ] One bounded repair attempt materially improves valid-output rate without unacceptable latency or cost.

### Might be true

- [ ] Existing test definitions will later improve coverage generation.
- [ ] Run failures can later support safe repair suggestions.
- [ ] Local models will reach adequate schema-following quality for private catalogs.

## 4. MVP user flow

1. From **Automated tests** or **Test suites**, the user chooses **Create with AI**.
2. The wizard asks for a testing goal, such as “create an order, poll until ready, then clean it up.”
3. The user explicitly selects Servers and Tools. Nothing is selected implicitly across the whole project.
4. The user selects bounded coverage options: happy path, expected errors, boundary values, polling, and cleanup. Destructive Tools are excluded by default.
5. Before generation, the UI shows exactly which metadata categories and provider/model will receive data. It never shows or sends credential values.
6. The user starts generation. The job is cancellable and remains fenced by `projectId + generationId`.
7. The review page shows proposed scenarios, suite membership, assumptions, unresolved inputs, warnings, selected Tool identities, mappings, extractors, and assertions.
8. Invalid proposal items are not selectable. The user may discard individual cases or the whole proposal.
9. **Apply as disabled drafts** atomically creates the selected test cases and suites. No Tool runs.
10. The user opens the existing editors, makes any final edits, explicitly enables definitions, and later executes through the existing destructive-confirmation and idempotency gates.

## 5. MVP scope

### Included

- Generate new scenario test cases and suites from natural-language intent plus explicitly selected Tool definitions.
- Generate scenario inputs, fixed arguments containing safe placeholders/literals, mappings, extractors, assertions, polling policy, cleanup steps, tags, descriptions, and suite membership.
- Reference selected existing test cases as suite members when the user explicitly includes them.
- Explain assumptions and unresolved values separately from executable definitions.
- Detect removed/changed Tools, invalid references, suspicious secrets, unsupported features, and destructive annotations.
- Persist provider configuration and generation jobs with bounded retention.
- Cancel generation and atomically apply a ready proposal as disabled definitions.

### Not doing in MVP

- No automatic Tool execution, test enablement, baseline update, retry, scheduling, or release gating.
- No AI-created or AI-executed JavaScript, including the proposed argument-transform scripts. This may be considered later only behind separate review and QuickJS validation.
- No raw Run responses, HTTP/RPC traces, environment values, OAuth data, headers, or script logs in model context.
- No automatic edits, deletions, or overwrites of existing tests or suites.
- No free-form provider URL in the first hosted-provider release; custom endpoints and local providers need a separate SSRF and compatibility design.
- No long-lived chat memory, vector store, embeddings, RAG index, or cross-project learning.
- No autonomous “fix until green” loop.

## 6. Architecture contracts

### 6.1 Provider boundary

Define a small server-only adapter instead of coupling product services to one SDK:

```ts
interface AiStructuredGenerationRequest<TSchema> {
  systemInstruction: string;
  input: JsonValue;
  outputSchema: TSchema;
  maxOutputTokens: number;
  timeoutMs: number;
}

interface AiStructuredGenerationResult {
  output: unknown;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  };
  providerRequestId: string | null;
}

interface AiProviderAdapter {
  generateStructured(
    config: ResolvedAiProviderConfig,
    request: AiStructuredGenerationRequest<JsonObject>,
    signal: AbortSignal,
  ): Promise<AiStructuredGenerationResult>;
}
```

Product approval must choose the first provider adapter. Recommendation: start with one official hosted provider that supports schema-constrained structured output, while keeping the internal adapter provider-neutral. Provider protocol implementation must be grounded in that provider's current official documentation at implementation time.

Do not add a broad AI SDK unless direct HTTP cannot meet cancellation, structured output, usage reporting, and error requirements. If a dependency is proposed, review ownership, install scripts, provenance, transitive size, and production bundle impact first.

### 6.2 Provider configuration and credentials

Provider configuration has its own stable `providerId`; it is never keyed only by endpoint or model name.

```ts
interface AiProviderConfig {
  id: string;
  projectId: string;
  kind: "HOSTED_PROVIDER_V1";
  name: string;
  model: string;
  credential: {
    kind: "PROJECT_SECRET_VARIABLE";
    variableName: string;
  };
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

- Store only the reference to an existing project environment variable marked secret.
- Resolve the credential server-side immediately before the provider call.
- Never return the resolved key to the browser or include it in a prompt, URL, Toast, diagnostic, export, or ordinary log.
- The first provider kind owns a fixed trusted endpoint. A future custom endpoint must use an explicit mode with scheme/host validation, redirect rejection, DNS/IP checks, and separate approval.
- Model names are allowlisted or validated by the provider adapter; the model cannot choose another model.

### 6.3 Sanitized generation context

The server builds context from project-owned records. The browser does not submit Tool schemas or claim Tool identities.

Each selected Tool becomes an opaque alias:

```ts
interface AiToolContext {
  alias: string;                 // e.g. "tool-1"
  displayName: string;
  description: string;
  inputSchema: JsonObject;
  outputSchema: JsonObject | null;
  annotations: JsonObject | null;
  snapshotHash: string;
}
```

The alias map remains server-side and is bound to the generation job. The model never creates `projectId`, `connectionId`, persistent Tool IDs, test-case IDs, suite IDs, revision numbers, timestamps, or idempotency keys.

Before sending context:

- Load Tools only from the requested project and exact selected connection IDs.
- Reject removed Tools; snapshot current/changed identity and hash.
- Treat Tool descriptions and schemas as untrusted prompt content, not instructions.
- Remove suspicious credential-shaped fields, examples, and defaults.
- Redact all known project/server secret scalar values using the existing longest-first redactor.
- Bound selected Tools, schema depth, serialized bytes, and total prompt budget.
- Record a digest of the sanitized context and selected snapshot hashes, not credential values.

MVP limits:

- Maximum 30 selected Tools.
- Maximum 512 KiB sanitized catalog context.
- Maximum 20,000 characters of user intent and constraints.
- Maximum 10 proposed test cases, 3 suites, 50 total steps, and 100 suite members.
- One active generation per project and a provider timeout no greater than 90 seconds.
- Provider input/output token ceilings configured by the server, never the model.

### 6.4 Untrusted proposal AST

The model returns a purpose-built proposal, not `TestCaseDefinition`, SQL, code, HTML, or commands:

```ts
interface AiTestDesignProposal {
  version: 1;
  summary: string;
  assumptions: string[];
  testCases: AiProposedTestCase[];
  suites: AiProposedSuite[];
}

interface AiProposedScenario {
  proposalId: string;            // ephemeral identifier, not UUID authority
  kind: "SCENARIO";
  name: string;
  description: string;
  tags: string[];
  inputs: AiProposedInput[];
  steps: AiProposedStep[];
  cleanupSteps: AiProposedStep[];
  assertions: AiProposedAssertion[];
  failurePolicy: "STOP" | "CONTINUE";
  rationale: string;
}

interface AiProposedStep {
  proposalStepId: string;
  targetToolAlias: string;
  fixedArguments: JsonObject;
  mappings: AiProposedMapping[];
  extractors: AiProposedExtractor[];
  assertions: AiProposedAssertion[];
  condition: AiProposedAssertion | null;
  polling: PollingPolicy | null;
  onFailure: "STOP" | "CONTINUE" | "SKIP_REMAINING";
  rationale: string;
}

interface AiProposedSuite {
  proposalId: string;
  name: string;
  description: string;
  tags: string[];
  members: Array<
    | { kind: "PROPOSED_CASE"; proposalId: string }
    | { kind: "EXISTING_CASE"; testCaseAlias: string }
  >;
  executionPolicy: {
    concurrency: number;
    stopOnFailure: boolean;
  };
  rationale: string;
}
```

The AST deliberately excludes executable scripts, environment values, credentials, Run bodies, persistent IDs, enabled state, and destructive confirmation.

### 6.5 Deterministic proposal compiler

After parsing model output with a strict shared Zod schema, compile it using server-owned rules:

1. Resolve only aliases present in the job snapshot.
2. Replace proposal IDs with server-generated stable UUIDs.
3. Convert Tool aliases to the exact snapshotted `connectionId + toolName`.
4. Convert proposal-step references to stable generated step IDs.
5. Force every generated test case to `isEnabled: false`.
6. Sanitize suspicious credential-shaped literals and add blocking issues instead of guessing replacements.
7. Validate scenario ordering, mappings, extractors, assertions, polling, cleanup, counts, and JSON byte limits through existing shared schemas.
8. Validate suite members against selected compiled cases and explicitly selected existing cases.
9. Perform bounded compatibility checks against current Tool input schemas; unresolved scenario inputs remain explicit rather than guessed.
10. Produce a review model with `errors`, `warnings`, `assumptions`, and `requiresConfirmation` separate from definitions.

At most one repair attempt may be made when the provider output fails only structural proposal validation. The repair request contains bounded validation issues and the invalid proposal, consumes the same job budget, and cannot broaden Tool scope. Semantic/compiler failures are shown to the user and are not repaired automatically.

### 6.6 Generation job state machine

```text
QUEUED
  → GENERATING
  → VALIDATING
  → READY
  → APPLIED

QUEUED/GENERATING/VALIDATING → CANCELLED
QUEUED/GENERATING/VALIDATING → FAILED
READY → EXPIRED
```

Transitions are compare-and-set and terminal states never reopen. Service restart marks active jobs `INTERRUPTED`; it never silently repeats a billable provider request whose outcome is unknown.

Use a durable idempotency key and request hash. The same key with the same request returns the authoritative existing job; the same key with a different request returns `AI_GENERATION_CONFLICT`. An in-flight duplicate returns the existing job instead of making another provider request.

Cancellation aborts the provider request where possible and closes the observation fence. A late provider response cannot change a cancelled, failed, interrupted, expired, or applied job.

### 6.7 Atomic apply

`Apply` is the only mutation from proposal state into test definitions:

- Requires `generationId`, proposal digest, selected proposal IDs, and explicit warning confirmations.
- Re-checks project ownership, provider job state, Tool snapshot hashes, existing selected test cases, and current proposal validity.
- Returns `AI_TEST_DESIGN_STALE` before writing if Tool or selected existing-test identity changed.
- Creates selected cases first, then suites referencing them, inside one SQLite transaction.
- Uses server-generated IDs and existing repositories/shared schemas.
- Creates disabled test cases; it does not execute them or update baselines.
- Applies once. A repeated identical request returns the same apply result; a different selection after apply is rejected.
- Any failure rolls back every new test case, revision, target projection, suite, and suite member.

### 6.8 API surface

Provider configuration:

```text
GET    /api/projects/:projectId/ai/providers
POST   /api/projects/:projectId/ai/providers
PATCH  /api/projects/:projectId/ai/providers/:providerId
DELETE /api/projects/:projectId/ai/providers/:providerId
POST   /api/projects/:projectId/ai/providers/:providerId/check
```

Generation lifecycle:

```text
POST /api/projects/:projectId/ai/test-designs
GET  /api/projects/:projectId/ai/test-designs/:generationId
POST /api/projects/:projectId/ai/test-designs/:generationId/cancel
POST /api/projects/:projectId/ai/test-designs/:generationId/apply
```

Start request:

```ts
interface StartAiTestDesignRequest {
  idempotencyKey: string;
  providerId: string;
  intent: string;
  scope: {
    tools: Array<{ connectionId: string; toolName: string }>;
    existingTestCaseIds: string[];
  };
  constraints: {
    coverage: Array<"HAPPY_PATH" | "EXPECTED_ERROR" | "BOUNDARY" | "POLLING" | "CLEANUP">;
    maxTestCases: number;
    maxStepsPerCase: number;
    includeDestructiveTools: boolean;
  };
}
```

Stable errors include:

- `AI_PROVIDER_NOT_CONFIGURED`
- `AI_CREDENTIAL_UNAVAILABLE`
- `AI_PROVIDER_UNAVAILABLE`
- `AI_GENERATION_CONFLICT`
- `AI_GENERATION_LIMIT_REACHED`
- `AI_GENERATION_CANCELLED`
- `AI_GENERATION_INTERRUPTED`
- `AI_PROVIDER_OUTPUT_INVALID`
- `AI_PROPOSAL_INVALID`
- `AI_PROPOSAL_EXPIRED`
- `AI_TEST_DESIGN_STALE`
- `AI_APPLY_CONFLICT`

Client and server share all wire schemas. Provider-specific errors, stack traces, response bodies, request URLs, and credentials never become user-facing error messages.

## 7. Data model

Allocate the next available numbered migration at implementation time. The current observed maximum is 018, so 019 is provisional. Never modify migrations 001–018.

### `ai_provider_configs`

- Stable `id`, `project_id`, provider `kind`, name, model, credential variable reference, enabled flag, and timestamps.
- Unique project/provider identity; configuration belongs to one project.
- No API key or resolved environment value column.
- Project deletion cascades; deleting a referenced provider is blocked while an active generation exists.

### `ai_test_generation_jobs`

- Stable ID, project/provider IDs, idempotency key, request hash, state, sanitized request metadata, context digest, proposal digest, validated proposal JSON, bounded usage metadata, error JSON, expiry, and timestamps.
- Unique `(project_id, idempotency_key)` and `(project_id, id)`.
- Proposal JSON must satisfy size and JSON-object checks.
- Never stores provider authorization headers, raw provider request/response bodies, full prompts, environment values, or Tool response payloads.
- Applying clears any transient invalid provider output. Ready proposal retention defaults to seven days; applied/failed/cancelled metadata retains only bounded non-secret diagnostics and is removable from the UI.

If storing user intent is necessary for refreshable review, retain only the explicit intent and selected identities with the same expiry as the proposal. Do not persist the fully rendered provider prompt.

## 8. Security and privacy model

### Trust boundaries

1. User intent and selections enter the local API.
2. Project Tool descriptions/schemas enter the context builder as untrusted external MCP data.
3. Sanitized context leaves the local process for the selected provider.
4. Provider output re-enters as fully untrusted data.
5. Validated proposals cross into persistent test definitions only after explicit user action.

### Required controls

- The provider has no MCP tools, browser, filesystem, shell, database, or project API access.
- Model output is never passed to `eval`, QuickJS, SQL text, a shell, `innerHTML`, a file path, or a URL.
- All output passes strict schema parsing, alias resolution, project fences, existing test schemas, size/count limits, and semantic validation.
- Tool descriptions can contain prompt injection. Delimiting and system instructions help quality but are not a security boundary; lack of model authority and deterministic validation are the boundary.
- The user explicitly chooses Tool scope and sees a data-sharing summary before each provider request.
- Known secrets and suspicious secret-shaped fields are removed before provider submission.
- Credential references resolve only server-side and are excluded from prompt/output persistence.
- Provider calls use fixed trusted endpoints in MVP, HTTPS, bounded timeout/body sizes, redirect rejection, and generic errors.
- Limit one active job per project, generation frequency, repair count, output tokens, proposal counts, and response bytes to prevent unbounded consumption.
- Destructive Tools are excluded by default. Including them affects proposal scope only; execution still requires the existing destructive confirmation.
- Apply is explicit, atomic, stale-checked, idempotent, and creates disabled definitions.
- Project change, dialog close, cancellation, and generation identity changes prevent late responses from mutating the visible state.

### Privacy choices

- No Run responses or protocol traces are sent in MVP.
- No cross-project prompt, cache, history, or training corpus.
- No provider request is made merely by opening a page or selecting a Tool.
- UI states that selected metadata is sent to an external provider and identifies the configured provider/model.
- Provide deletion of generation history and provider configuration. Project deletion cascades both.
- Default exports exclude provider configurations, credentials, generation jobs, prompts, proposals, and usage metadata.

## 9. UI design

### Entry points

- **Automated tests** header: `Create` and `Create with AI`, with only the normal `Create` as the primary action until AI configuration is ready.
- **Test suites** header: `Create suite` and `Create with AI`.
- Empty states may explain AI generation but must not auto-open it.

### Wizard

Use one accessible Dialog or focused workspace, not a chat bubble overlay:

1. Goal and coverage.
2. Exact Server/Tool/test-case scope.
3. Data-sharing review and provider/model.
4. Generating status with cancel.
5. Proposal review.

The UI must define `initial`, `loading catalog`, `configuration missing`, `ready`, `generating`, `validating`, `partial-invalid`, `ready proposal`, `cancelled`, `failed`, `stale`, `applying`, `applied`, and `expired` states.

### Review presentation

- Compact list of proposed cases and suites, not a conversational transcript.
- Each case shows Tool sequence, inputs, mappings, extractors, assertions, polling, cleanup, rationale, and warnings.
- Tool names and parameter paths use mono text; protocol identifiers are not translated.
- Blocking errors prevent selection; warnings require explicit acknowledgement only when material.
- The final action says exactly what happens: **Create selected disabled tests**.
- Successful apply navigates to the created definitions in existing editors. Enabling and executing remain separate explicit actions.
- All copy exists in `zh-CN` and `en-US`; Dialog focus, Escape behavior, cancellation, stale responses, and long English text are tested.

## 10. Delivery plan

### Task 1: Lock proposal and job contracts

**Description:** Define strict shared schemas for provider configuration, generation requests/jobs, proposal AST, review issues, apply requests/results, stable states, limits, and errors.

**Acceptance criteria:**

- Model output cannot express persistent IDs, enabled state, code, credentials, raw URLs, or execution actions.
- Every array/string/JSON field has an explicit bound and strict unknown-field rejection.
- Client/server decoders accept every valid state and reject malformed or oversized payloads.

**Verification:** focused shared contract tests and typecheck.

**Dependencies:** None.

**Files likely touched:**

- `src/shared/ai/ai-provider.ts`
- `src/shared/ai/test-design.ts`
- focused shared tests

**Estimated scope:** Medium.

### Task 2: Add provider configuration persistence

**Description:** Add the next numbered migration, repository, and service for project-scoped provider configuration containing only a secret-variable reference.

**Acceptance criteria:**

- Existing 001–018 databases upgrade without payload or identity changes; migration runs exactly once and source/dist bytes match.
- Provider IDs are project-fenced and credentials are never persisted in provider rows.
- Deletion behavior is deterministic for active/referenced jobs.

**Verification:** migration matrix plus focused repository/service tests.

**Dependencies:** Task 1 and migration-number recheck.

**Files likely touched:**

- next migration SQL
- `src/server/ai/ai-provider-repository.ts`
- `src/server/ai/ai-provider-service.ts`
- focused migration/service tests

**Estimated scope:** Medium.

### Task 3: Deliver one bounded provider adapter

**Description:** Implement the approved hosted-provider adapter with fixed endpoint ownership, structured output, cancellation, usage extraction, timeout/body limits, and generic errors.

**Acceptance criteria:**

- Authorization is server-only and never appears in prompt, URL, logs, errors, or returned configuration.
- Timeout, abort, redirect, non-JSON, oversized body, provider rejection, and malformed structured output have stable outcomes.
- Adapter contract tests use a local HTTP fixture and make no live provider call.

**Verification:** focused provider-adapter tests and dependency/provenance review if applicable.

**Dependencies:** Tasks 1 and 2; provider approval.

**Files likely touched:**

- `src/server/ai/providers/hosted-provider-v1.ts`
- `src/server/ai/ai-provider-registry.ts`
- focused adapter tests

**Estimated scope:** Medium.

### Task 4: Build sanitized catalog context

**Description:** Load exact project/connection/Tool identities, assign opaque aliases, remove secrets, bound schemas, and calculate the context digest.

**Acceptance criteria:**

- Cross-project, removed, unknown, duplicate, and over-limit selections fail before any provider request.
- Known secret scalars and suspicious credential-shaped schema content are absent from serialized provider context.
- Tool snapshot hashes and alias maps are deterministic for the same selection.

**Verification:** adversarial context-builder tests with injected instructions and embedded secrets.

**Dependencies:** Task 1.

**Files likely touched:**

- `src/server/ai/ai-test-context-builder.ts`
- shared secret sanitizer/redactor if extraction is required
- focused context-builder tests

**Estimated scope:** Medium.

### Checkpoint A: Safe outbound boundary

- Provider configuration stores references only.
- Context scope and aliases are project/connection fenced.
- No credential or known secret reaches the fixture provider.
- Provider cancellation and output limits pass.

### Task 5: Compile untrusted proposals

**Description:** Parse the proposal AST, resolve aliases, allocate stable IDs, sanitize literals, validate semantics through existing testing schemas, and produce review issues.

**Acceptance criteria:**

- Valid proposals compile to disabled scenario/test-suite mutations accepted by current services.
- Hallucinated aliases, forward references, invalid JSONPath, missing suite members, duplicate identities, secret-shaped literals, and unsupported script fields are rejected or blocked.
- Compiler output is deterministic for injected ID/time sources and never executes generated content.

**Verification:** table-driven compiler tests covering valid and adversarial proposals.

**Dependencies:** Tasks 1 and 4.

**Files likely touched:**

- `src/server/ai/ai-test-proposal-compiler.ts`
- `src/server/ai/__tests__/ai-test-proposal-compiler.test.ts`
- existing testing sanitizer if safely reusable

**Estimated scope:** Medium.

### Task 6: Implement durable generation orchestration

**Description:** Add job persistence, state transitions, idempotency, one bounded repair, cancellation, restart interruption, expiry, and late-response fences.

**Acceptance criteria:**

- Same key/body creates at most one provider request; same key/different body fails loudly.
- Cancellation/restart/timeout/provider failure reach one stable terminal state and late responses cannot overwrite it.
- Only validated proposals reach `READY`; raw invalid provider bodies are not persisted.

**Verification:** service tests with barriers for duplicates, cancellation, restart, and late completion.

**Dependencies:** Tasks 2, 3, 4, and 5.

**Files likely touched:**

- `src/server/ai/ai-test-generation-repository.ts`
- `src/server/ai/ai-test-generation-service.ts`
- focused repository/service tests

**Estimated scope:** Medium.

### Task 7: Apply selected proposals atomically

**Description:** Add the one-way apply service that stale-checks the proposal and creates selected disabled cases/suites in one transaction.

**Acceptance criteria:**

- Apply allocates server-owned identities, preserves exact connection IDs, and creates no Run/Workflow.
- Tool snapshot drift, missing selected cases, invalid confirmation, or any repository error leaves zero partial rows.
- Repeating the identical apply returns the original result; changing selection after apply is rejected.

**Verification:** integration tests over actual testing repositories and failure injection.

**Dependencies:** Tasks 5 and 6.

**Files likely touched:**

- `src/server/ai/ai-test-apply-service.ts`
- `src/server/ai/__tests__/ai-test-apply-service.test.ts`
- minimal repository transaction seam if required

**Estimated scope:** Medium.

### Task 8: Expose project-fenced APIs and client decoders

**Description:** Add provider/job/cancel/apply routes and runtime-decoded client methods with stable error mapping.

**Acceptance criteria:**

- Every route validates project/resource ownership and body limits at the boundary.
- Provider errors remain generic; unknown response shapes fail closed in the client.
- API route registration does not change existing test-case/suite endpoints.

**Verification:** route and API-client contract tests.

**Dependencies:** Tasks 2, 6, and 7.

**Files likely touched:**

- `src/server/ai/routes.ts`
- `src/server/app.ts`
- `src/client/api/api-client.ts`
- focused route/client tests

**Estimated scope:** Medium.

### Checkpoint B: Proposal lifecycle

- Generation, validation, cancellation, restart interruption, expiry, and apply states pass.
- Model output cannot mutate data without an explicit apply request.
- Atomic apply creates disabled definitions only.
- Existing scenario/suite services and execution gates remain authoritative.

### Task 9: Deliver provider settings UI

**Description:** Add project-scoped provider configuration using an existing secret environment-variable reference and a side-effect-free connection check.

**Acceptance criteria:**

- UI never displays or accepts a raw API key in provider configuration.
- Missing/disabled/invalid configuration has localized, actionable states.
- Project changes cancel/fence checks and never reuse provider state across projects.

**Verification:** focused settings component tests and keyboard flow.

**Dependencies:** Task 8.

**Files likely touched:**

- `src/client/features/ai/AiProviderSettings.tsx`
- focused component test
- `zh-CN/en-US` AI locale modules

**Estimated scope:** Medium.

### Task 10: Deliver generation wizard

**Description:** Add intent, scope, coverage, data-sharing review, start, progress, cancellation, and resume of a generation job.

**Acceptance criteria:**

- No provider request begins before explicit scope and data-sharing confirmation.
- Duplicate clicks create one job; closing/project switching cancels observation and fences late updates.
- All defined initial/loading/missing/ready/generating/validating/cancelled/failed/stale states are accessible and localized.

**Verification:** focused wizard/hook tests with deferred API promises.

**Dependencies:** Tasks 8 and 9.

**Files likely touched:**

- `src/client/features/ai/AiTestGenerationWizard.tsx`
- `src/client/features/ai/useAiTestGeneration.ts`
- focused tests

**Estimated scope:** Medium.

### Task 11: Deliver proposal review and apply UI

**Description:** Present proposed cases/suites, rationale, warnings, selection, and explicit atomic apply, then route to existing editors.

**Acceptance criteria:**

- Users can inspect every generated step, mapping, extractor, assertion, polling rule, cleanup step, and suite member before apply.
- Blocking items cannot be selected; material warnings require acknowledgement; final wording states that definitions are disabled and no Tool will run.
- Successful apply opens created definitions without losing unrelated testing-page state.

**Verification:** focused review component tests plus testing-workspace state-preservation regression.

**Dependencies:** Tasks 8 and 10.

**Files likely touched:**

- `src/client/features/ai/AiTestProposalReview.tsx`
- Automated-tests and suite entry-point components
- focused review/workspace tests

**Estimated scope:** Medium.

### Task 12: Prove the production journey

**Description:** Add user documentation and production E2E using a local fake provider so no acceptance test depends on a live paid service.

**Acceptance criteria:**

- E2E uses a local fake provider to generate a scenario plus suite, reviews and applies them, proves they are disabled, then manually enables and executes through existing gates.
- E2E proves malformed output, prompt injection content, stale Tool snapshot, cancellation, duplicate start, and apply rollback cause no unintended Tool call or partial persistence.
- Documentation explains provider data sharing, credential references, proposal review, disabled output, retention, limits, and failure recovery.

**Verification:** targeted production Playwright journey and `git diff --check`.

**Dependencies:** Tasks 9–11.

**Files likely touched:**

- AI production E2E fixture/spec
- `README.md`
- a versioned AI integration specification/release note

**Estimated scope:** Medium.

### Task 13: Close the release gate

**Description:** Run the full repository gates and perform independent correctness, security, privacy, accessibility, and supply-chain review.

**Acceptance criteria:**

- `npm run verify`, release-artifact verification, migration byte checks, package dry run, dependency audit, and process cleanup pass.
- Packaged output includes the required provider/runtime assets and excludes credentials, prompts, proposal history, tests, and other disallowed files.
- Independent review has no open Critical/Required issue; any provider-specific risk acceptance is documented before release.

**Verification:** `npm run verify`; `npm run verify:release-artifacts`; `npm pack --dry-run --json`; `git diff --check`; independent review.

**Dependencies:** Task 12.

**Files likely touched:** review artifact or focused regression tests for findings only.

**Estimated scope:** Small to Medium.

## 11. Dependency graph

```text
Task 1 contracts
  ├─> Task 2 provider persistence -> Task 3 provider adapter
  └─> Task 4 context builder -> Task 5 proposal compiler

Tasks 2–5 -> Task 6 generation orchestration
Task 5 + 6 -> Task 7 atomic apply
Tasks 2 + 6 + 7 -> Task 8 API/client

Task 8 -> Task 9 settings UI -> Task 10 generation wizard
Task 8 + 10 -> Task 11 review/apply UI
Tasks 9–11 -> Task 12 production journey -> Task 13 release gate
```

Tasks 3 and 4 may proceed in parallel after contracts/persistence are fixed. UI implementation may begin only after the shared job/proposal/apply contracts are stable.

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Tool description contains prompt injection | High | Treat as untrusted data; opaque aliases; no model authority; strict AST/compiler |
| Credentials or proprietary values reach provider | Critical | Secret-variable references, sanitizer/redactor, exact data-sharing preview, no Runs/traces |
| Hallucinated Tool or broken scenario | High | Server-owned alias map, current snapshot check, shared Zod/schema validation, disabled output |
| AI generates destructive flow | High | Destructive Tools excluded by default; warnings; no auto execution; existing execution confirmation |
| Duplicate billable requests | High | Durable idempotency key/request hash and single active job per project |
| Timeout outcome is unknown | High | Persist intent before call; restart marks active job interrupted; never automatically retry |
| Partial cases without suite | High | One SQLite transaction for apply with failure injection tests |
| Provider outage or format drift | Medium | Adapter boundary, generic stable errors, strict parsing, one bounded repair |
| Proposal becomes stale after catalog change | High | Context/snapshot digest checked again at apply |
| High latency or cost | Medium | Selection/count/token limits, usage display, cancellation, no ambient requests |
| UI treats fluent output as correct | High | Rationale separated from validity; errors/warnings from deterministic compiler, not model confidence |
| Future provider endpoint enables SSRF | Critical | Fixed endpoint in MVP; separate reviewed custom/local endpoint modes later |

## 13. Compatibility and rollback

- Existing test-case, suite, execution, Run, Workflow, import/export, and connection APIs keep their current meanings.
- AI produces ordinary existing test definitions; execution has no AI-specific path.
- Automated-test export excludes AI provider/job records. Generated test definitions export normally after creation.
- Migration is additive and must preserve all existing rows. Rollback disables AI routes/UI but retains generated ordinary tests.
- Provider configuration and job tables may remain unread by older versions; provide backup/export guidance and never write a destructive down migration.
- Removing AI must not delete tests created through AI because they become normal project-owned definitions at apply time.

## 14. Approval gates

Implementation must not start until these product choices are confirmed:

1. First provider adapter and its trusted endpoint policy.
2. Whether Tool names/descriptions/schemas may be sent to that external provider after explicit user confirmation.
3. Credential storage by reference to a secret project environment variable.
4. Seven-day default ready-proposal retention and history deletion behavior.
5. MVP output is always disabled and never automatically executed.
6. AI-generated executable transform scripts are deferred.

## 15. Definition of done

- A user can generate, review, and atomically create useful disabled scenarios and suites from selected Tool metadata.
- The model cannot select undeclared Tools, invent persistent identity, access secrets, call Tools, write project state, or execute generated content.
- Every generated definition passes current shared schemas and exact project/connection/Tool fences.
- Provider requests are explicit, cancellable, bounded, idempotent, and privacy-visible.
- Prompt injection, secret leakage, malformed output, stale catalog, duplicate requests, restart, cancellation, and rollback are tested.
- Existing manual authoring and execution workflows behave unchanged.
- Chinese/English, keyboard, focus, loading/error/stale states, and state preservation meet frontend standards.
- Required verification, packaging, migration, dependency, and independent review gates pass.
