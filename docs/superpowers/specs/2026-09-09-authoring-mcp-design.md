# MCP Inspector 3.0.0 Authoring MCP Design

## Status

| Field | Value |
|---|---|
| Status | Approved; implementation plan ready |
| Target release | `3.0.0` |
| Current application version | `2.7.0` |
| Current project migration baseline | `001`–`020` |
| Date | 2026-09-09 |
| Upgrade index | [`../../UPGRADE-3.0.0.md`](../../UPGRADE-3.0.0.md) |

## 1. Decision summary

MCP Inspector 3.0.0 does not embed, configure, or call an AI model. It runs a local
Authoring MCP Server that external AI Hosts such as Codex, Claude, or Cursor can call.
The external AI owns reasoning and conversation. Inspector remains authoritative for
project and connection identity, downstream Tool access, deterministic validation and
execution, auditing, redaction, concurrency, and persistence.

The first release uses one Inspector process and one fixed, configurable loopback HTTP
listener. The Authoring endpoint reuses the existing ConnectionRuntime, Run, testing,
suite, workflow, environment, QuickJS, and SQLite services.

```text
External AI Host
        │ Streamable HTTP + Authoring Bearer Token
        ▼
http://127.0.0.1:8500/mcp/authoring
        │
        ▼
MCP Inspector process
├── Web UI and browser REST API
├── Authoring MCP adapter
├── Authoring policy, call, Draft, validation, execution, and Apply services
├── existing ConnectionRuntime and RunService
├── existing deterministic testing services and QuickJS sandbox
├── installation registry.sqlite
└── per-project project.sqlite
        │ exact connectionId
        ▼
Configured downstream MCP Servers
```

This specification supersedes the previous 3.0.0 embedded Provider Adapter and
autonomous Agent Loop direction. Older AI-generation task documents are historical only.

## 2. Product outcome

Users currently inspect Tool schemas, experiment with arguments, discover response paths,
connect outputs to later inputs, write scripts, configure assertions, and assemble suites
manually. An external AI should perform that authoring through a narrow, observable
interface without gaining direct database, credential, filesystem, or process access.

A successful flow is:

1. Start Inspector and configure downstream Servers as today.
2. Enable Authoring MCP and configure its endpoint and Token in an external AI Host.
3. Grant each intended connection an explicit Authoring policy.
4. Let the AI discover projects, connections, Tools, and existing test assets.
5. Call a Tool independently for diagnosis, or create a Draft and explore in context.
6. Author a deterministic Draft Bundle, validate it, and optionally trial-run it.
7. Save the exact validated revision through one atomic Apply operation.
8. Run the resulting ordinary test cases and suites later without AI.

## 3. Goals and non-goals

### Goals

- Local Streamable HTTP Authoring MCP with a stable endpoint.
- External AI Hosts without an Inspector model Provider.
- Project, connection, Tool, and existing-test discovery.
- Standalone diagnostic Tool calls and Draft-scoped Tool calls.
- A highest permission mode for all current and future downstream Tools.
- Tool tests, scenarios, assertions, mappings, polling, cleanup, bounded step-local
  transformations, and test suites.
- Deterministic Draft validation, trial execution, and atomic Apply.
- Reuse of current editors, runners, Run history, connection isolation, and SQLite data.
- Structured, actionable errors for humans and AI clients.

### Non-goals for 3.0.0

- Embedded models, Provider adapters, model credentials, budgets, or chat UI.
- Remote, LAN, public, or cloud Authoring access.
- A stdio bridge, multiple users, roles, or multiple Authoring Tokens.
- Direct AI access to SQLite, files, shell commands, or Node APIs.
- AI management of OAuth, Bearer, custom Header, or secret environment values.
- AI deletion of projects, Servers, tests, suites, or other formal assets.
- AI enabling tests, scheduling recurring execution, or creating pressure tests.
- AI mutation of shared Tool before/after workflow scripts.
- Long-term storage of external AI conversations or hidden reasoning.

