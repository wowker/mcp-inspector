# Development Plan: Scenario Argument Transform

## Document status

| Item | Value |
|---|---|
| Status | Proposed; product intent confirmed, implementation pending review |
| Date | 2026-09-04 |
| Scope | Scenario-test argument assembly and execution |
| Compatibility | Additive extension to the existing 1.5 scenario model |
| Migration | None planned; re-evaluate only if implementation needs new durable diagnostics |
| Task checklist | `tasks/scenario-argument-transform-todo.md` |

## 1. Goal

Allow a scenario step to perform arbitrary, deterministic JSON structure transformation before invoking its Tool. Users must be able to map, filter, reduce, merge, split, rename, conditionally include, and reshape values from prior responses, extracted variables, scenario inputs, environment variables, and literals into the next Tool's JSON-object arguments.

The feature extends the existing linear scenario model. It does not introduce a graph editor, dynamically generated steps, implicit type coercion, or additional sandbox privileges.

## 2. User flow

1. The user selects a scenario Tool step and configures its fixed arguments and ordinary mappings as today.
2. The user enables **Argument transform** for that step.
3. The user declares named bindings. Each binding uses the existing `ValueSource` variants and therefore makes every dependency explicit and validates prior-step ordering.
4. The user writes one synchronous JavaScript default export. The function receives immutable `arguments` and `bindings` and returns the complete next-step argument object.
5. **Validate syntax** compiles the source without executing it.
6. **Preview transform** executes against explicitly supplied sample JSON. Preview never calls a Tool, reads an undeclared environment variable, mutates scenario state, or persists sample values.
7. During a scenario run, the server resolves fixed arguments, mappings, and bindings; runs the transform once; validates that the result is a bounded JSON object; then hands that object to the existing Tool Workflow/Run path.
8. The execution report shows whether a transform was applied, the transformed arguments subject to existing redaction, and a stable error with source location when transformation fails.

Example:

```js
export default function transform(ctx) {
  return {
    ...ctx.arguments,
    customer: {
      id: ctx.bindings.customer.id,
      displayName: ctx.bindings.customer.name ?? "Unknown",
    },
    items: ctx.bindings.rawItems
      .filter((item) => item.enabled)
      .map((item) => ({
        id: item.product_id,
        quantity: Number(item.qty),
      })),
    total: ctx.bindings.rawItems.reduce(
      (sum, item) => sum + Number(item.price) * Number(item.qty),
      0,
    ),
  };
}
```

## 3. Non-goals

- No network, filesystem, process, Node.js, dynamic import, `eval`, `Function`, helper Tool call, environment write, or scenario-variable write capability.
- No asynchronous host operations; the transform is a synchronous pure function.
- No loops that create new scenario steps, no recursive scenario execution, and no arbitrary graph orchestration.
- No automatic repair of invalid output and no string-to-number or other implicit coercion by the host.
- No new expression-language dependency such as JSONata or JMESPath.
- No modification of Tool-level before/after Workflow semantics.
- No automatic persistence of preview inputs or transform output outside existing execution records.

## 4. Architecture decisions

### 4.1 Step-local optional transform

Add one optional `argumentTransform` to `ScenarioStepDefinition`. It runs inside a Tool step instead of becoming a standalone scenario node. This preserves stable step identity, polling, cleanup, failure policies, Run linkage, and the existing linear editor.

Existing definitions that omit the field remain valid. New saves should serialize `null` when disabled; import must continue accepting old definitions with the field absent.

Proposed shared contract:

```ts
interface ScenarioTransformBinding {
  name: string;
  source: ValueSource;
  isRequired: boolean;
}

interface ScenarioArgumentTransformV1 {
  version: 1;
  language: "JAVASCRIPT";
  source: string;
  timeoutMs: number;
  bindings: ScenarioTransformBinding[];
}

interface ScenarioStepDefinition {
  // Existing fields remain unchanged.
  argumentTransform?: ScenarioArgumentTransformV1 | null;
}
```

Contract limits:

- Source: at most 256 KiB and non-empty when enabled.
- Bindings: at most 100; names are unique, trimmed identifiers up to 128 characters.
- Timeout: 100–5,000 ms; default 1,000 ms.
- Serialized input (`arguments` plus bindings): at most 4 MiB.
- Serialized output: at most 2 MiB and must satisfy `jsonObjectSchema`.
- Definition total remains under the existing 2 MiB test-case limit.

