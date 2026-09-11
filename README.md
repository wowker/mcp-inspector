# MCP Inspector

<p align="center">
  A local-first workbench for inspecting, debugging, testing, replaying, and safely authoring MCP Tool workflows.
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@wuwei0215/mcp-inspector"><img alt="npm version" src="https://img.shields.io/npm/v/%40wuwei0215%2Fmcp-inspector"></a>
  <img alt="Node.js 22 or newer" src="https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white">
  <img alt="MCP transport: Streamable HTTP" src="https://img.shields.io/badge/MCP-Streamable_HTTP-5A67D8">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white">
</p>

![MCP Inspector Tool debugging workspace](https://raw.githubusercontent.com/wowker/mcp-inspector/main/e2e/i18n-smoke.spec.ts-snapshots/tool-debug-en-light-darwin.png)

MCP Inspector runs entirely on your computer and gives developers, testers, and AI-agent builders an API-client-style interface for MCP servers. Connect a Streamable HTTP server, inspect its Tool catalog and schemas, execute calls, preserve protocol-level evidence, build deterministic tests, run controlled load checks, and expose a guarded Authoring MCP endpoint to external AI hosts.

The application binds only to `127.0.0.1`. Projects, connections, tabs, drafts, runs, test assets, and protocol events are stored in local SQLite databases.

## Table of contents

- [Why MCP Inspector](#why-mcp-inspector)
- [Feature overview](#feature-overview)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Core workflows](#core-workflows)
- [Authoring MCP](#authoring-mcp)
- [Security model](#security-model)
- [Current limitations](#current-limitations)
- [Development](#development)
- [Project structure](#project-structure)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Security reports](#security-reports)
- [License](#license)

## Why MCP Inspector

- **Local-first:** application data remains on the machine running Inspector.
- **Protocol-aware:** inspect formatted results, raw MCP responses, JSON-RPC details, HTTP summaries, and ordered event timelines.
- **Identity-safe:** project, connection, Tool, tab, run, and test identities remain isolated even when servers share a URL.
- **Test-ready:** turn exploratory calls into reusable requests, deterministic test cases, scenarios, suites, reports, and pressure tests.
- **Agent-compatible:** let Codex, Claude, Cursor, and other MCP hosts discover approved downstream Tools and author test drafts through a policy-controlled local endpoint.
- **Bilingual and accessible:** switch between English and Simplified Chinese, use light or dark mode, and navigate responsive, keyboard-oriented interfaces.

## Feature overview

### Projects, servers, and authentication

- Create and switch between isolated local projects.
- Save multiple Streamable HTTP MCP server connections.
- Connect with no authentication, a Bearer token, custom request headers, or browser-based OAuth.
- OAuth support includes PKCE, protected-resource discovery, dynamic client registration, and in-browser authorization.
- Import and export server configuration while keeping secret values redacted.
- Resolve Bearer tokens and custom headers from project- or server-scoped environment variables.
- Keep authentication keyed by the exact connection ID, never only by URL or domain.

### Tool catalog and schema inspection

- Fetch, refresh, search, filter, paginate, favorite, and organize Tools into local folders.
- Filter by all, favorite, recent, changed, or removed Tools.
- Preserve immutable Tool-definition snapshots and identify current, changed, and removed entries.
- Inspect descriptions, input and output schemas, behavior annotations, icons, protocol extensions, schema hashes, and snapshot history.
- Understand JSON Schema Draft 2020-12 and Draft 7 declarations, with warnings for unknown dialects.

### Parameter editing and Tool debugging

- Edit arguments through a schema-driven form or Raw JSON.
- Handle nested objects, arrays of objects, enums, booleans, JSON subtrees, additional properties, and schema branches.
- Validate required fields, types, formats, patterns, ranges, lengths, and other schema constraints before execution.
- Search and filter fields, expand long descriptions, format/copy JSON, and open enlarged JSON editors.
- Open multiple isolated, restorable tabs for the same Tool; pin, duplicate, reorder, or close tabs without mixing drafts.
- Use request-focused, balanced, or result-focused split-pane presets.

### Saved requests and responses

- Save named request and response payloads for each Tool.
- Load a saved request back into the current debug tab.
- Copy saved JSON or create a test case directly from saved content.
- Load large detail documents on demand to keep lists responsive.

### Run history, replay, and comparison

- Persist every Tool call with its arguments, result, status, timing, connection, Tool snapshot, source, and ordered protocol events.
- Inspect formatted output, raw response data, JSON-RPC, HTTP trace summaries, and script-pipeline details.
- Browse project-wide or current-tab history with stable cursor pagination.
- Search and filter by Tool name, call ID, status, server, invocation origin/source, pinned state, and time range.
- Pin important runs and use optional bounded auto-refresh intervals.
- Open historical runs in read-only tabs without accidentally calling the Tool again.
- Replay a completed run only after explicit confirmation, using the original connection ID and arguments with the current Tool definition.
- Require separate confirmation for schema drift and potentially destructive effects; replay never silently retries or crosses servers.
- Compare a replay with its direct source using a bounded structural diff and project-scoped JSONPath ignore rules.

### Environment variables and profiles

- Define JSON-valued variables at project and server scope.
- Mark variables as secret so values are redacted from lists, previews, logs, exports, and persisted run evidence.
- Reference scalar variables in connection credentials and workflow configuration with `{{VARIABLE_NAME}}` templates.
- Create inheritable environment profiles, override or unset values, preview the effective chain, and select an active profile per server.
- Commit project/server variable changes from a successful script pipeline atomically.

### Pre- and post-execution scripts

- Attach isolated `before` and `after` JavaScript to an individual Tool.
- Modify main-call arguments before execution and inspect the complete response afterward.
- Call authorized helper Tools, work with temporary variables, query deterministic JSON paths, run assertions, and emit structured logs.
- Validate syntax or dry-run a single phase without calling the main Tool.
- Execute ES2022 code inside a separate QuickJS process with no Node.js, network, filesystem, dynamic import, `eval`, or host-global access.
- Enforce configurable timeouts plus memory, stack, log-size, log-count, and helper-call limits.
- Cancel a pipeline and discard staged environment writes if any phase fails.

Script entry point:

```js
export default async function before(ctx) {
  const profile = await ctx.tools.call({
    server: "current",
    name: "get_account_profile",
    arguments: {},
  });

  ctx.arguments.set(
    "account_id",
    ctx.json.get(profile, "$.structuredContent.account_id"),
  );
  ctx.log.info("Account prepared");
}
```

The script SDK includes `ctx.arguments`, `ctx.tools`, `ctx.response`, `ctx.variables`, `ctx.env`, `ctx.json`, `ctx.assert`, and `ctx.log`.

### Automated testing

- Create revisioned single-Tool and multi-step scenario test cases.
- Add declarative assertions against the run, MCP result/error, HTTP metadata, workflow result, or scenario variables.
- Use existence, equality, subset, string, numeric, length, array, type, schema, status, error-state, and duration operators.
- Resolve expected assertion values from literals or extracted scenario variables.
- Map scenario inputs, constants, previous-step outputs, and environment values into later Tool arguments.
- Transform mapped arguments, extract response values, poll until conditions pass, and run cleanup steps.
- Preserve step, attempt, Run, workflow, cancellation, skip, and cleanup traceability.
- Build suites containing Tool and scenario tests with bounded concurrency and optional stop-on-failure behavior.
- Preview test calls and require explicit confirmation for destructive scopes.
- Import and export versioned JSON test definitions with full-package validation, conflict policies, and explicit server rebinding.
- Update assertion baselines only through an explicit, revision-safe action.

### Test reports

- Browse project- and suite-scoped execution history.
- Navigate reports through suite member, invocation, and one complete selected Tool result.
- Inspect final arguments, assertion results, errors, timing, and the linked Run/Workflow chain.
- Save immutable named report versions such as `1.0` and `2.0` without duplicating request or response payloads.
- Edit saved-version metadata and filter by suite, status, saved state, or version label.

### Controlled pressure testing

- Repeatedly execute an existing saved test case with 1–20 virtual users.
- Configure ramp-up, duration, think time, iteration limits, and controlled cancellation.
- Evaluate maximum error rate, p95 duration, and minimum requests per second.
- Stop early on an error-rate threshold when configured.
- Inspect live progress, per-sample traceability, throughput, error totals, and min/average/p50/p90/p95/p99/max latency summaries.
- Snapshot the exact pressure-test and target-test revisions used by each execution.

### Authoring MCP for external AI hosts

- Run Inspector itself as a local Streamable HTTP MCP server at `/mcp/authoring`.
- Expose a fixed Tool set for capability discovery, project/server/Tool catalog access, audited standalone calls, Draft authoring, deterministic validation, asynchronous trials, cancellation, and atomic save.
- Seed Drafts from an existing test asset or a sanitized Authoring call.
- Save validated Drafts as disabled Tool tests, scenarios, and suites; AI clients cannot enable, delete, schedule, or manage secrets.
- Configure per-connection `DISABLED`, `READ_ONLY`, `CUSTOM`, or `FULL_ACCESS` policies plus allow/deny lists and safety limits.
- Enforce schema hashes, revisions, idempotency keys, rate/concurrency limits, timeouts, mandatory redaction, and complete call lineage.
- Review Authoring settings, Drafts, and calls in the browser workbench.

## Requirements

- Node.js 22 or newer
- npm
- Google Chrome only when running the end-to-end test suite

MCP Inspector currently supports Streamable HTTP MCP servers. It does not launch or manage downstream server processes for you.

## Quick start

Run the latest npm release:

```bash
npx --yes @wuwei0215/mcp-inspector@latest
```

Or install and run from source:

```bash
git clone https://github.com/wowker/mcp-inspector.git
cd mcp-inspector
npm install
npm run build
npm start
```

Inspector opens a local browser and listens on `127.0.0.1:8500`. To choose another available port:

```bash
mcp-inspector --port 8501
# or
MCP_INSPECTOR_PORT=8501 mcp-inspector
```

Priority is `--port`, then `MCP_INSPECTOR_PORT`, then the fixed default `8500`. Inspector fails clearly if the selected port is unavailable instead of silently switching ports.

For source checkouts, the Makefile can install missing dependencies, rebuild, and manage a background process:

```bash
make          # same as make restart
make status
make logs     # Ctrl-C stops following logs
make stop
```

## Core workflows

### Connect and call a Tool

1. Create or select a project.
2. Add a server connection and choose its authentication mode.
3. Connect and refresh the Tool catalog.
4. Select a Tool, complete its arguments in Form or Raw JSON mode, and run it.
5. Inspect the result and protocol timeline, then save useful requests/responses or convert the call into a test.

### Turn exploration into regression coverage

1. Save a Tool call as a test case or create a scenario from multiple steps.
2. Add deterministic assertions, mappings, polling, and cleanup policies.
3. Group tests into a suite and choose bounded concurrency.
4. Run the suite, inspect the report, and save important report versions or update baselines explicitly.
5. Use controlled pressure tests when you need repeatability, latency, throughput, and error-rate evidence.

## Authoring MCP

Enable **Authoring MCP** in the left navigation, copy the one-time token, and grant each downstream server the minimum required policy. The default endpoint is:

```text
http://127.0.0.1:8500/mcp/authoring
```

Example MCP-host configuration:

```json
{
  "mcpServers": {
    "mcp-inspector-authoring": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:8500/mcp/authoring",
      "headers": {
        "Authorization": "Bearer <YOUR_TOKEN>"
      }
    }
  }
}
```

Put the token in the `Authorization` header, never in the URL. It is displayed only when Authoring MCP is first enabled or when the token is rotated.

Available Authoring Tools:

| Area | Tools |
| --- | --- |
| Capabilities | `inspector_get_capabilities` |
| Discovery | `inspector_list_projects`, `inspector_list_connections`, `inspector_list_tools`, `inspector_describe_tool` |
| Audited calls | `inspector_call_tool`, `inspector_list_tool_calls`, `inspector_get_tool_call` |
| Drafts | `inspector_create_draft`, `inspector_create_draft_from_call`, `inspector_list_drafts`, `inspector_get_draft`, `inspector_replace_draft` |
| Validation and trials | `inspector_validate_draft`, `inspector_execute_draft`, `inspector_get_draft_execution`, `inspector_cancel_draft_execution` |
| Formal assets | `inspector_save_draft`, `inspector_list_test_assets`, `inspector_get_test_asset` |

See [the 3.0.0 Authoring MCP specification](./docs/UPGRADE-3.0.0.md) for the full permission, error, and lifecycle contract.

## Security model

- The application and Authoring endpoint bind only to loopback (`127.0.0.1`).
- Every process launch generates a new random browser-session token. The bootstrap URL is replaced after first use and the token is kept in tab-scoped session storage.
- OAuth access tokens remain in the Inspector process and are not written to SQLite, exports, or browser storage.
- Secrets are excluded from URLs, ordinary logs, Toast messages, default exports, and persisted evidence.
- Project, connection, tab, run, and test identities are checked at every boundary.
- Replay is explicit, connection-bound, non-retrying, and guarded for schema drift and destructive effects.
- Script execution is sandboxed in a separate QuickJS process with resource limits.
- Authoring MCP uses a one-time-visible Bearer token, per-connection policies, mandatory redaction, bounded responses, and audited calls.
- SQLite migrations are additive; previously released migrations are never rewritten.

MCP Tools can have real external side effects. Inspector provides confirmations and guardrails, but it cannot roll back changes made by a downstream Tool.

## Current limitations

- Downstream connections use Streamable HTTP; stdio and legacy SSE transports are not supported.
- OAuth access tokens are intentionally memory-only, so authorization is required again after restart.
- Replay compares only a replay run with its direct source, not arbitrary pairs of runs.
- Missing, active, failed, truncated, corrupt, or non-JSON results cannot enter structural comparison.
- Script JSON paths use a deterministic subset rather than the full JSONPath language.
- Pressure testing is intentionally bounded and is not a replacement for a distributed load-testing platform.
- Inspector is a local workbench, not a hosted multi-user service or secret manager.

## Development

Start the API and Vite client in development mode:

```bash
npm install
npm run dev
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Type-check client and server projects |
| `npm test` | Run the Vitest unit and integration suite |
| `npm run build` | Build the production client and server |
| `npm run test:e2e` | Build and run Playwright tests in Chrome |
| `npm run verify` | Run type checks, serialized release tests, production build, and E2E tests |
| `npm run verify:release-artifacts` | Verify build budgets, migration integrity, and npm package contents |

Changes to core workflows, authentication, persistence, routing, layout, or production entry points must pass `npm run verify` before merge.

## Project structure

```text
src/
├── client/       React workbench, feature pages, shared UI, and i18n
├── server/       Hono API, MCP clients, services, SQLite repositories, and Authoring MCP
└── shared/       Runtime schemas and contracts shared across client/server boundaries
e2e/              Playwright workflows, accessibility checks, and visual snapshots
docs/             Feature specifications, upgrade notes, reviews, and architecture decisions
scripts/          Development, build, release, and artifact-verification scripts
test-support/     Local MCP fixtures and adversarial test helpers
```

The stack is TypeScript, React 19, Hono, the Model Context Protocol SDK, SQLite (`better-sqlite3`), Zod, AJV, QuickJS, Vitest, and Playwright.

## Documentation

- [Frontend development standards](./docs/FRONTEND-DEVELOPMENT-STANDARDS.md)
- [Automated testing design](./docs/AUTOMATED-TESTING-1.5.0.md)
- [Tool script workflows](./docs/SPEC-tool-script-workflows.md)
- [Environment profiles](./docs/ENVIRONMENT-PROFILES-2.0.md)
- [Suite execution reports](./docs/UPGRADE-2.5.0.md)
- [Controlled pressure testing](./docs/UPGRADE-2.5.1.md)
- [Authoring MCP](./docs/UPGRADE-3.0.0.md)
- [Internal UI foundation decision](./docs/decisions/001-internal-ui-foundation.md)
- [Changelog](./CHANGELOG.md)

## Contributing

Issues and pull requests are welcome. Before changing UI, interaction, client state, CSS, accessibility, or browser behavior, read the [frontend development standards](./docs/FRONTEND-DEVELOPMENT-STANDARDS.md). Preserve project and connection identity isolation, keep secrets out of persisted/browser-visible surfaces, reuse shared runtime schemas, add regression coverage for behavior changes, and run the verification appropriate to your change.

A focused contribution typically follows:

```bash
git checkout -b feature/short-description
npm install
npm run dev
npm run verify
```

Please keep commits scoped and describe both the user-visible outcome and the verification performed.

## Security reports

Do not place credentials, tokens, private MCP responses, or exploit details in a public issue. Report security-sensitive findings privately to the repository maintainers through GitHub before public disclosure.

## License

This repository does not currently include a software license. Until the maintainers add one, copyright remains with the project authors and no redistribution license is granted by default.