## 4. Runtime and endpoint

### 4.1 One process and route boundary

The existing Node process owns browser and Authoring traffic. No second business process
may open project databases, hold OAuth state, connect downstream, or run tests.

```text
/api/*                  browser Session Cookie
/mcp/authoring          Authoring Bearer Token
/bootstrap/*            one-time browser bootstrap
/oauth/*                existing OAuth flow
```

`/mcp/authoring` is mounted before the SPA fallback and outside `/api/*` browser session
middleware. The MCP adapter handles protocol/session concerns and calls Authoring domain
services; it contains no SQL or downstream connection implementation.

### 4.2 Fixed startup port

Production defaults to:

```text
Web UI/API:   http://127.0.0.1:8500
Authoring:    http://127.0.0.1:8500/mcp/authoring
```

Supported startup forms include:

```bash
mcp-inspector --port 8501
npm start -- --port 8501
MCP_INSPECTOR_PORT=8501 mcp-inspector
```

Precedence is programmatic/CLI `--port`, environment variable, then default `8500`.
The port is not persisted. Normal CLI ports are integers from 1 through 65535; tests may
explicitly use `0`. Binding remains `127.0.0.1`. An occupied port produces an actionable
startup failure and never silently falls back.

### 4.3 MCP sessions and shutdown

Use bounded stateful Streamable HTTP sessions for protocol state and client information.
Session state is never business authority: every Tool input carries exact resource IDs.
Authorization is checked on every request, so Token rotation or service disablement
invalidates existing sessions immediately.

Shutdown stops new Authoring work, gives active requests a bounded completion window,
cancels Draft execution, records indeterminate calls, closes MCP sessions, and then
closes workflow, Run, connection, and SQLite services.

## 5. Installation authentication

Authoring uses one installation-level Bearer Token distinct from browser bootstrap and
Session Cookies, downstream credentials, and environment variables. It is accepted only
in the `Authorization` Header; credentials in URLs, cookies, Tool arguments, or metadata
are rejected.

Inspector generates a high-entropy Token when Authoring is enabled. Only a cryptographic
digest and non-sensitive hint are persisted. Plaintext is displayed or copied once and
then discarded. Regeneration atomically replaces the digest, invalidates the old Token,
and emits a sanitized security event. Disabling Authoring rejects traffic but retains
Drafts and history.

Request controls:

- missing or invalid Token: HTTP `401`;
- Authoring disabled: HTTP `403`;
- body too large: HTTP `413`;
- unsupported media type: HTTP `415`;
- shutting down: HTTP `503`;
- no permissive CORS;
- absent Origin is accepted for non-browser clients; a supplied Origin must be the
  Inspector origin or an explicitly valid loopback development origin.

## 6. Connection Authoring policy

Policy is keyed by exact `projectId + connectionId`; URL, domain, display name, and UI
selection are never authorization identities.

```ts
type AuthoringAccessMode =
  | "DISABLED"
  | "READ_ONLY"
  | "CUSTOM"
  | "FULL_ACCESS";

interface ConnectionAuthoringPolicy {
  mode: AuthoringAccessMode;
  allowedTools: string[];
  deniedTools: string[];
  requireCleanupForDraftMutations: boolean;
  maxCallsPerMinute: number;
  maxConcurrentCalls: number;
  maxCallDurationMs: number;
  revision: number;
}
```

- `DISABLED`: no catalog details or calls for the connection.
- `READ_ONLY`: only Tools explicitly approved by the user as read-only. Downstream
  annotations can inform the UI but are not authorization.
- `CUSTOM`: explicit allowlist grants access; deny list wins; new Tools default denied.
- `FULL_ACCESS`: all current and future Tools are executable, including writes, deletes,
  destructive Tools, and Tools without reliable annotations. Lists do not narrow it.