`language` and `version` make the wire shape extensible without changing the meaning of version 1. Version 1 remains synchronous, deterministic JavaScript.

### 4.2 Explicit bindings, not ambient access

The transform must not receive all scenario inputs, variables, responses, or environment values. It receives only named bindings declared in the test definition:

```ts
interface ScenarioTransformContext {
  readonly arguments: Readonly<JsonObject>;
  readonly bindings: Readonly<JsonObject>;
  readonly json: {
    get(value: JsonValue, path: string): JsonValue | undefined;
  };
}
```

Binding sources reuse `LITERAL`, `SCENARIO_INPUT`, `ENVIRONMENT`, `VARIABLE`, and `STEP_RESPONSE`. Definition validation applies the same no-forward-reference rules used by mappings. Explicit bindings keep dependencies inspectable, portable, and statically validatable.

Both context members are deep-frozen clones. The returned value is cloned and validated at the process boundary.

### 4.3 Dedicated capability profile on the existing QuickJS foundation

Do not execute transforms through the existing Workflow context unchanged. That context exposes variable mutation, staged environment writes, logging, and `tools.call`, which are unnecessary and too powerful for argument assembly.

Extract the already-tested QuickJS lifecycle, child-process termination, memory/stack limits, interruption, source-location handling, JSON cloning, forbidden-key protection, and disabled dynamic code into a small internal sandbox kernel. Keep two explicit capability profiles:

- `WORKFLOW`: current behavior, unchanged.
- `JSON_TRANSFORM`: immutable arguments/bindings, JSON helper, and return value only.

Use a separately validated IPC discriminant for transform start/completion messages. Never let client input choose a capability profile directly.

The transform profile additionally rejects or disables nondeterministic ambient sources such as `Date.now()` and `Math.random()`. If time or a seed is ever needed later, add it as an explicit binding rather than ambient state.

### 4.4 Execution order

The canonical order becomes:

```text
Tool Schema defaults
→ step fixed arguments
→ declarative mappings
→ resolve explicit transform bindings
→ run argument transform once
→ Tool-level before script, if enabled
→ final Tool JSON Schema validation
→ MCP tools/call
→ Tool-level after script, if enabled
→ response extraction and assertions
```

The transform runs once per step execution, before the polling attempt loop. Poll retries receive the same transformed input, matching current deterministic polling behavior. A cleanup step may also define a transform and follows the same rules.

The Tool-level before script remains authoritative after the transform and may further modify arguments under its existing contract. The Run/Workflow record remains the authority for the actual final request.

### 4.5 Failure semantics

Stable scenario error codes:

| Code | Meaning |
|---|---|
| `ARGUMENT_TRANSFORM_BINDING_MISSING` | A required binding could not be resolved |
| `ARGUMENT_TRANSFORM_SYNTAX_ERROR` | Source does not compile |
| `ARGUMENT_TRANSFORM_RUNTIME_ERROR` | Transform threw during execution |
| `ARGUMENT_TRANSFORM_TIMEOUT` | CPU deadline was exceeded |
| `ARGUMENT_TRANSFORM_RESOURCE_LIMIT` | Memory, stack, input, or output limit was exceeded |
| `ARGUMENT_TRANSFORM_FORBIDDEN_CAPABILITY` | Script attempted unavailable ambient or host access |
| `ARGUMENT_TRANSFORM_OUTPUT_INVALID` | Return value is absent, non-JSON, non-object, or contains a forbidden structure |

Errors may add optional `phase`, `line`, and `column` fields to the existing execution error wire shape. Those fields are additive and optional; existing stored errors continue to decode.

A transform failure creates one step result with status `ERROR`, no `runId`, and no `workflowExecutionId`. Existing step/scenario failure policies then decide whether later main steps run. Cleanup still runs through the existing `finally` path. The host does not silently fall back to pre-transform arguments.

### 4.6 Data and persistence

No migration is required for the first release:

- `test_cases.definition_json` and revision snapshots already store bounded JSON objects and can carry the additive transform definition.
- `test_executions.definition_snapshot_json` captures the exact transform source and bindings used by a run.
- `test_execution_steps.resolved_arguments_json` stores the transformed step arguments already passed into the invocation seam.
- `test_execution_steps.error_json` can store stable transform errors and optional source location.
- Existing import/export envelopes automatically carry the additive field after their shared schema is updated.

