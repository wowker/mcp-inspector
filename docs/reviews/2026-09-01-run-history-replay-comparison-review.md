# Run History, Replay, and Comparison Review

## Review status

| Item | Result |
|---|---|
| Date | 2026-09-01 |
| Scope | Tasks 1–8 in `tasks/plan.md` |
| Specification verdict | Approved; no open Critical or Required findings |
| Quality verdict | Approved; no open Critical or Required findings |
| Security verdict | Approved; no open Critical or Required findings |
| Release authority | Human approval remains required |

This is a dedicated post-implementation review pass. It does not authorize publishing, moving a release tag, or modifying production data.

## Specification review

- Run history filters, cursors, pin mutations, and stale-response fences retain project, connection, Tab, and Run identity.
- Replay preflight is read-only. Execution accepts only the preflight digest, confirmation flags, and a fresh idempotency key; arguments and response bodies are not supplied by the browser.
- Replay uses the source Run's exact connection ID and the current immutable Tool snapshot. Same-URL connections are covered by regression tests.
- Existing “打开调试” restore behavior remains separate from network replay.
- Comparison is limited to a replay and its direct source. Missing, active, unsuccessful, truncated, corrupt, and non-JSON inputs return explicit non-comparable states.
- Project ignore-rule preview is transient; save replaces the complete ordered set atomically.

## Quality review

- Shared Zod contracts validate client/server and persistence boundaries.
- Migrations 014 and 015 are additive and covered by upgrade, constraint, cascade, repeat-run, and source/dist byte tests.
- Diff traversal is iterative and bounded by node, change, path, and serialized-byte limits. Output order is deterministic.
- UI uses the existing Foundation primitives, semantic tokens, Phosphor icons, bilingual resources, abort signals, and generation fences.
- Regression coverage includes filters, pinning, immutable replay preflight, stale digest, duplicate activation, exact connection authentication, comparison rules, unavailable states, focus-safe dialogs, and project scope races.
- Production E2E covers history → schema drift → stale digest rejection → confirmed replay → lineage/trace/pin verification → ignored comparison after reload.

## Security review

- The JSONPath implementation is a parser for a deliberately small subset. It does not use `eval`, scripts, filters, recursive descent, unions, slices, or remote references.
- Prototype keys (`__proto__`, `prototype`, and `constructor`) are rejected as rule segments; compared response objects remain inert data.
- Comparison endpoints load both stored responses on the server and inherit the app's session and Origin middleware.
- Rules store paths only. They do not persist response values, credentials, headers, tokens, or resolved environment variables.
- Replay and comparison errors use stable public messages and do not include request arguments, responses, or authentication material.
- No dependency was added for this feature.

## Verification evidence

- Focused comparison suite: 44/44 passing before the final E2E addition.
- Full Vitest suite: 784/784 passing.
- Production browser journeys: existing four journeys pass after narrowing the history open-button locator; the replay/comparison journey passes independently.
- TypeScript client/server typecheck passes.
- Production Vite and tsup build passes.
- Migrations 001–015 match source and `dist` byte-for-byte.
- `npm pack --dry-run --json` succeeds using an isolated writable npm cache; the package contains the production client, server, migrations, bin entry, README, and package manifest only.
- `git diff --check` passes.

## Non-blocking observations

- Vite reports existing chunks above 500 kB. The workbench and large feature views already use lazy boundaries, but further code splitting remains a future performance improvement rather than a correctness or release blocker.
- Comparison output intentionally stops at its configured safety limits. The UI reports truncation instead of implying the displayed changes are complete.

## Rollback

Revert the feature code and redeploy the previous package. Do not delete or rewrite migrations 014 or 015 after release; older application code ignores their additive tables/columns, and preserved Run/rule data can remain in SQLite. If a release has already been published, publish a new patch version rather than moving or overwriting the existing npm version or Git tag.