`FULL_ACCESS` is the highest downstream Tool permission. It does not bypass identities,
schemas, rate/concurrency limits, timeouts, auditing, idempotency, redaction, QuickJS
isolation, or Inspector management boundaries. Cleanup policy is independent: full
access never blocks a Tool call merely because it mutates, while a configured Draft
cleanup requirement may still block validation or Apply.

Missing policy means `DISABLED`. Browser UI confirmation must name the Server and explain
that FULL_ACCESS includes future and destructive Tools. MCP tools cannot change policy.

## 7. Public Authoring tools

The service exposes fixed tools rather than dynamically registering downstream Tools.
This avoids name collisions, keeps context bounded, preserves exact connection identity,
and centralizes policy and audit logic.

### System and context

```text
inspector_get_capabilities
inspector_list_projects
inspector_list_connections
```

Capabilities report application/protocol versions, endpoint, supported asset types and
features, and hard limits. Connection summaries include stable identity, connection and
authorization state, Tool snapshot metadata, and policy summary without secrets.

### Tool discovery and invocation

```text
inspector_list_tools
inspector_describe_tool
inspector_call_tool
inspector_list_tool_calls
inspector_get_tool_call
```

Catalog lists are paginated summaries with Schema hashes. Description returns bounded,
sanitized schemas and annotations, all marked as untrusted downstream data.

`inspector_call_tool` accepts either:

```ts
type AuthoringCallContext =
  | { kind: "STANDALONE"; label?: string }
  | { kind: "DRAFT"; draftId: string; draftRevision: number };
```

Its complete input includes project ID, connection ID, Tool name, expected Schema hash,
JSON object arguments, context, purpose, and idempotency key. Purpose is DIAGNOSTIC,
DISCOVERY, SETUP, ACTION, POLL, or CLEANUP.

Standalone calls do not require a Draft and support unrelated debugging. Both contexts
create a normal Run and an Authoring call record and return `callId` plus `runId`.

### Draft lifecycle

```text
inspector_create_draft
inspector_create_draft_from_call
inspector_list_drafts
inspector_get_draft
inspector_replace_draft
inspector_validate_draft
inspector_execute_draft
inspector_get_draft_execution
inspector_cancel_draft_execution
inspector_save_draft
```

Draft creation can start empty or from an existing asset revision. Creating from a call
copies sanitized arguments and response evidence, never authentication. Replacement sends
the complete bounded definition with `expectedRevision`, avoiding partially applied
step-editing tools. Validation does not invoke downstream Tools. Trial execution is
asynchronous. Apply requires exact revision, validation digest, and idempotency key.

### Existing asset discovery

```text
inspector_list_test_assets
inspector_get_test_asset
```

Supported assets are Tool tests, scenario tests, and suites. They can seed Drafts, but
updates require the exact source revision. No Authoring delete or enable tool exists.

## 8. Contract conventions

### Identity and pagination

Every project operation includes `projectId`; connection operations add `connectionId`;
Tool calls add `toolName` and `toolSchemaHash`; Draft writes add `expectedRevision`.
Names, URLs, or previous calls never substitute for stable identities.

Lists use opaque cursors with default limit 50 and maximum 100. Cursors bind project and
filters. Ordering is stable, normally `updatedAt DESC, id DESC`.

### Idempotency

Every create, change, execution, cancellation, Apply, and downstream invocation accepts
an idempotency key of 1–200 characters. Repositories atomically claim project/key with a
canonical request hash. Same key and body returns the original result; a different body
returns `IDEMPOTENCY_CONFLICT`; timeout does not authorize a new-key retry.

### Success and failure

