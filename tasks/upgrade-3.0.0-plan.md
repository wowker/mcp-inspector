# Development Plan: MCP Inspector 3.0.0 Autonomous Test Design Agent

## Overview

Deliver a built-in autonomous Agent that receives a business goal, discovers and invokes Tools on one explicitly authorized MCP connection through an in-process Authoring MCP Server, records response provenance, compiles the exploration trace into the existing deterministic Scenario/Test Suite model, performs bounded replay and repair, and atomically saves disabled test definitions.

The authoritative product and security contract is [`docs/UPGRADE-3.0.0.md`](../docs/UPGRADE-3.0.0.md). This plan does not overwrite the completed default plan or the earlier proposal-only AI plan.

## Architecture decisions

- Keep the current `ConnectionRuntime`, Scenario Runner, Run/Workflow services, testing repositories and Test Suite execution model authoritative.
- Bind every generation to one `projectId + connectionId + environmentProfileId`; never resolve identity by URL, name or model output.
- Put an in-process Authoring MCP Server between the model loop and all application capabilities.
- Expose fixed authoring meta-tools rather than registering unrestricted downstream Tools directly.
- Preserve data provenance using explicit call-result bindings; do not infer reusable dependencies only by comparing literal values.
- Treat model calls, Tool metadata, Tool responses and generated transforms as untrusted at their respective boundaries.
- Move human authorization to connection policy and generation start. There is no per-call interruption in an authorized sandbox generation.
- Compile and replay before saving; save once in a transaction and force generated definitions disabled.
- Add migrations only after rechecking the latest migration number; never modify 001–018.
- Use one Provider adapter first. Keep product services independent of its SDK and wire format.

## Dependency graph

```text
Shared Agent/Authoring contracts + fake fixtures
        │
        ├── Provider adapter and model loop
        ├── Connection autonomy policy
        └── Authoring MCP catalog/call gateway
                    │
                    ▼
          Invocation provenance graph
                    │
                    ▼
          Deterministic scenario compiler
                    │
             ┌──────┴──────┐
             ▼             ▼
        Replay/repair   Atomic save
             └──────┬──────┘
                    ▼
              REST/client/UI
                    ▼
          E2E, security and release gates
```

## Task 1: Lock shared contracts and deterministic fixtures

**Description:** Define strict shared Zod contracts for Provider config, connection autonomy policy, generation jobs/events, Agent turns, Authoring MCP tools, invocation bindings, proposal AST, budgets, terminal results and stable errors. Add a scripted fake Provider and fake downstream MCP Server for all later slices.

**Acceptance criteria:**

- Contracts reject persistent IDs, enabled state, unknown fields, oversized content and invalid state transitions from model-controlled payloads.
- Fixtures deterministically simulate catalog discovery, nested responses, arrays, writes, polling, cleanup, timeout, cancellation and unknown call outcomes.
- Client and server use the same wire schemas and branded generation/call identifiers.

**Verification:** Focused shared contract and fixture tests; `npm run typecheck`.

**Dependencies:** None.

**Files likely touched:**

- `src/shared/ai/autonomous-testing.ts`
- `src/shared/ai/authoring-mcp.ts`
- `src/server/ai/__tests__/fixtures/fake-agent-provider.ts`
- `src/server/ai/__tests__/fixtures/fake-downstream-mcp.ts`

**Estimated scope:** Medium.

## Task 2: Deliver Provider configuration and connection autonomy policy

**Description:** Add the next available migration and one vertical settings slice for project-scoped Provider references and connection-scoped autonomy policy. Store only a project secret-variable reference for credentials.

**Acceptance criteria:**

- Existing databases upgrade without changing 001–018 bytes or existing connection/auth data.
- Policy is keyed by exact project and connection ID; same-URL connections cannot share it.
- New connections default to disabled; SANDBOX, write and destructive grants are explicit and independently persisted.

**Verification:** Migration matrix, repository/service/route tests, source/dist migration byte test.

**Dependencies:** Task 1 and migration-number recheck.

**Files likely touched:**

- next migration SQL
- `src/server/ai/ai-provider-repository.ts`
- `src/server/ai/autonomy-policy-service.ts`
- `src/server/ai/settings-routes.ts`
- focused tests

