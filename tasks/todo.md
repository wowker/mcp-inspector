# Run History, Replay, and Comparison — Rebaselined Checklist

> Source: [plan.md](./plan.md). Implementation is blocked until the approval gate is confirmed.

## Approval gate

- [x] Approve migration 014 for Run pin/lineage
- [x] Approve migration 015 for project comparison ignore rules
- [x] Approve replay only on the source connection and current Tool
- [x] Approve direct source-versus-replay comparison only; defer arbitrary comparison
- [x] Approve pin behavior that does not accidentally block Server deletion

## Phase 1: History foundation

- [x] Task 1: Lock shared contracts and migration 014
- [x] Task 2: Deliver filtered history and pinning

### Checkpoint

- [x] Existing Runs survive 001–013 → 014 unchanged
- [x] Cursor/filter/project/Tab identity tests pass
- [x] Existing Run history and debug restore behavior remain unchanged

## Phase 2: Safe replay

- [x] Task 3: Deliver deterministic replay preflight
- [x] Task 4: Execute replay through the existing Run engine
- [x] Task 5: Deliver replay confirmation UI

### Checkpoint

- [x] Preflight performs no network or persistence mutation
- [x] Drift/risk confirmations and stale-digest rejection are proven
- [x] Same-URL connections cannot share authentication
- [x] Editable Tool Tab drafts remain untouched

## Phase 3: Structured comparison

- [x] Task 6: Deliver bounded diff engine and migration 015
- [x] Task 7: Deliver comparison API and UI

### Checkpoint

- [x] JSONPath adversarial and output-bound tests pass
- [x] Only direct source/replay lineage can be compared
- [x] Truncated/unavailable inputs are explicitly non-comparable
- [x] Rule/project/Run stale-response fences pass

## Phase 4: Production acceptance

- [x] Task 8: Close production acceptance
- [x] `npm run verify` passes
- [x] migrations 001–015 source/dist byte-match
- [x] `npm pack --dry-run --json` passes
- [x] `git diff --check` passes
- [x] Independent Spec/Quality/Security review has no Critical/Required
- [ ] Human approves merge or release