```ts
interface AuthoringSuccess<T> {
  ok: true;
  data: T;
  meta: {
    requestId: string;
    protocolVersion: "1";
    warnings: AuthoringWarning[];
  };
}

interface AuthoringFailure {
  ok: false;
  error: {
    code: string;
    category:
      | "AUTHENTICATION" | "AUTHORIZATION" | "VALIDATION"
      | "NOT_FOUND" | "CONFLICT" | "RATE_LIMIT"
      | "CONNECTION" | "EXECUTION" | "INTERNAL";
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
    resolution?: string;
    issues?: ValidationIssue[];
  };
  meta: { requestId: string; protocolVersion: "1" };
}
```

Success returns concise text plus structured content. Authenticated domain failures use
MCP Tool errors with the structured envelope. A downstream Tool business failure is a
successfully recorded Authoring call with call status `FAILED`, not an invalid Authoring
request.

### Stable error codes

```text
AUTHORING_AUTH_REQUIRED       AUTHORING_TOKEN_INVALID
AUTHORING_DISABLED            AUTHORING_POLICY_DENIED
PROJECT_NOT_FOUND             CONNECTION_NOT_FOUND
CONNECTION_PROJECT_MISMATCH   TOOL_NOT_FOUND
TOOL_SCHEMA_CHANGED           TOOL_ARGUMENTS_INVALID
CONNECTION_UNAVAILABLE        CALL_RATE_LIMITED
CALL_TIMEOUT                  CALL_FAILED
CALL_CANCELLED                CALL_OUTCOME_UNKNOWN
DRAFT_NOT_FOUND               DRAFT_INVALID
DRAFT_TOO_LARGE               DRAFT_REVISION_CONFLICT
DRAFT_VALIDATION_STALE        DRAFT_EXECUTION_ACTIVE
DRAFT_EXECUTION_NOT_FOUND     DRAFT_EXECUTION_REQUIRED
DRAFT_SIDE_EFFECTS_UNRESOLVED DRAFT_ALREADY_APPLIED
DRAFT_APPLY_CONFLICT          DRAFT_APPLY_FAILED
INVALID_INPUT                 IDEMPOTENCY_CONFLICT
REQUEST_LIMIT_EXCEEDED        INTERNAL_ERROR
```

Unknown non-idempotent writes are not retryable and instruct the caller to inspect target
state. Internal errors omit stack, SQL, paths, credentials, and raw downstream bodies.

## 9. Automation Draft model

Draft is a pending representation of current test assets, not a second execution model.
Its durable state is `ACTIVE`, `APPLIED`, or `DISCARDED`. Validation and execution are
immutable attempts bound to a Draft revision and digest. Editing increments revision and
invalidates older validation for Apply while retaining history.

```ts
interface AutomationDraft {
  version: 1;
  id: string;
  projectId: string;
  revision: number;
  state: "ACTIVE" | "APPLIED" | "DISCARDED";
  goal: string;
  testCases: DraftTestCase[];
  suites: DraftTestSuite[];
  sourceAssets: DraftSourceAsset[];
  createdAt: string;
  updatedAt: string;
}
```

Generated IDs, project ID, timestamps, formal revisions, and enablement are not accepted
inside authored asset definitions. Draft-local IDs link new tests to new suites and are
replaced with server UUIDs during Apply.

Tool tests reuse target, arguments, assertions, and timeout. Scenario tests reuse inputs,
steps, cleanup steps, assertions, and failure policy. Steps reuse target, fixed arguments,
mappings, extractors, assertions, condition, polling, and on-failure behavior. Value
sources remain LITERAL, SCENARIO_INPUT, ENVIRONMENT, VARIABLE, and STEP_RESPONSE; step
and variable references may only point backward. Environment values remain references.

Assertion results always distinguish expected and actual. If actual cannot be resolved,
it is absent and a precise path/evaluation error replaces generic scenario failure.

### Step-local QuickJS transform

Scenario steps gain optional backward-compatible `argumentTransform`. It receives fixed
arguments, resolved mapped arguments, scenario inputs, and prior variables, and returns
a bounded JSON object of final Tool arguments. It has no network, filesystem, Node API,
direct environment read/write, or Tool calls. Existing QuickJS CPU, memory, stack, source,
and output limits apply. Source and digest become part of the test revision. A missing
field in old definitions parses as `null`.