**Estimated scope:** Medium.

## Task 3: Deliver one Tool-Calling Provider adapter

**Description:** Implement the approved hosted Provider adapter with fixed endpoint ownership, multi-turn Tool Calling, strict response decoding, abort, timeout, token limits, usage capture and normalized errors.

**Acceptance criteria:**

- Credential values remain server-only and never enter URL, Prompt, logs, errors, browser data or stored config.
- Adapter handles multiple tool calls, malformed calls, provider refusal, timeout, cancellation, non-JSON and oversized bodies deterministically.
- Focused tests use a local HTTP fixture and make no live Provider request.

**Verification:** Provider adapter contract tests, dependency/provenance review if a new SDK is proposed.

**Dependencies:** Tasks 1–2 and Provider approval.

**Files likely touched:**

- `src/server/ai/agent-provider.ts`
- `src/server/ai/providers/hosted-provider-v1.ts`
- `src/server/ai/agent-provider-registry.ts`
- focused tests

**Estimated scope:** Medium.

## Task 4: Build the read-only Authoring MCP walking skeleton

**Description:** Create an in-process Authoring MCP Server/Client with `testing.list_tools`, `testing.describe_tool` and read-only `testing.call_tool`, backed by the existing Tool service and `ConnectionRuntime`.

**Acceptance criteria:**

- An Agent can discover, describe and call an allowlisted read-only Tool through a real MCP request/response path.
- Alias resolution is generation-scoped and always resolves to the exact snapshotted connection and Tool.
- Cross-project, cross-connection, removed, changed, unknown and over-limit Tools fail before a downstream call.

**Verification:** MCP protocol integration tests, same-URL/different-auth connection fixture, no-call spies on rejected requests.

**Dependencies:** Tasks 1–2.

**Files likely touched:**

- `src/server/ai/authoring/authoring-mcp-server.ts`
- `src/server/ai/authoring/authoring-mcp-client.ts`
- `src/server/ai/authoring/catalog-tools.ts`
- focused tests

**Estimated scope:** Medium.

### Checkpoint A: Safe autonomous boundary

- [ ] Provider credentials are reference-only and redacted.
- [ ] One fake Agent can discover and invoke one fake read-only MCP Tool.
- [ ] Project, connection, Tool and generation identities cannot cross.
- [ ] Cancel, timeout and response-size limits pass.
- [ ] No released migration changed.

## Task 5: Add policy-enforced write calls and durable invocation recording

**Description:** Extend `testing.call_tool` for setup/action/poll/cleanup calls, evaluate connection autonomy policy before every call, and persist a bounded invocation event before and after the downstream effect.

**Acceptance criteria:**

- Disabled/read-only policies block writes; destructive calls require the persisted connection grant and are never authorized by annotations alone.
- Every attempted external effect has a durable intent record, terminal status and Run link where available.
- Timeout/disconnect of a non-idempotent call becomes `UNKNOWN` and cannot be automatically retried.

**Verification:** Policy matrix, crash/timeout/late-result tests, write/destructive adversarial Tool annotations.

**Dependencies:** Tasks 2 and 4.

**Files likely touched:**

- next migration SQL if not included in Task 2
- `src/server/ai/authoring/authoring-invocation-service.ts`
- `src/server/ai/authoring/authoring-invocation-repository.ts`
- `src/server/ai/authoring/call-tool.ts`
- focused tests

**Estimated scope:** Medium.

## Task 6: Preserve response provenance and assemble downstream arguments

**Description:** Implement call-result/environment/generated-input bindings, safe path resolution, argument construction, input-schema validation and a provenance graph that survives compilation without persisting resolved secrets.

**Acceptance criteria:**

- Nested objects, arrays, root objects and multiple bindings resolve deterministically and fail closed on missing required sources.
- Dynamic values from previous responses remain source references; environment values remain references and never enter persisted definitions as literals.
- Prototype paths, forward/cross-session call references, cycles, excessive depth and incompatible target types are rejected.

**Verification:** Table-driven resolver tests, property/adversarial path tests, secret fixture tests.

**Dependencies:** Task 5.

**Files likely touched:**

