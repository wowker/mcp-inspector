# Changelog

## Unreleased — 2.0.0 release candidate

### Release readiness

- Added a data-bearing 1.x-to-current SQLite migration matrix covering Server, Tool, Tab, Run, script, variable, and automated-test data.
- Added authenticated loopback fixtures for custom Header, Bearer Token, environment-resolved credentials, OAuth, and unauthenticated connections.
- Added enforceable initial JS/CSS gzip budgets, contiguous byte-identical migration checks, and an npm package allowlist.
- Added bounded rendering for large JSON values; 10 MB documents no longer mount the complete tree on the main thread.
- Reduced initial CSS from 72.45 KiB gzip to 49.75 KiB gzip by loading Primer base styles instead of its unused full component bundle.
- Stabilized the release verification suite by serializing Vitest only for `npm run verify`; normal `npm test` remains parallel.

### Verification

- TypeScript, Vitest 819/819, production Playwright 6/6, npm package allowlist, 18 migration byte checks, and production dependency audit pass.
- Package version remains unchanged until the independent review and explicit 2.0 release-candidate approval are complete.

## Unreleased — planned 1.5.0

### Added

- Single-Tool and multi-step scenario test definitions with declarative assertions.
- Deterministic scenario execution with mappings, extracted variables, polling, cleanup, cancellation, and Run/Workflow traceability.
- Test suites with bounded concurrency, stop-on-failure, destructive-scope confirmation, and deterministic reports.
- Project-scoped test report history with explicit, revisioned baseline updates.
- Versioned automated-test definition export and atomic import with explicit Server rebinding and conflict policies.
- Filterable, pinnable project Run history with stable cursor identity and additive replay lineage.
- Read-only replay preflight with separate schema-drift and side-effect confirmations, followed by exact-argument replay on the source connection.
- Bounded direct source-versus-replay structural comparison with safe project-scoped JSONPath ignore rules and explicit non-comparable states.

### Security and compatibility

- Test targets and authentication remain isolated by project and connection ID, including Servers that share the same URL.
- Default test exports omit credentials, resolved secrets, execution history, and reports.
- Migrations 012–015 are additive; released migrations 001–011 remain unchanged.
- Replay authentication is resolved by the source connection ID, never by a shared URL or domain; comparison response bodies are loaded only by the server.
- Import validates the complete package and all Server bindings before a single SQLite transaction writes definitions.

This entry documents implemented but not yet published work. The package version remains unchanged until the release workflow is explicitly run.