Shared Tool before/after scripts remain separate and cannot be changed over Authoring MCP
in 3.0.0.

Suite members reference either a Draft-local test or an existing test plus revision.
They preserve order, member enablement, concurrency, and stop-on-failure.

## 10. Validation, calls, execution, and Apply

### Validation

Validation checks strict shared schemas and limits; project/connection/asset identity;
current Tool hashes and input compatibility; step order and sources; mapping paths;
extractor names; JSONPath; assertions; polling; cleanup; suites; and QuickJS safety.
Issues contain stable code, ERROR/WARNING severity, precise structural location, message,
and related IDs. Validation writes no formal asset and invokes no downstream Tool.

### Tool calls and cleanup

Every downstream invocation uses exact ConnectionRuntime identity and creates a normal
Run. Authoring records store context, purpose, Tool snapshot, Run relation, idempotency,
status, and timestamps without duplicating full request/response traces.

Outcomes are SUCCEEDED, FAILED, UNKNOWN, and BLOCKED. UNKNOWN means Inspector cannot
determine whether an external side effect occurred. Such non-idempotent mutations are
never automatically retried.

Draft mutation calls may link cleanup calls through `cleanupForCallId`. Cancellation or
failure stops future business steps but attempts cleanup whose inputs are available.
Configured cleanup requirements may block validation or Apply. Standalone calls receive
side-effect warnings and remain independent.

### Trial execution

```text
QUEUED → VALIDATING → RUNNING_SETUP → RUNNING_STEPS
       → RUNNING_ASSERTIONS → RUNNING_CLEANUP
       → PASSED | FAILED | ERROR | CANCELLED | INTERRUPTED
```

Execution start returns an ID immediately; get/cancel tools manage it. Only one execution
per Draft is active. The service reuses current runners, assertions, Run creation,
workflow execution, environment resolution, and QuickJS, but stores Draft-level results
separately instead of inventing a formal `testCaseId`. Details include resolved inputs,
sanitized response, expected/actual assertions, extractors, error, duration, and cleanup.

### Atomic Apply

Apply accepts project ID, Draft ID, expected revision, expected validation digest, and
idempotency key. It rechecks state, revision, validation, Tool hashes, project and
connection identity, source revisions, policy, optional execution requirement, and
cleanup policy.

One project SQLite transaction generates formal IDs, creates or revisions all test cases,
resolves suite references, creates or revisions suites/members, records the asset map and
idempotency result, and marks the Draft applied. Failure rolls everything back and leaves
the Draft active. New tests are disabled; existing enablement is preserved; Apply does not
schedule or execute formal assets.

## 11. Storage and module boundaries

### Installation registry

`registry.sqlite` remains separate from every project database and gains migrations:

```text
src/server/registry/migrations/
├── 001_registry_baseline.sql
└── 002_authoring_settings.sql
```

Migration 001 adopts existing `project_registry` with `CREATE TABLE IF NOT EXISTS`.
Migration 002 stores enabled state, Token digest/hint, revision, and timestamps, never the
runtime port. One installation store should own this database connection and expose
project and settings repositories.

### Project migrations

Released migrations 001–020 remain unchanged:

```text
021_authoring_connection_policies.sql
022_authoring_drafts.sql
023_authoring_tool_calls.sql
```

021 stores exact connection policy, lists, cleanup rule, limits, and revision. 022 stores
Drafts, validation attempts, execution attempts, and Apply results. 023 stores standalone
and Draft call identity, purpose, Tool snapshot, Run link, idempotency/request hash,
status, and timestamps. Full traces remain in Run tables. Step transforms live in
revisioned definition JSON and need no data rewrite.

### Services