- `src/server/ai/authoring/argument-binding-resolver.ts`
- `src/server/ai/authoring/provenance-graph.ts`
- `src/server/ai/authoring/call-tool.ts`
- focused tests

**Estimated scope:** Medium.

## Task 7: Compile one explored flow into one deterministic scenario

**Description:** Implement `testing.compile_draft` and `testing.validate_draft` for a single Scenario. Translate invocation provenance into current inputs, fixed arguments, extractors, mappings, assertions, cleanup and stable server-owned identities.

**Acceptance criteria:**

- A create→read→delete trace compiles into a current `ScenarioTestCaseDefinition` accepted by existing shared schemas.
- Explored dynamic IDs are never frozen; alias drift, invalid JSONPath, missing cleanup, secret-shaped literals and unsupported references are blocking issues.
- Compiler output is deterministic under injected ID/time sources and always disabled.

**Verification:** Golden compiler tests plus current Scenario Runner schema tests.

**Dependencies:** Tasks 1 and 6.

**Files likely touched:**

- `src/server/ai/compiler/autonomous-scenario-compiler.ts`
- `src/server/ai/compiler/proposal-validator.ts`
- `src/server/ai/__tests__/autonomous-scenario-compiler.test.ts`
- minimal shared testing helper extraction if necessary

**Estimated scope:** Medium.

### Checkpoint B: Trace-to-scenario slice

- [ ] Fake Agent can perform create→read→delete through Authoring MCP.
- [ ] The trace compiles to an existing scenario without dynamic literal leakage.
- [ ] Scenario validation catches stale Tools, invalid paths and missing cleanup.
- [ ] No test definition has been persisted or enabled yet.

## Task 8: Implement the durable autonomous Agent orchestrator

**Description:** Add generation persistence and the DISCOVERING→PLANNING→EXPLORING→SYNTHESIZING→VALIDATING lifecycle, driving Provider turns and dispatching only validated Authoring MCP calls within a server-owned budget.

**Acceptance criteria:**

- Same idempotency key/body creates one generation and at most one Provider loop; a changed body conflicts.
- Turn, token, call, write, duration and context budgets are enforced outside the model.
- Cancellation fences late Provider and Tool results; restart marks active work interrupted without replaying unknown effects.

**Verification:** Barrier-based concurrency, duplicate, cancellation, budget and restart service tests.

**Dependencies:** Tasks 3–7.

**Files likely touched:**

- `src/server/ai/autonomous-generation-service.ts`
- `src/server/ai/autonomous-generation-repository.ts`
- `src/server/ai/agent-loop.ts`
- focused tests

**Estimated scope:** Medium.

## Task 9: Generate assertions, polling, cleanup and suites

**Description:** Extend the compiler and Agent protocol from one happy-path scenario to bounded happy/error/boundary cases, polling, always-run cleanup and Test Suite membership/execution policy.

**Acceptance criteria:**

- Assertions distinguish stable business expectations from dynamic observed values and never baseline every returned field.
- Repeated reads compile to bounded polling with explicit success/timeout conditions; cleanup runs on success, failure and cancellation when prerequisites exist.
- Suite members reference compiled cases by proposal identity and compile to existing suite definitions with bounded concurrency.

**Verification:** Golden cases for polling, negative responses, cleanup failure and suite ordering/concurrency.

**Dependencies:** Tasks 7–8.

**Files likely touched:**

- `src/server/ai/compiler/autonomous-scenario-compiler.ts`
- `src/server/ai/compiler/autonomous-suite-compiler.ts`
- `src/server/ai/compiler/assertion-inference.ts`
- focused tests

**Estimated scope:** Medium.

## Task 10: Support bounded AI-authored argument transforms

**Description:** Integrate step-local QuickJS argument transforms for cases that fixed arguments and mappings cannot express. AI-authored programs remain untrusted data and must be statically screened, sandbox-previewed and replayed.

**Acceptance criteria:**

- Transform sees only explicit JSON bindings and returns a bounded root object accepted by the target Tool schema.
- Network, filesystem, Node globals, dynamic imports, Tool calls, environment mutation and non-JSON output are unavailable.
- CPU, memory, source bytes, output bytes, depth and node limits terminate deterministically with stable errors.

**Verification:** Sandbox escape corpus, timeout/OOM/oversize tests, transform-to-Scenario integration tests.