Do not modify migration 012 or any released migration. If implementation discovers a hard requirement for durable transform-specific logs or before/after snapshots, stop and propose a new numbered migration instead of overloading an unrelated table.

### 4.7 API surface

Test-case CRUD and execution routes remain unchanged because the new definition is additive. Add two project-fenced, side-effect-free authoring endpoints:

```text
POST /api/projects/:projectId/scenario-transforms/validate
POST /api/projects/:projectId/scenario-transforms/preview
```

Validate request:

```ts
interface ValidateScenarioTransformRequest {
  transform: ScenarioArgumentTransformV1;
}

interface ValidateScenarioTransformResult {
  valid: boolean;
  error: ScenarioTransformError | null;
}
```

Preview request/result:

```ts
interface PreviewScenarioTransformRequest {
  transform: Omit<ScenarioArgumentTransformV1, "bindings">;
  arguments: JsonObject;
  bindings: JsonObject;
}

interface PreviewScenarioTransformResult {
  output: JsonObject;
  durationMs: number;
}
```

Preview values are explicit samples, not server-resolved execution data. The route verifies project ownership/session context but performs no database write, environment lookup, Tool call, or Run creation. Request and output bodies must not enter ordinary logs.

### 4.8 Secret handling

Trust boundaries are the editor source, preview samples, resolved response/environment bindings, sandbox IPC, and rendered diagnostics.

- Secret environment values are available only through an explicitly declared binding.
- Resolve environment bindings with `EnvironmentService.resolveDetailed()` so sensitivity metadata is not discarded.
- Carry `{ value, isSensitive }` internally for resolved bindings and extracted variables.
- If any transform input is sensitive, conservatively mark the transform diagnostics and preview derived from server-resolved data as sensitive. Do not attempt semantic taint declassification.
- The transform capability has no logging API or console bridge. This prevents scripts from copying secret bindings into persisted script logs.
- Error messages returned from the guest are bounded and passed through the existing longest-first secret redactor before persistence or UI display.
- Preview accepts user-supplied samples only and never preloads secret environment values.
- Default automated-test export keeps transform source and binding references but never resolved environment values, preview samples, or execution values.
- URLs, Toast messages, console output, and ordinary server logs contain neither source samples nor transformed payloads.

### 4.9 UI design

Add an **Argument transform** Disclosure after mappings and before extractors in the selected-step editor. Reuse existing FormField, Button, Select, Disclosure, JSON viewer, dialog, tokens, and Phosphor icons.

Editor states:

- `initial`: disabled transform with a short explanation.
- `ready`: enabled source editor and explicit binding list.
- `validating`: syntax action disabled with non-layout-shifting progress.
- `valid`: concise success feedback.
- `invalid`: inline localized error linked to the editor with line/column.
- `previewing`: cancellable preview request.
- `preview-ready`: input and output in a single-scroll-owner dialog.
- `preview-error`: localized summary plus bounded diagnostic detail.
- `stale`: any source/binding/sample change invalidates the previous validation/preview result.

The source editor may begin as a monospaced textarea; do not add a large editor dependency for the first release. Provide bilingual SDK help and copyable examples. Keyboard users must be able to enable, add/reorder/delete bindings, validate, preview, inspect output, and close the dialog with focus restored.

## 5. Dependency graph

```text
Task 1 contract and validation
  ├─> Task 2 sandbox kernel characterization
  │     └─> Task 3 pure transform runner
  │            ├─> Task 4 scenario execution integration
  │            └─> Task 5 validate/preview API
  └──────────────────────────────> Task 6 transform authoring UI

Tasks 5 + 6
  └─> Task 7 preview UX

Tasks 4 + 6
  └─> Task 8 reporting and transfer compatibility

Tasks 7 + 8
  └─> Task 9 documentation and production E2E
       └─> Task 10 release verification and review
```

## 6. Delivery tasks

### Task 1: Lock the additive transform contract

**Description:** Add shared Zod schemas, TypeScript types, limits, reference validation, and old-definition compatibility for an optional step-local transform.

**Acceptance criteria:**

- Old definitions without `argumentTransform` parse unchanged; new definitions round-trip through create, update, revision, import, and export schemas.
- Binding names are unique and every input/variable/step response obeys current existence and prior-step rules.
- Source, binding count, timeout, and total definition limits fail with stable schema issues.