```text
AuthoringAuthService       enablement, Token verification and rotation
AuthoringPolicyService     connection policy and authorization
AuthoringCatalogService    bounded discovery
AuthoringToolCallService   policy, Schema, idempotency, Run and outcome
AutomationDraftService     Draft CRUD and optimistic concurrency
DraftValidationService     deterministic validation
DraftExecutionService      asynchronous trial execution and recovery
DraftApplyService          preflight and one formal-asset transaction
AuthoringMcpServer         transport, tool registration, error mapping
```

The Draft service does not execute Tools; execution does not save formal assets; Apply
does not trust client-supplied validation claims. Shared Zod/runtime schemas remain the
client/server boundary authority.

## 12. Web UI

Add a persistent `Authoring MCP` navigation page using existing tokens, Phosphor icons,
View Tabs, disclosures, status badges, and keyboard-accessible split pane. Do not add chat
or another design system.

The page shows endpoint/status plus explicit copy/settings actions, and two views:

- Drafts: list and detail with assets, validation, execution, cleanup, and Apply mapping.
- Tool calls: standalone/Draft filters and sanitized call detail with Run/context identity.

Opening a Draft asset reuses existing Tool test, scenario, assertion, and suite editors in
Draft mode. Editor save increments the Draft; explicit formal save performs Apply.

Server editing gains an `Authoring MCP access` disclosure with four described radios.
CUSTOM uses the shared searchable selection pattern. FULL_ACCESS requires a focus-safe
confirmation that names the Server and covers future destructive Tools.

Run history gains sources for manual debug, standalone Authoring, Draft Authoring,
automated tests, suites, and pressure tests. History detail does not load into debug unless
requested.

The Authoring page remains mounted across navigation and preserves selected Draft,
filters, split width, disclosures, scroll, and unsaved editor state. Project change clears
prior-project state and fences late asynchronous results by project, connection,
Draft/execution identity, and request generation.

All visible copy supports `zh-CN` and `en-US`. Focus, Escape, tab semantics, disclosure,
split keyboard control, reduced motion, light/dark themes, long content, and responsive
layout follow `FRONTEND-DEVELOPMENT-STANDARDS.md`.

## 13. Security, redaction, and observability

External AI input, client information, downstream descriptions/schemas/results, generated
QuickJS, cursors, and migrated JSON are untrusted. The main threats are local spoofing,
browser-to-loopback requests, confused-deputy project access, prompt injection, duplicate
mutations, credential disclosure, resource exhaustion, and restart uncertainty.

Authoring uses mandatory redaction independent of ordinary Run redaction preference. It
always masks authorization/proxy authorization, cookies, API-key-like Headers, OAuth and
Bearer values, resolved secret environment values, credential-shaped URL parameters, and
configured sensitive fields. `inspector_get_tool_call` uses this Authoring-safe view.
Ordinary non-secret business data remains available, with explicit truncation metadata.

Downstream prose is bounded structured data, never policy, SQL, script, URL, identity, or
authorization. This reduces but cannot eliminate model prompt-injection risk; connection
policy is the enforcement boundary.

Sanitized logs may contain request/client summary, resource IDs, Tool name, purpose,
status, duration, error code, redaction count, and truncation. They exclude Tokens,
complete arguments/responses, headers/cookies, resolved environment values, QuickJS
secrets, SQL, database paths, and stacks. Security events cover rejected Token/Origin,
policy denial, rate limiting, Token rotation, service enable/disable, and FULL_ACCESS.
Client name is descriptive, not authenticated identity.

## 14. Resource, restart, and packaging requirements

Initial recommended limits are eight MCP sessions, eight global downstream calls, two
calls per connection, one execution and Apply per Draft, 2 MiB requests/Drafts, 1 MiB
structured responses, and 100 list items. Final constants are returned by capabilities
and receive boundary tests. Locks are installation-, connection-, or Draft-scoped rather
than one global project lock.