**Dependencies:** Task 7 and the approved scenario argument-transform contract.

**Files likely touched:**

- `src/server/testing/argument-transform-runtime.ts`
- `src/server/ai/compiler/transform-compiler.ts`
- `src/shared/testing/test-case.ts`
- focused tests

**Estimated scope:** Medium.

## Task 11: Deliver autonomous replay and bounded repair

**Description:** Implement `testing.replay_draft` through the existing Test Execution/Scenario Runner path and return bounded diagnostics to at most two Agent repair cycles, with cleanup and unknown-outcome rules preserved.

**Acceptance criteria:**

- Replay uses the original project, connection, environment profile and current Tool snapshot and creates normal traceable Runs.
- Repair cannot expand connection/Tool/permission scope and must reduce blocking diagnostics on each attempt.
- Cleanup is attempted after success, failure and cancellation; unknown non-idempotent outcomes terminate instead of retrying.

**Verification:** Fake-server E2E for one-pass success, repaired path, polling timeout, cancellation and cleanup failure.

**Dependencies:** Tasks 8–10.

**Files likely touched:**

- `src/server/ai/autonomous-replay-service.ts`
- `src/server/ai/agent-loop.ts`
- `src/server/ai/authoring/replay-tool.ts`
- focused tests

**Estimated scope:** Medium.

## Task 12: Atomically save generated cases and suites

**Description:** Add one-way Apply after independent final validation. Create selected compiled cases, revisions, targets, suites, members and generation result in one SQLite transaction.

**Acceptance criteria:**

- Tool snapshot drift, changed policy, invalid compile digest or repository failure creates zero partial definitions.
- Every generated case is disabled; no schedule, baseline update or extra Tool call occurs during save.
- Identical repeated Apply returns the original IDs; a different result after completion is rejected.

**Verification:** Real repository integration tests with failure injection and stale snapshot/policy cases.

**Dependencies:** Tasks 7, 9 and 11.

**Files likely touched:**

- `src/server/ai/autonomous-apply-service.ts`
- `src/server/ai/autonomous-generation-repository.ts`
- minimal shared transaction seam in testing repositories
- focused tests

**Estimated scope:** Medium.

### Checkpoint C: Autonomous backend journey

- [ ] Business goal produces real bounded exploration without intermediate approval.
- [ ] Response dependencies compile into mappings/extractors/transforms.
- [ ] Replay and bounded repair reach a stable terminal result.
- [ ] Atomic save creates disabled scenarios and suites only.
- [ ] Cancel, restart, cleanup failure and unknown effects are explicit.

## Task 13: Expose generation APIs and defensive client methods

**Description:** Add project-fenced start/get/events/cancel APIs and runtime-decoded client methods. Keep Provider/policy routes separate from generation lifecycle.

**Acceptance criteria:**

- Bodies, IDs and ownership are validated at the route boundary; the browser cannot submit Tool catalogs, responses or compiled definitions.
- Stable errors hide Provider response bodies, internal URLs, stack traces, credentials and raw business payloads.
- Polling/event cursors and generation identities fence stale project/page responses.

**Verification:** Route/client contract tests including malformed, cross-project and duplicate requests.

**Dependencies:** Tasks 2, 8 and 12.

**Files likely touched:**

- `src/server/ai/routes.ts`
- `src/server/app.ts`
- `src/client/api/api-client.ts`
- focused tests

**Estimated scope:** Medium.

## Task 14: Deliver the zero-interruption generation UI

**Description:** Add Provider settings, connection autonomy policy, a business-goal launch form, authoritative progress timeline, cancellation and completion result using current primitives and bilingual resources.

**Acceptance criteria:**

- Required user input is limited to configured connection/provider plus business goal; advanced limits are optional.
- Start shows one upfront data-sharing/policy/budget summary, then requires no per-call interaction.
- All initial/config-missing/ready/running/cancelling/cancelled/failed/interrupted/budget/cleanup/completed states are accessible and localized.

**Verification:** Focused Testing Library tests for state fencing, duplicate start, keyboard/focus and long zh-CN/en-US content.

**Dependencies:** Task 13; must follow `FRONTEND-DEVELOPMENT-STANDARDS.md`.

