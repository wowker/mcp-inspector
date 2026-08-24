# MCP Run History and Replay — Task Checklist

## Phase 1: Durable History Foundations

- [ ] Task 1: Persist replay lineage and Run pin state
- [ ] Task 2: Add filtered history and pin APIs
- [ ] Task 3: Turn Run History into a searchable explorer

### Checkpoint: History foundation

- [ ] Focused and full tests pass
- [ ] Existing Core Playwright remains green
- [ ] Independent history/cursor/ownership review passes

## Phase 2: Safe Replay

- [ ] Task 4: Build deterministic replay preflight
- [ ] Task 5: Execute replay through the existing Run engine
- [ ] Task 6: Add the replay confirmation workflow

### Checkpoint: Replay safety

- [ ] Original and replay Runs remain isolated
- [ ] Drift/risk confirmations and stale-digest rejection are proven
- [ ] Independent security/code review passes

## Phase 3: Structured Comparison

- [ ] Task 7: Implement safe structural diff and JSONPath ignores
- [ ] Task 8: Persist project comparison rules
- [ ] Task 9: Expose source-versus-replay comparison
- [ ] Task 10: Render accessible result comparison

### Checkpoint: Comparison

- [ ] Diff and JSONPath adversarial tests pass
- [ ] API ownership and stale-response fences pass
- [ ] Full regression and independent review pass

## Phase 4: Production Acceptance

- [ ] Task 11: Prove History and Replay end to end

### Checkpoint: Complete

- [ ] `npm run verify` passes
- [ ] `npm pack --dry-run --json` remains allowlisted
- [ ] Migrations 001–007 match source/dist and upgrade safely
- [ ] No listener, timer, reader, database, or browser process remains
- [ ] Spec/Quality/Security review has no Critical or Required findings
- [ ] Human approval received before merge or release