**Verification:** `npx vitest run src/shared/testing/__tests__/test-contracts.test.ts src/client/features/testing/__tests__/scenario-test-case-draft.test.ts`

**Dependencies:** None.

**Files likely touched:**

- `src/shared/testing/test-case.ts`
- `src/shared/testing/__tests__/test-contracts.test.ts`
- `src/client/features/testing/scenario-test-case-draft.ts`
- `src/client/features/testing/__tests__/scenario-test-case-draft.test.ts`

**Estimated scope:** Medium.

### Task 2: Extract and characterize the QuickJS sandbox kernel

**Description:** Isolate reusable process lifecycle and VM hardening behind an internal interface while proving byte-for-byte-equivalent Workflow behavior at the public boundary.

**Acceptance criteria:**

- Existing Workflow syntax, execution, cancellation, helper-call, redaction, timeout, memory, stack, log, and IPC tests remain unchanged and green.
- Capability selection is a closed server-side discriminated union and cannot be supplied by an HTTP client.
- Child processes, timers, listeners, pending promises, and abort handlers are released on every terminal path.

**Verification:** `npx vitest run src/server/workflows/__tests__/script-runner.integration.test.ts src/server/workflows/__tests__/workflow-execution-service.test.ts`

**Dependencies:** Task 1.

**Files likely touched:**

- `src/server/workflows/script-runner.ts`
- `src/server/workflows/script-worker.ts`
- `src/server/workflows/quickjs-sandbox-kernel.ts`
- existing Workflow sandbox tests

**Estimated scope:** Medium.

### Task 3: Deliver the pure JSON transform runner

**Description:** Add the `JSON_TRANSFORM` capability profile, dedicated IPC schemas, deterministic globals, input/output validation, stable error mapping, and cancellation.

**Acceptance criteria:**

- `map/filter/reduce`, nested object construction, field rename, conditional omission, array/object merging, and root replacement return the expected JSON object.
- Non-object/undefined/cyclic/non-finite/oversized results, forbidden keys, imports, dynamic code, ambient host access, randomness/time, infinite loops, memory pressure, and stack overflow fail with stable codes.
- The profile exposes no Workflow mutation, Tool call, environment, logging, filesystem, network, process, or Node capability.

**Verification:** `npx vitest run src/server/testing/__tests__/scenario-transform-runner.test.ts`

**Dependencies:** Task 2.

**Files likely touched:**

- `src/shared/testing/scenario-transform.ts`
- `src/server/testing/scenario-transform-runner.ts`
- `src/server/workflows/script-worker.ts`
- `src/server/testing/__tests__/scenario-transform-runner.test.ts`

**Estimated scope:** Medium.

### Task 4: Integrate transforms into scenario execution

**Description:** Resolve explicit bindings with sensitivity metadata, run the transform at the canonical point, and preserve polling, cleanup, cancellation, step identity, and Run/Workflow isolation.

**Acceptance criteria:**

- Transform executes once before polling and its output reaches the exact target connection and Tool through the existing invocation seam.
- A failure records one `ERROR` step with no Run/Workflow IDs, applies existing failure policy, and never invokes the Tool; cleanup still executes.
- Concurrent executions of one definition have isolated bindings, VM processes, variables, cancellation signals, and outputs.

**Verification:** `npx vitest run src/server/testing/__tests__/scenario-runner.test.ts src/server/testing/__tests__/test-execution-service.test.ts`

**Dependencies:** Tasks 1 and 3.

**Files likely touched:**

- `src/server/testing/scenario-runner.ts`
- `src/server/testing/test-execution-service.ts`
- `src/server/testing/__tests__/scenario-runner.test.ts`
- `src/server/testing/__tests__/test-execution-service.test.ts`

**Estimated scope:** Medium.

### Checkpoint A: Runtime foundation

- Shared contracts and old definitions are compatible.
- Workflow behavior is unchanged.
- Pure transform adversarial tests pass.
- No transform failure can create a Run or call a Tool.

### Task 5: Add syntax validation and isolated preview

**Description:** Expose project-fenced, side-effect-free validate/preview services and client decoders over the same production transform runner.

**Acceptance criteria:**

