# Scenario Argument Transform Checklist

> Source: [scenario-argument-transform-plan.md](./scenario-argument-transform-plan.md)

## Approval gate

- [ ] Approve the step-local `argumentTransform` contract and explicit bindings.
- [ ] Approve pure deterministic JavaScript with no additional QuickJS host privileges.
- [ ] Approve no migration for v1 unless durable transform-specific diagnostics become necessary.
- [ ] Approve 256 KiB source, 4 MiB input, 2 MiB output, and 100–5,000 ms execution limits.

## Phase 1: Contract and sandbox foundation

- [ ] Task 1: Lock the additive transform contract.
- [ ] Task 2: Extract and characterize the QuickJS sandbox kernel.
- [ ] Task 3: Deliver the pure JSON transform runner.

### Checkpoint A

- [ ] Old scenario definitions and exports remain compatible.
- [ ] Existing Workflow sandbox tests pass unchanged.
- [ ] Transform adversarial and resource-limit tests pass.
- [ ] Failed transforms cannot create a Run or invoke a Tool.

## Phase 2: Runtime and authoring

- [ ] Task 4: Integrate transforms into scenario execution.
- [ ] Task 5: Add syntax validation and isolated preview.
- [ ] Task 6: Deliver transform authoring in the step editor.
- [ ] Task 7: Deliver validation and preview UX.

### Checkpoint B

- [ ] Array/object reshape reaches the next Tool with exact JSON types.
- [ ] Polling reuses one transformed argument snapshot.
- [ ] Cleanup, cancellation, failure policy, and concurrent execution are deterministic.
- [ ] Preview is project-fenced and creates no persistent or external side effect.
- [ ] Chinese/English, keyboard, focus, stale-response, and dark/light tests pass.

## Phase 3: Traceability and release

- [ ] Task 8: Make executions traceable and transfers compatible.
- [ ] Task 9: Document and prove the production journey.
- [ ] Task 10: Run release gates and independent review.

### Final checkpoint

- [ ] Transform source and explicit bindings are captured in definition revisions and execution snapshots.
- [ ] Reports and exports do not leak secret values or preview samples.
- [ ] Connection, Tool, step, Run, Workflow, and execution identity isolation passes.
- [ ] `npm run verify` passes without open handles or sandbox processes.
- [ ] `npm run verify:release-artifacts` passes.
- [ ] `npm pack --dry-run --json` and `git diff --check` pass.
- [ ] Independent correctness and security review has no open Critical/Required finding.