**Files likely touched:**

- `src/client/features/ai/AutonomousTestGeneration.tsx`
- `src/client/features/ai/useAutonomousTestGeneration.ts`
- existing testing-page entry components
- `src/shared/i18n/locales/{zh-CN,en-US}/ai.ts`
- focused tests

**Estimated scope:** Medium.

## Task 15: Prove adversarial and production journeys

**Description:** Add production-build E2E and adversarial suites covering the full autonomous path, prompt injection, isolation, secrets, side effects, restart, rollback, accessibility and packaging.

**Acceptance criteria:**

- A local fake Provider and MCP Server prove business goal→exploration→binding→compile→replay→repair→cleanup→atomic save.
- Prompt/tool/response injection cannot cross connection scope, grant permission, leak fixture secrets or execute unvalidated output.
- Cancellation creates no later calls; unknown write outcome is not retried; transaction faults leave no partial tests.

**Verification:** Focused adversarial tests, production Playwright journey, `npm run verify`, release artifact checks.

**Dependencies:** Tasks 1–14.

**Files likely touched:**

- `e2e/autonomous-test-generation.spec.ts`
- `src/server/ai/__tests__/autonomous-security.test.ts`
- fixture helpers and snapshots only where stable
- release policy tests if new runtime files require allowlisting

**Estimated scope:** Medium.

## Task 16: Close the 3.0.0 release gate

**Description:** Finish documentation, migration/package validation, dependency audit, performance budgets and independent correctness/security/privacy/accessibility review.

**Acceptance criteria:**

- Public behavior, Authoring MCP contracts, policy semantics, data sharing, retention, deletion and operational recovery are documented.
- No reachable unmitigated high/critical dependency issue and no unreviewed install scripts are introduced.
- Independent review has no open Critical/Required finding and rollback disables Agent entry points without corrupting existing tests.

**Verification:** `npm run verify`, `npm run verify:release-artifacts`, migration byte comparison, `npm pack --dry-run --json`, `git diff --check`.

**Dependencies:** Task 15.

**Files likely touched:**

- `README.md`
- `docs/UPGRADE-3.0.0.md`
- release/security review documents
- package/release allowlists if required

**Estimated scope:** Medium.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Autonomous writes mutate real data | Critical | SANDBOX-only write mode, explicit connection policy, cleanup requirement, exact connection fence |
| Timeout duplicates a non-idempotent effect | Critical | intent record before call, UNKNOWN state, no automatic retry |
| Prompt injection expands authority | Critical | fixed Authoring tools, server-side policy, aliases, strict schemas, independent compiler |
| Secrets or PII reach Provider | High | project redactor, suspicious-field removal, response allowlist/truncation, fixture capture tests |
| Exploration literals become brittle tests | High | explicit provenance bindings and compiler golden tests |
| Replay creates duplicate side effects | High | fresh generated data, cleanup, idempotency and policy-based replay eligibility |
| Agent loops consume unbounded time/cost | High | hard turn/token/call/time/context limits and one active job per project |
| Model/provider changes behavior | Medium | provider-neutral contract, fake provider corpus, pinned model policy and acceptance benchmark |
| Large traces freeze UI or SQLite | Medium | bounded summaries, pagination/events cursor, TTL and no raw response persistence |
| v3 creates a second test model | High | compile only into existing shared Scenario/Suite schemas and services |

## Parallelization after Task 1

- Tasks 2 and 3 may proceed in parallel once contracts are fixed.
- Task 4 can proceed beside Task 3 because it uses the fake Agent fixture.
- Tasks 9 and 10 can proceed in parallel after the single-scenario compiler lands.
- UI shell work may begin against Task 13 contract fixtures, but final integration waits for backend lifecycle semantics.
- Migration files, shared schemas and `src/server/app.ts` require a single owner during their respective tasks.

## Definition of done

Every task must meet its acceptance criteria plus the repository-wide bar:

- runtime behavior proven, not only typechecked;
- regression and error-path tests included;
- existing project/connection/tab/run identities preserved;
- migrations additive and source/dist byte-identical;
- public interfaces and security decisions documented;
- no unrelated refactors or secrets;
- focused checks pass per task and full `npm run verify` passes before release.