- Validate compiles without executing; preview runs only explicit sample arguments/bindings and returns a runtime-decoded result.
- Preview creates no Run, Workflow, test execution, variable, environment mutation, or Tool call on success or failure.
- Rapid duplicate actions coalesce or cancel safely; project changes abort/fence stale responses.

**Verification:** focused route/service/API-client tests for validate and preview.

**Dependencies:** Task 3.

**Files likely touched:**

- `src/server/testing/scenario-transform-service.ts`
- `src/server/testing/scenario-transform-routes.ts`
- `src/client/api/api-client.ts`
- corresponding route and API-client tests

**Estimated scope:** Medium.

### Task 6: Deliver transform authoring in the step editor

**Description:** Add the transform Disclosure, binding editor, source textarea, SDK help, and draft lifecycle while retaining the current three-column scenario layout.

**Acceptance criteria:**

- Users can enable/disable, edit, save, reopen, reorder the containing step, and delete/reorder bindings without losing unrelated draft state.
- Only valid inputs, environments, prior steps, and prior variables are selectable; reference errors appear next to the responsible control.
- Chinese/English authoring copy, keyboard operation, narrow layout, and light/dark tokens are covered.

**Verification:** focused `ScenarioArgumentTransformEditor` and scenario-draft Testing Library tests.

**Dependencies:** Task 1.

**Files likely touched:**

- `src/client/features/testing/ScenarioTestCaseEditor.tsx`
- `src/client/features/testing/ScenarioArgumentTransformEditor.tsx`
- `src/shared/i18n/locales/zh-CN/testing.ts`
- `src/shared/i18n/locales/en-US/testing.ts`
- `src/client/features/testing/__tests__/ScenarioArgumentTransformEditor.test.tsx`

**Estimated scope:** Medium.

### Task 7: Deliver validation and preview UX

**Description:** Connect the authoring UI to syntax validation and sample preview with cancellation, stale-result fencing, and accessible output inspection.

**Acceptance criteria:**

- Validate never executes code and reports localized line/column diagnostics next to the source editor.
- Preview runs only explicit sample JSON, is cancellable, and becomes stale after any source/binding/sample change.
- The preview dialog has one scroll owner, keyboard-complete open/close behavior, focus restoration, and bounded JSON rendering.

**Verification:** focused editor-hook and preview-dialog Testing Library tests.

**Dependencies:** Tasks 5 and 6.

**Files likely touched:**

- `src/client/features/testing/useScenarioTransformPreview.ts`
- `src/client/features/testing/ScenarioArgumentTransformEditor.tsx`
- `src/client/features/testing/ScenarioTransformPreviewDialog.tsx`
- focused hook/component tests

**Estimated scope:** Medium.

### Task 8: Make executions traceable and transfers compatible

**Description:** Surface transform application and failures in existing reports, and prove that revision/import/export paths preserve definitions without persisting runtime samples or secrets.

**Acceptance criteria:**

- Reports identify transform use, show existing redacted resolved arguments, and localize stable errors with line/column while preserving Run/Workflow navigation.
- Export/import preserves transform source and binding references but never includes preview samples or resolved environment values.
- Old definitions and envelopes remain accepted, and copied/overwritten imports retain stable step and connection remapping semantics.

**Verification:** focused execution-report and test-transfer service/API tests.

**Dependencies:** Tasks 4 and 6.

**Files likely touched:**

- `src/client/features/testing/TestExecutionWorkspace.tsx`
- its focused report test
- `src/server/testing/test-transfer-service.ts`
- `src/server/testing/__tests__/test-transfer-service.test.ts`

**Estimated scope:** Medium.

### Task 9: Document and prove the production journey

**Description:** Document the transform SDK and limits, then prove a realistic multi-step conversion in a production build.

**Acceptance criteria:**

- Documentation explains execution order, bindings, deterministic restrictions, limits, error codes, secret behavior, and copyable examples.
- Production E2E reshapes an array of response objects, feeds the exact result to the next Tool on the intended connection, and verifies Run/Workflow traceability.
- The journey also proves transform failure creates no Tool call and existing cleanup behavior still runs.

**Verification:** targeted production Playwright scenario journey and `git diff --check`.

**Dependencies:** Tasks 7 and 8.

**Files likely touched:**

- `e2e/test-suite.spec.ts`
- `README.md`
- `docs/AUTOMATED-TESTING-1.5.0.md` or a new versioned extension spec

