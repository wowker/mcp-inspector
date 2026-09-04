# AI-Assisted Test Generation Checklist

> Source: [ai-test-generation-plan.md](./ai-test-generation-plan.md)

## Approval gate

- [ ] Choose the first hosted provider and approve its fixed endpoint policy.
- [ ] Approve sending explicitly selected Tool names, descriptions, and schemas to that provider.
- [ ] Approve credential lookup through a secret project environment-variable reference.
- [ ] Approve seven-day proposal retention and user-controlled history deletion.
- [ ] Confirm all generated tests are disabled and never auto-executed.
- [ ] Confirm AI-generated JavaScript/argument transforms are outside MVP.

## Phase 1: Safe provider boundary

- [ ] Task 1: Lock proposal and job contracts.
- [ ] Task 2: Add provider configuration persistence.
- [ ] Task 3: Deliver one bounded provider adapter.
- [ ] Task 4: Build sanitized catalog context.

### Checkpoint A

- [ ] Migration preserves existing 001–018 data and source/dist bytes match.
- [ ] Provider rows contain no resolved credential.
- [ ] Context fixtures prove known secrets and cross-project Tools cannot reach the provider.
- [ ] Provider timeout, cancellation, redirect, and response-size limits pass.

## Phase 2: Proposal lifecycle

- [ ] Task 5: Compile untrusted proposals.
- [ ] Task 6: Implement durable generation orchestration.
- [ ] Task 7: Apply selected proposals atomically.
- [ ] Task 8: Expose project-fenced APIs and client decoders.

### Checkpoint B

- [ ] Malformed or injected output cannot create definitions.
- [ ] Duplicate generation creates at most one provider request.
- [ ] Cancellation/restart/timeout cannot be overwritten by late completion.
- [ ] Apply creates disabled tests only and rolls back every partial write.
- [ ] Existing test/suite/Run/Workflow services remain authoritative.

## Phase 3: User experience

- [ ] Task 9: Deliver provider settings UI.
- [ ] Task 10: Deliver generation wizard.
- [ ] Task 11: Deliver proposal review and apply UI.

### Checkpoint C

- [ ] Provider request requires explicit scope and data-sharing confirmation.
- [ ] Every proposed step, mapping, extractor, assertion, cleanup, and suite member is inspectable.
- [ ] Blocking errors cannot be selected and material warnings require acknowledgement.
- [ ] Apply wording states that tests are disabled and no Tool will run.
- [ ] Chinese/English, keyboard, focus, cancel, stale, and state-preservation tests pass.

## Phase 4: Production acceptance

- [ ] Task 12: Prove the production journey.
- [ ] Task 13: Close the release gate.

### Final checkpoint

- [ ] Local fake-provider E2E covers generation, review, atomic apply, manual enable, and existing execution gates.
- [ ] Prompt injection, secret omission, malformed output, stale snapshot, duplicate start, cancellation, and rollback are proven.
- [ ] `npm run verify` passes with no open handle or orphan provider request.
- [ ] `npm run verify:release-artifacts` passes.
- [ ] Migration source/dist byte checks pass.
- [ ] `npm pack --dry-run --json` and `git diff --check` pass.
- [ ] Dependency audit has no unmitigated reachable high/critical finding.
- [ ] Independent correctness, security, privacy, and accessibility review has no open Critical/Required finding.
