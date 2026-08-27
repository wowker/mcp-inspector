# Implementation Plan: Tool Script Workflows

## Overview

Implement the approved optional before/after JavaScript workflow as risk-first vertical slices. Existing `tasks/plan.md` belongs to a separate Run History/Replay initiative and is intentionally preserved; this feature uses dedicated plan/checklist files.

## Architecture Decisions

- Keep the legacy Run endpoint and normal execution path unchanged; route only enabled workflows through a new parent execution service.
- Reuse the existing Run state machine for every real MCP call, adding an internal nullable-Tab invocation seam rather than hidden debug Tabs.
- Use one QuickJS runtime inside one sanitized child process per script; bridge allowlisted async calls through validated IPC and deferred Promises.
- Persist configuration and parent trace additively in migration 011; never rewrite migrations 001–010.
- Stage persistent environment writes and commit only on successful workflow completion.
- Do not add an editor dependency in the foundation. Ship a functional textarea first; evaluate editor bundle cost as its own later task.

## Dependency Graph

```text
migration/contracts
├── workflow configuration API/client
├── environment variables API/client
└── sandbox IPC contracts
    └── isolated script runtime
        └── internal Run invocation seam
            └── workflow execution service/API
                └── script editor/debug UI
                    └── workflow result UI and E2E
```

## Task List

1. Lock dependency and add persistence/contracts.
2. Deliver Tool workflow configuration end to end.
3. Deliver environment variables end to end.
4. Prove isolated JavaScript evaluation and logging.
5. Add audited argument/JSON/assert/variable SDK functions.
6. Add helper Tool calls through existing Runs.
7. Orchestrate before → main → after with durable parent trace.
8. Add script editor and standalone debugging.
9. Add workflow execution/results/history UI.
10. Complete browser, security, packaging, migration, and independent review gates.

## Checkpoints

### Foundation after Tasks 1–3

- Existing full Vitest/typecheck/build remain green.
- Migration 1→11 and source/dist bytes pass.
- Disabled/absent workflows cannot alter `startRun` behavior.

### Runtime after Tasks 4–6

- Adversarial sandbox suite passes and child processes exit cleanly.
- Multiple sequential helper awaits work without Asyncify.
- Helper calls are independently inspectable Runs and never create Tabs or recurse.

### Product after Tasks 7–9

- Complete workflow works through the production API and accessible UI.
- Existing normal Run UI and Core E2E remain unchanged.
- Cancellation and reload converge from every phase.

### Release after Task 10

- `npm run verify` passes.
- `npm pack --dry-run --json` contains only the approved files and required runtime assets.
- No Critical/Required quality or security findings.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Untrusted script escapes host | Critical | QuickJS with no module loader/globals, separate sanitized child, strict IPC, adversarial capability tests |
| Infinite loop or memory exhaustion | Critical | QuickJS interrupt/memory/stack limits plus parent deadline/RSS guard and forced child termination |
| Helper calls change existing Run semantics | High | Add internal invocation seam; leave public legacy route and Tab-bound start contract unchanged |
| Partial external effects | High | No retry/rollback claim; ordered durable trace and destructive confirmation |
| Partial environment writes | High | Stage mutations and commit atomically only at workflow success |
| Cancellation race leaves active child/Run | High | One parent controller, identity fences, terminal CAS, late-event suppression, cleanup tests |
| Async bridge hangs | High | Deferred-Promise protocol, request IDs, bounded one-at-a-time IPC, deadline/cancellation tests |
| Package/WASM asset missing after npm install | High | Package smoke from packed artifact and built worker startup test |
| UI integration regresses normal debugging | Medium | Feature only appears for script config; preserve existing component/API tests and Core Playwright |
| Editor inflates client bundle | Medium | Start without dependency; measure and request approval before adding a code editor package |

## Open Questions

None for foundation. Any behavior outside the approved spec is an Ask First boundary.