**Estimated scope:** Medium.

### Task 10: Run release gates and independent review

**Description:** Execute the repository's required gates and review the implementation against correctness, sandbox escape, secret leakage, compatibility, accessibility, and identity isolation.

**Acceptance criteria:**

- `npm run verify` passes with no open handle or orphan sandbox process.
- `npm run verify:release-artifacts`, `npm pack --dry-run --json`, and `git diff --check` pass.
- No released migration changed; source/dist migration byte checks remain green.
- Independent code and security review has no open Critical/Required finding.

**Verification:** commands above plus manual inspection of the packaged worker files.

**Dependencies:** Task 9.

**Files likely touched:** documentation or tests only for findings.

**Estimated scope:** Small to Medium.

## 7. Threat model

| Threat | Impact | Mitigation |
|---|---|---|
| Sandbox escape into Node/process/files/network | Critical | QuickJS child process, no host references, disabled dynamic code/imports, closed capability profile, adversarial escape tests |
| Infinite loop or allocation bomb | High | VM interrupt deadline, host hard timeout, memory/stack caps, serialized input/output caps, forced child termination |
| Secret copied into diagnostics | High | Explicit bindings, sensitivity propagation, no console/log capability, longest-first redaction, conservative derived-output redaction |
| Prototype pollution | High | Reject `__proto__`, `prototype`, and `constructor` at paths and JSON boundaries; clone into safe JSON values |
| Tool invoked after invalid/failed transform | High | Validate transform output before invocation; error result has null Run/Workflow IDs; no fallback |
| Cross-project or cross-execution state leak | Critical | Project-fenced endpoints, per-evaluation child process, immutable input clones, no shared guest state, abort/late-completion fences |
| Non-reproducible tests | Medium | Pure synchronous contract, explicit dependencies, disabled ambient time/randomness, source captured in immutable definition snapshot |
| Existing Workflow regression during kernel extraction | High | Characterization tests before refactor, no public Workflow contract change, checkpoint before transform integration |
| Large editor/runtime payload freezes UI | Medium | Source/input/output caps, lazy preview result rendering, single scroll owner, no large new editor dependency |

## 8. Compatibility and rollback

- This is an additive optional field. Existing scenarios execute exactly as before when the field is absent or `null`.
- Existing endpoint paths, Run state machine, Workflow state machine, SQLite rows, and connection/authentication identity remain unchanged.
- Saving a scenario with a transform creates a normal test-case revision; historical execution snapshots keep the exact source they used.
- Older application versions may reject exported definitions containing the new strict field. The release notes must state the minimum import version; do not silently strip transforms.
- Feature rollback disables authoring and execution of new transforms but must retain their stored JSON. Do not rewrite or delete existing test-case revisions.
- If the sandbox kernel refactor cannot prove unchanged Workflow behavior, revert that refactor and implement a separate transform worker rather than weakening tests.

## 9. Open implementation decisions

These do not block plan approval but must be resolved in Task 1 or 2 and recorded in code comments/tests:

1. Whether identifier validation should allow dotted binding names. Recommendation: JavaScript identifier syntax only, so `ctx.bindings.orders` remains ergonomic and unambiguous.
2. Whether transform output limit should be lower than the existing 2 MiB definition cap. Recommendation: 2 MiB initially, with a distinct error and telemetry-free local measurement in tests.
3. Whether to expose a deterministic `ctx.json.get` helper or keep only native property access. Recommendation: expose the existing safe JSONPath subset for quoted/dynamic property names.
4. Whether successful reports need transform duration. Recommendation: omit it from persistence in v1; add a numbered migration only if real debugging needs justify durable timing.

## 10. Definition of done

- Users can perform arbitrary deterministic JSON reshaping for a next-step Tool without creating a custom MCP Tool.
- Every dependency is explicit and uses stable input/variable/step identity.
- Output is a validated JSON object and passes the current Tool's final Schema validation.
- Transforms cannot call Tools or access network, filesystem, process, Node, environment writes, or scenario-variable writes.
- Failure, cancellation, polling, cleanup, reporting, import/export, redaction, and concurrent execution have regression coverage.
- Existing scenarios and Tool Workflows behave unchanged.
- Bilingual, keyboard-accessible authoring and preview meet the frontend standard.
- All repository release gates pass.
