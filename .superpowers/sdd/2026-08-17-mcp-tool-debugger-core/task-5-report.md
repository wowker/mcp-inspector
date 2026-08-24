# Task 5 report — persisted MCP Tool catalog

## Outcome

Implemented a project-scoped MCP Tool catalog backed by immutable SQLite snapshots. A connected MCP session can now be refreshed through paginated `tools/list`, definitions are canonically hashed and drift-classified, read APIs remain offline, and the browser can connect/disconnect servers and browse grouped Tools with explicit readiness state.

## Delivered

- Added the planned append-only `003_tools.sql` migration verbatim, including snapshot hash deduplication and current catalog status constraints.
- Added deterministic recursive JSON canonicalization with sorted object keys, preserved array order, finite-number/plain-object enforcement, sparse/cyclic/unsupported-value rejection, and lowercase SHA-256 hashes.
- Preserved the complete returned Tool definition, including Input/Output Schema, title, description, annotations, icons, execution metadata, `_meta`, and future JSON fields.
- Drained all `tools/list` pages before starting SQLite work; empty cursors remain valid, repeated cursors are rejected, and the catalog is capped at 1,000 pages.
- Rejected duplicate Tool names and structurally invalid Tool definitions at the service boundary.
- Persisted complete refreshes atomically. Identical definitions reuse snapshots; changes append snapshots; omissions become `removed`; identical later refreshes settle to `current`; and changed reappearances remain visible as `changed`.
- Added `ToolService.refresh/list/get`, project/connection ownership validation, offline reads, connected-runtime enforcement for refresh only, and normalized catalog/transport/storage errors.
- Added authenticated project-scoped refresh, list, and URL-safe detail routes. Detail responses include the current definition and chronological immutable snapshot history.
- Extended the client with strict project-owned Tool/catalog/snapshot response validators and URL-safe API methods.
- Added explicit Connect/Disconnect UI. A successful connect causes exactly one Tool refresh; refresh failure preserves the healthy transport, shows connected-but-not-ready, and leaves manual Refresh available.
- Added an accessible Tool tree grouped by connection with name/description search, collapse, visible current/changed/removed text, manual refresh, single-click selection intent, and double-click new-Tab intent.
- Isolated initial loads, refreshes, disconnects, deletes, and project switches with per-connection generations so stale asynchronous responses cannot populate a new scope.
- Rendered untrusted Tool names/descriptions only through React text nodes; no Tool HTML or `_meta` is interpreted.

## Security and architecture checks

- Network pagination completes before the repository transaction begins; list/get never access MCP.
- Refresh failures never disconnect or mutate the runtime session.
- Route errors expose stable codes/messages and do not include remote definitions, stacks, or sensitive payloads.
- Client validators reject foreign project/connection ownership, malformed UUIDs/hashes/timestamps, duplicate Tools, invalid JSON/schema shapes, and inconsistent snapshot details.
- Implementation was checked against the installed official MCP Tool/ListTools type declarations; no external network was used.

## TDD evidence

- Initial service RED failed because `tool-service.js` did not exist.
- Initial route RED returned 404 for all Tool routes.
- Initial UI RED failed because `ToolTree.js` did not exist and connection actions were absent.
- Focused final suite: 58 Task 5/server-client boundary tests passed.

## Verification

- `npm run verify` — passed using bundled Node v24.19.0.
- Full suite — 142 tests passed across 19 files, including the real loopback Streamable HTTP integration.
- TypeScript client/server typecheck — passed.
- Vite client and Node 22 tsup production build — passed.
- `cmp src/server/projects/migrations/003_tools.sql dist/server/projects/migrations/003_tools.sql` — exact byte match.
- `git diff --check` — passed.
- The complete suite exited normally without open-handle warnings.

All Node/npm/npx commands used the mandated bundled Node v24.19.0 PATH.
