# MCP Inspector 3.0.0 Autonomous Test Design Agent Checklist

> Authoritative spec: [`docs/UPGRADE-3.0.0.md`](../docs/UPGRADE-3.0.0.md)
>
> Detailed tasks: [`tasks/upgrade-3.0.0-plan.md`](./upgrade-3.0.0-plan.md)

## Approval gate

- [ ] Select the first official hosted Provider and fixed endpoint.
- [ ] Approve sending business goals, selected Tool metadata and sanitized response fragments to the Provider.
- [ ] Approve connection-scoped SANDBOX policy as one-time authorization for uninterrupted generation.
- [ ] Confirm destructive Tools remain disabled by default and require an explicit connection grant.
- [ ] Confirm generated tests are saved disabled and are never automatically scheduled.
- [ ] Confirm raw Tool responses are process-local only and sanitized generation traces expire after seven days.
- [ ] Approve sandboxed AI-authored QuickJS argument transforms after preview and replay validation.

## Phase 1: Safe walking skeleton

- [ ] Task 1: Lock shared contracts and deterministic fixtures.
- [ ] Task 2: Deliver Provider configuration and connection autonomy policy.
- [ ] Task 3: Deliver one Tool-Calling Provider adapter.
- [ ] Task 4: Build the read-only Authoring MCP walking skeleton.

### Checkpoint A

- [ ] Fake Agent discovers and invokes one fake read-only Tool through MCP.
- [ ] Provider credentials remain reference-only and absent from captures.
- [ ] Project, connection, Tool and generation isolation tests pass.
- [ ] Cancellation, timeout and response-size bounds pass.
- [ ] Existing migrations and connection/auth data remain unchanged.

## Phase 2: Trace-to-scenario foundation

- [ ] Task 5: Add policy-enforced write calls and durable invocation recording.
- [ ] Task 6: Preserve response provenance and assemble downstream arguments.
- [ ] Task 7: Compile one explored flow into one deterministic scenario.

### Checkpoint B

- [ ] Create→read→delete works through Authoring MCP in a fake sandbox.
- [ ] Dynamic IDs compile to extractors/mappings instead of literals.
- [ ] Unknown non-idempotent outcomes are not retried.
- [ ] Stale Tool, invalid path, cycle and missing cleanup cases fail closed.
- [ ] No formal test definition is persisted or enabled yet.

## Phase 3: Autonomous generation quality

- [ ] Task 8: Implement the durable autonomous Agent orchestrator.
- [ ] Task 9: Generate assertions, polling, cleanup and suites.
- [ ] Task 10: Support bounded AI-authored argument transforms.
- [ ] Task 11: Deliver autonomous replay and bounded repair.
- [ ] Task 12: Atomically save generated cases and suites.

### Checkpoint C

- [ ] Business goal reaches a stable result without intermediate user input.
- [ ] Model/tool/time/context budgets terminate deterministically.
- [ ] Replay uses the same project, connection, environment and current Tool snapshot.
- [ ] Repair cannot expand Tool or permission scope and stops after two attempts.
- [ ] Cleanup runs on success/failure/cancel where prerequisites exist.
- [ ] Atomic save creates only disabled definitions and rolls back all partial writes.

## Phase 4: API and user experience

- [ ] Task 13: Expose generation APIs and defensive client methods.
- [ ] Task 14: Deliver the zero-interruption generation UI.

### Checkpoint D

- [ ] User only needs a configured connection/provider and business description.
- [ ] Data-sharing, policy and budget are summarized once before start.
- [ ] Generation needs no per-Tool confirmation in an authorized sandbox.
- [ ] Progress comes from authoritative server states and supports cancellation.
- [ ] Completion opens generated scenarios/suites in existing editors.
- [ ] zh-CN/en-US, keyboard, focus, dark/light and stale-response tests pass.

## Phase 5: Production acceptance

- [ ] Task 15: Prove adversarial and production journeys.
- [ ] Task 16: Close the 3.0.0 release gate.

### Final checkpoint

- [ ] Fake Provider + fake MCP E2E covers discover→explore→bind→compile→replay→repair→cleanup→save.
- [ ] Prompt injection cannot expand authority or execute unvalidated output.
- [ ] Same-URL/different-auth connections never share policy, credentials or results.
- [ ] Known fixture secrets never reach Provider requests, logs, UI or exports.
- [ ] Cancelled jobs make no late calls; interrupted jobs do not repeat unknown effects.
- [ ] Dynamic-value hardcoding corpus reports zero violations.
- [ ] `npm run verify` passes without open handles or orphan Provider/MCP requests.
- [ ] `npm run verify:release-artifacts` passes.
- [ ] Migration source/dist bytes match and historical data opens unchanged.
- [ ] `npm pack --dry-run --json` passes.
- [ ] `git diff --check` passes.
- [ ] Dependency audit has no unmitigated reachable high/critical issue.
- [ ] Independent correctness, security, privacy and accessibility review has no open Critical/Required finding.
- [ ] Human approves merge and 3.0.0 release.