Startup maps non-terminal Draft execution to INTERRUPTED and calls to UNKNOWN or
INTERRUPTED based on recorded evidence. ACTIVE Drafts remain active. SQLite rolls back
uncommitted Apply. Inspector never repeats an external call merely because it restarted.

Because MCP Server code becomes production runtime, `@modelcontextprotocol/sdk` moves
from `devDependencies` to `dependencies` at a tested pinned version.

## 15. Verification matrix

### Unit and contract

- Token lifecycle and constant-time verification.
- All policies, including future Tools under FULL_ACCESS.
- Project/connection fences and same-URL isolation.
- Draft schemas, revisions, digests, limits, mappings, assertions, polling and suites.
- QuickJS isolation and deterministic arguments.
- Mandatory Authoring redaction.
- Idempotency and stable success/error envelopes.

### Migration

- Legacy registry safely gains migration history without losing projects.
- Migration-020 projects upgrade through all new migrations.
- Fresh and upgraded final schemas match.
- Existing connections, Runs, workflows, environments, tests, suites, reports, and
  pressure tests remain readable and unchanged.

### MCP and downstream integration

- Real Streamable HTTP initialize/list/call/session close.
- Missing, invalid, rotated Token; disablement; Origin; multiple clients; expiry.
- None, Bearer, OAuth, and Header downstream fixtures.
- Same URL with distinct connection credentials.
- Permission modes, Schema drift, success, business failure, connect failure, timeout,
  cancellation, disconnect, UNKNOWN outcome, standalone/Draft calls, cleanup, history.

### UI, E2E, and release

- Settings, one-time Token, permissions, Drafts, executions, Apply, and call detail.
- Editor reuse, navigation state preservation, and project-switch fencing.
- Chinese/English, keyboard, focus, axe, themes, long content, and responsive behavior.
- Default port 8500, CLI/environment precedence, invalid/occupied ports.
- Packaged install starts and completes a real Authoring call.
- Full `npm run verify` before release.

## 16. Delivery slices

1. Runtime/authentication: port, CLI, registry migration, Token, MCP route, capabilities.
2. Discovery/policy: context tools, four modes, Server UI, identity regressions.
3. Standalone calls: invocation, Run linkage, history/detail, load-to-debug, Draft from call.
4. Draft/validation: persistence, Bundle, concurrency, validator, Authoring workspace.
5. Trial execution: async lifecycle, QuickJS transform, cleanup, interruption recovery.
6. Atomic Apply: transaction-aware writer, create/update, suite resolution, idempotency.
7. Hardening/release: abuse tests, redaction, a11y, i18n, docs, E2E, artifact verification.

## 17. Acceptance criteria

- A supported external AI Host connects to the loopback endpoint with one Token and lists
  all fixed Authoring tools.
- Production defaults to 8500; CLI overrides environment/default; occupied ports do not
  silently change.
- FULL_ACCESS permits every current and newly discovered downstream Tool while identity,
  authentication, trace, limits, and redaction remain enforced.
- A Tool can be called without a Draft and recovered from Authoring and ordinary Run
  history.
- External AI can author, validate, trial-run, and atomically save a multi-step scenario
  and suite without direct database access or an Inspector-hosted model.
- Formal assets run deterministically without AI and new tests are disabled.
- Same-URL connections never share credentials.
- Secret fixtures never appear in Authoring output, ordinary logs, Toasts, URLs, default
  exports, or browser storage.
- Revision, digest, idempotency, cancellation, restart, and UNKNOWN tests prevent silent
  overwrite or duplicate mutation.
- Migration-020 projects and legacy registries upgrade without data loss.
- Full verification and packaged-artifact smoke tests pass before release.

## 18. Implementation-plan boundary

This document approves architecture and behavior, not implementation. The detailed plan
must turn each delivery slice into test-first tasks with exact files, focused commands,
migration fixtures, commit boundaries, and the final verification gate. Internal class
names may be refined, but changing a decision in this specification requires an explicit
design amendment.
