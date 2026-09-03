# 2.0.1–2.0.3 UI Remediation Checklist

## Phase 1: Contract and foundation

- [x] Task 1: Add requirement-level red tests
- [x] Task 2: Implement and test shared `SearchableSelect`

### Checkpoint

- [x] Search/ranking/keyboard/focus/loading/empty/large-list tests pass
- [x] Typecheck passes

## Phase 2: Selector migration

- [x] Task 3: Migrate automated-test and scenario dynamic selectors
- [x] Task 4: Migrate environment, report, Tool-folder, and Schema enum selectors
- [x] Task 5: Reuse shared selection behavior for suite candidates

### Checkpoint

- [x] Stable IDs and stale-request fences remain covered
- [x] Focused Feature tests and build pass

## Phase 3: Layout and help

- [x] Task 6: Move/deduplicate creation and report actions
- [x] Task 7: Add dedicated Run-filter help

### Checkpoint

- [x] Every action has exactly one required location
- [x] Module and filter help coexist with correct focus behavior

## Phase 4: Production acceptance

- [x] Task 8: Add required responsive and searchable-flow E2E coverage
- [x] Task 9: Update version documentation and run final gates

### Checkpoint

- [x] `npm run verify` passes
- [x] `git diff --check` passes
- [x] 2.0.1 and 2.0.2 status reflects verified delivery
