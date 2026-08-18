# MCP Tool Debugger Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a locally launched browser application that persists projects in SQLite, connects to unauthenticated Streamable HTTP MCP servers, lists Tools, opens the same Tool in independent tabs, executes `tools/call`, and records inspectable run history.

**Architecture:** A React/Vite client talks only to a loopback Hono server. Hono owns SQLite repositories, MCP sessions, run state, wire observation, and an SSE event stream; narrow feature interfaces let later plans add replay, OAuth, legacy SSE, and sharing without moving existing responsibilities.

**Tech Stack:** Node.js 22+, TypeScript 5.9.3, React 19.1.0, Vite 7.3.2, Hono 4.12.12, `@modelcontextprotocol/client` 2.0.0, Ajv 8.18.0, better-sqlite3 12.10.0, Zod 4.3.6, Vitest 3.2.4, React Testing Library 16.3.2, Playwright 1.59.1.

**Spec:** `docs/superpowers/specs/2026-08-17-mcp-tool-debugger-design.md`

## Global Constraints

- Require Node.js 22 or newer and support macOS and Windows paths.
- Bind only to `127.0.0.1`; never bind to `0.0.0.0`.
- Browser code must not import MCP, SQLite, filesystem, or credential modules.
- This plan supports unauthenticated Streamable HTTP only; do not add STDIO, Resources, Prompts, OAuth, Bearer auth, or legacy SSE.
- Persist business state in one SQLite database per project; do not create a Git-managed project data folder.
- Use UUIDs for externally visible IDs and ISO-8601 UTC timestamps for persisted time.
- Keep network work outside SQLite transactions; enable foreign keys, WAL, and a 5-second busy timeout.
- Treat Tool calls as non-idempotent: never retry `tools/call` automatically.
- Raw JSON edits the complete `arguments` object, not the JSON-RPC envelope.
- Do not execute Tool-returned HTML or scripts.
- Follow TDD for every behavior and commit after each task passes its focused tests.

## Scope Decomposition

The approved specification is split into independently reviewable plans:

1. **This plan — Core debugger:** local bootstrap, SQLite projects, Streamable HTTP, Tool catalog, multi-tab execution, and basic wire history.
2. **History and replay:** saved cases, immutable snapshots, result diff, retention, cancellation recovery, and full detail polish.
3. **Authorization and compatibility:** credential vault, Bearer/OAuth, refresh, observable OAuth, scope step-up, and legacy SSE.
4. **Sharing and hardening:** `.mcpdbg` import/export, migrations/backups/recovery, size enforcement, security fault injection, packaging, and cross-platform acceptance.

This plan is independently useful: a tester can start the app, create a project, connect a real unauthenticated MCP server, open multiple Tool tabs, invoke Tools, and inspect persisted requests, responses, HTTP exchanges, and JSON-RPC frames.

### Specification Coverage in This Plan

- Covered end to end: local browser bootstrap, SQLite-backed projects, saved Streamable HTTP connections, Tool discovery, Schema Form and Raw JSON input, independent same-Tool tabs, Tool execution, formatted/copyable results, persisted runs, and HTTP/JSON-RPC inspection.
- Deliberately deferred: manually saved cases and replay/diff; Bearer/OAuth and legacy SSE; `.mcpdbg` import/export; attachment policy, retention cleanup, backup/recovery, and packaging hardening.
- The deferred work uses the stable seams introduced here (`ProjectStore`, `ConnectionRuntime`, `McpSession`, `RunService`, and persisted immutable snapshots), so later plans extend the core rather than replace it.

## File Structure

```text
bin/dsers-inspector.mjs
src/client/main.tsx
src/client/app/App.tsx
src/client/app/app.css
src/client/api/api-client.ts
src/client/features/projects/ProjectPicker.tsx
src/client/features/connections/ConnectionPanel.tsx
src/client/features/tools/ToolTree.tsx
src/client/features/tabs/DebugWorkspace.tsx
src/client/features/tabs/TabStrip.tsx
src/client/features/tabs/ParameterEditor.tsx
src/client/features/tabs/schema-form.ts
src/client/features/runs/RunResultPanel.tsx
src/client/features/runs/RunHistory.tsx
src/client/features/runs/use-run-events.ts
src/server/main.ts
src/server/app.ts
src/server/config/runtime-config.ts
src/server/security/session-auth.ts
src/server/projects/project-paths.ts
src/server/projects/project-registry.ts
src/server/projects/project-store.ts
src/server/projects/project-service.ts
src/server/projects/routes.ts
src/server/projects/migrations/001_project.sql
src/server/projects/migrations/002_connections.sql
src/server/projects/migrations/003_tools.sql
src/server/projects/migrations/004_tabs.sql
src/server/projects/migrations/005_runs.sql
src/server/connections/connection-types.ts
src/server/connections/connection-repository.ts
src/server/connections/connection-service.ts
src/server/connections/connection-runtime.ts
src/server/connections/streamable-session.ts
src/server/connections/observed-fetch.ts
src/server/connections/dialect-aware-validator.ts
src/server/connections/routes.ts
src/server/tools/tool-types.ts
src/server/tools/tool-repository.ts
src/server/tools/tool-service.ts
src/server/tools/routes.ts
src/server/tabs/tab-repository.ts
src/server/tabs/tab-service.ts
src/server/tabs/routes.ts
src/server/runs/run-types.ts
src/server/runs/run-repository.ts
src/server/runs/run-event-bus.ts
src/server/runs/run-service.ts
src/server/runs/routes.ts
src/shared/api-problem.ts
src/shared/json.ts
src/shared/json-schema.ts
test-support/fake-mcp-session.ts
test-support/streamable-mcp-server.ts
e2e/core-debugger.spec.ts
.gitignore
index.html
package.json
package-lock.json
playwright.config.ts
tsconfig.json
tsconfig.server.json
tsup.config.ts
vite.config.ts
vitest.config.ts
scripts/copy-static.mjs
```

Each file has one responsibility. Feature services depend on repository and runtime interfaces, not concrete sibling internals. Route modules only validate HTTP data and call services.

---

### Task 1: Scaffold the Secure Local App Shell

**Files:**
- Create: `.gitignore`, `package.json`, `package-lock.json`, TypeScript/Vite/Vitest/tsup configs, and `index.html`
- Create: `src/server/config/runtime-config.ts`
- Create: `src/server/security/session-auth.ts`
- Create: `src/server/app.ts`
- Create: `src/server/main.ts`
- Test: `src/server/__tests__/app.test.ts`
- Create: `src/client/main.tsx`, `src/client/app/App.tsx`, `src/client/app/app.css`

**Interfaces:**
- Produces: `RuntimeConfig`, `createRuntimeConfig(overrides?)`, and `createApp(deps)`.
- Produces: authenticated `GET /api/health` returning `{ ok: true, version: string }`.
- Produces: `X-DSers-Inspector-Session` as the only browser API session header.

- [ ] **Step 1: Install pinned dependencies and configure scripts**

Run:

```bash
npm init -y
npm install @hono/node-server@1.19.14 @modelcontextprotocol/client@2.0.0 ajv@8.18.0 ajv-formats@3.0.1 better-sqlite3@12.10.0 hono@4.12.12 open@10.2.0 react@19.1.0 react-dom@19.1.0 zod@4.3.6
npm install --save-dev @modelcontextprotocol/sdk@1.29.0 @playwright/test@1.59.1 @testing-library/jest-dom@6.9.1 @testing-library/react@16.3.2 @testing-library/user-event@14.6.1 @types/better-sqlite3@7.6.13 @types/node@20.19.39 @types/react@19.2.14 @types/react-dom@19.2.3 @vitejs/plugin-react@4.7.0 concurrently@9.1.0 jsdom@27.4.0 tsup@8.3.5 tsx@4.21.0 typescript@5.9.3 vite@7.3.2 vitest@3.2.4
```

Set `type: module`, `engines.node: >=22`, and these scripts:

```json
{
  "dev": "concurrently -k \"npm:dev:server\" \"npm:dev:client\"",
  "dev:server": "tsx watch src/server/main.ts",
  "dev:client": "vite",
  "build": "vite build && tsup && node scripts/copy-static.mjs",
  "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.server.json",
  "test": "vitest run",
  "test:e2e": "playwright test",
  "verify": "npm run typecheck && npm run test && npm run build"
}
```

Ignore `node_modules`, `dist`, Playwright/Vitest outputs, logs, and local environment files. Do not ignore or create project databases inside the repository; runtime data always resolves through the platform data root.

- [ ] **Step 2: Write failing security tests**

```ts
const app = createApp({
  sessionToken: "test-session",
  allowedOrigin: "http://127.0.0.1:5173",
  version: "0.1.0",
});

expect((await app.request("/api/health", {
  headers: { Origin: "http://127.0.0.1:5173" },
})).status).toBe(401);

expect((await app.request("/api/health", { headers: {
  Origin: "https://malicious.example",
  "X-DSers-Inspector-Session": "test-session",
} })).status).toBe(403);

const ok = await app.request("/api/health", { headers: {
  Origin: "http://127.0.0.1:5173",
  "X-DSers-Inspector-Session": "test-session",
} });
expect(await ok.json()).toEqual({ ok: true, version: "0.1.0" });
```

- [ ] **Step 3: Run RED**

Run: `npx vitest run src/server/__tests__/app.test.ts`

Expected: FAIL because `src/server/app.ts` does not exist.

- [ ] **Step 4: Implement the app factory and minimal React shell**

Expose:

```ts
export interface AppDependencies {
  sessionToken: string;
  allowedOrigin: string;
  version: string;
}

export function createApp(deps: AppDependencies): Hono;
```

Use constant-time token comparison when lengths match. Return 401 for missing/invalid tokens and 403 for foreign Origins. The client reads `session` from the initial query string, stores it in `sessionStorage`, removes it with `history.replaceState`, calls `/api/health`, and displays `DSers MCP Inspector` plus health state. `scripts/copy-static.mjs` recursively copies `src/server/projects/migrations` into `dist/server/projects/migrations` when the source directory exists, so production resolves SQL relative to `import.meta.url`.

During development Vite listens only on `127.0.0.1:5173` and proxies `/api` to the loopback Hono port. The production server serves the built client itself, so the browser never needs a second origin or direct access to SQLite/MCP internals.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/server/__tests__/app.test.ts
npm run typecheck
npm run build
git add .gitignore package.json package-lock.json tsconfig*.json vite.config.ts vitest.config.ts tsup.config.ts index.html scripts/copy-static.mjs src/client src/server
git commit -m "feat: scaffold secure local inspector shell"
```

---

### Task 2: Add SQLite Project Creation and Opening

**Files:**
- Create: `src/server/projects/project-paths.ts`, `project-registry.ts`, `project-store.ts`, `project-service.ts`, `routes.ts`
- Create: `src/server/projects/migrations/001_project.sql`
- Test: `src/server/projects/__tests__/project-service.test.ts`
- Modify: `src/server/app.ts`
- Create: `src/client/api/api-client.ts`
- Create: `src/client/features/projects/ProjectPicker.tsx`
- Modify: `src/client/app/App.tsx`

**Interfaces:**
- Consumes: secure Hono app from Task 1.
- Produces: `ProjectService.create/list/open`, `ProjectStore`, and project CRUD APIs.

- [ ] **Step 1: Write the failing lifecycle test**

```ts
const service = createProjectService({ dataRoot });
const created = service.create("Supplier Tools");
expect(service.list()).toEqual([expect.objectContaining({
  id: created.id,
  name: "Supplier Tools",
})]);
const store = service.open(created.id);
expect(store.database.pragma("journal_mode", { simple: true })).toBe("wal");
expect(store.getProject().id).toBe(created.id);
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/server/projects/__tests__/project-service.test.ts`

Expected: FAIL because `createProjectService` is missing.

- [ ] **Step 3: Create exact registry and project schemas**

`registry.sqlite` owns `project_registry(id, name, database_path, created_at, updated_at, last_opened_at)`. Project databases live at `<dataRoot>/projects/<projectId>/project.sqlite`.

Create `001_project.sql`:

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days >= 0),
  retention_count INTEGER NOT NULL DEFAULT 10000 CHECK (retention_count >= 0)
);
```

Before discovering migration files, `ProjectStore` bootstraps `schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`. Resolve numbered `.sql` files relative to `import.meta.url`, sort by numeric prefix, reject duplicate/out-of-order versions, and apply each pending file plus its version insert in one SQLite transaction. Never edit an applied migration; add the next numbered file.

Every opened database executes:

```ts
database.pragma("foreign_keys = ON");
database.pragma("journal_mode = WAL");
database.pragma("busy_timeout = 5000");
```

Resolve the default data root to `~/Library/Application Support/DSers MCP Inspector` on macOS and `%APPDATA%/DSers MCP Inspector` on Windows; tests inject a temporary root. Cache exactly one open `ProjectStore` per project ID so every repository for that project shares the same configured database handle. `ProjectService.close()` closes every cached store before closing the registry.

- [ ] **Step 4: Implement service, routes, and picker**

Use:

```ts
export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}
export interface ProjectService {
  create(name: string): ProjectSummary;
  list(): ProjectSummary[];
  open(projectId: string): ProjectStore;
  close(): void;
}
```

Implement `GET /api/projects`, `POST /api/projects`, and `POST /api/projects/:projectId/open`. Validate names with `z.string().trim().min(1).max(120)`. The picker lists, creates, and opens projects; it never asks for a filesystem project path. On browser startup, automatically open the most recently opened project when one has a non-null `lastOpenedAt`; otherwise show the picker.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/server/projects src/client/features/projects
npm run typecheck
git add src/server/projects src/server/app.ts src/client/api src/client/features/projects src/client/app/App.tsx
git commit -m "feat: persist local SQLite projects"
```

---

### Task 3: Persist Connection Configurations Without Connecting

**Files:**
- Create: `src/server/projects/migrations/002_connections.sql`
- Create: `src/server/connections/connection-types.ts`, `connection-repository.ts`, `connection-service.ts`, `routes.ts`
- Test: `src/server/connections/__tests__/connection-service.test.ts`
- Modify: `src/server/app.ts`
- Create: `src/client/features/connections/ConnectionPanel.tsx`
- Test: `src/client/features/connections/__tests__/ConnectionPanel.test.tsx`
- Modify: `src/client/app/App.tsx`

**Interfaces:**
- Consumes: `ProjectService.open(projectId)`.
- Produces: persisted `ConnectionRecord`, `ConnectionService`, and connection CRUD APIs.

- [ ] **Step 1: Write failing validation/persistence tests**

```ts
const connection = service.create(projectId, {
  name: "Catalog MCP",
  url: "https://mcp.example.test/mcp",
  transport: "streamable-http",
  timeoutMs: 10_000,
});
expect(service.list(projectId)).toEqual([connection]);
expect(connection.status).toBe("disconnected");

expect(() => service.create(projectId, {
  name: "Local process",
  url: "file:///tmp/server",
  transport: "streamable-http",
  timeoutMs: 10_000,
})).toThrow(/http or https/i);
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/server/connections/__tests__/connection-service.test.ts`

Expected: FAIL because the connection module is missing.

- [ ] **Step 3: Add the connection migration**

```sql
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  url TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('streamable-http', 'sse')),
  auth_mode TEXT NOT NULL CHECK (auth_mode IN ('none', 'bearer', 'oauth')),
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 100 AND 600000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_protocol_version TEXT,
  last_server_info_json TEXT,
  last_error_json TEXT
);
CREATE INDEX connections_project_id_idx ON connections(project_id);
```

The API accepts only `transport: streamable-http` and `authMode: none` in this plan. Broader database values prevent destructive migrations when later plans enable them.

- [ ] **Step 4: Implement stable CRUD types and UI**

```ts
export interface ConnectionRecord {
  id: string;
  projectId: string;
  name: string;
  url: string;
  transport: "streamable-http";
  authMode: "none";
  timeoutMs: number;
  status: "disconnected" | "connecting" | "connected" | "failed";
  lastProtocolVersion: string | null;
  lastServerInfo: Record<string, unknown> | null;
  lastError: { code: string; message: string } | null;
}
```

The panel provides name, URL, and timeout, shows Streamable HTTP as fixed, saves without network access, lists records, and deletes after confirmation. Saving must display `disconnected`, not imply success connecting.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/server/connections src/client/features/connections
npm run typecheck
git add src/server/projects/migrations/002_connections.sql src/server/connections src/server/app.ts src/client/features/connections src/client/app/App.tsx
git commit -m "feat: manage MCP connection configurations"
```

---

### Task 4: Connect a Real Streamable HTTP MCP Session

**Files:**
- Create: `src/server/connections/connection-runtime.ts`, `streamable-session.ts`, `observed-fetch.ts`, `dialect-aware-validator.ts`
- Test: `src/server/connections/__tests__/connection-runtime.test.ts`
- Create: `test-support/fake-mcp-session.ts`, `test-support/streamable-mcp-server.ts`
- Modify: `src/server/connections/connection-service.ts`, `routes.ts`

**Interfaces:**
- Consumes: `ConnectionRecord`.
- Produces: `McpSession`, `McpSessionFactory`, `ConnectionRuntime.connect/get/callTool/disconnect`, and `WireObservation`.
- Produces: connect/disconnect APIs.

- [ ] **Step 1: Define the seam and write failing concurrency tests**

```ts
export interface McpSession {
  readonly protocolVersion: string;
  readonly serverInfo: { name: string; version: string } | null;
  listTools(input?: { cursor?: string }): Promise<{
    tools: Tool[];
    nextCursor?: string;
  }>;
  callTool(input: {
    name: string;
    arguments: Record<string, unknown>;
    signal?: AbortSignal;
    observe?: (event: WireObservation) => void;
  }): Promise<CallToolResult>;
  close(): Promise<void>;
}
export type McpSessionFactory = (
  connection: ConnectionRecord,
  observe: (event: WireObservation) => void,
) => Promise<McpSession>;

export interface ConnectionRuntime {
  connect(connectionId: string): Promise<McpSession>;
  get(connectionId: string): McpSession | undefined;
  callTool(
    connectionId: string,
    input: Parameters<McpSession["callTool"]>[0],
  ): Promise<CallToolResult>;
  disconnect(connectionId: string): Promise<void>;
}
```

Test that two simultaneous `connect(id)` calls invoke the factory once and return the same session, a rejected factory leaves status `failed`, and disconnect closes/removes the session. Also issue two concurrent `callTool` operations on the shared session with different observers and assert each observer receives only its own request/response/RPC events. Prove a configured timeout aborts one call without closing the shared session. Cover absent/2020-12, explicit draft-07, and unknown JSON Schema dialect dispatch.

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/server/connections/__tests__/connection-runtime.test.ts`

Expected: FAIL because `ConnectionRuntime` is missing.

- [ ] **Step 3: Implement the official client adapter and observation seam**

```ts
const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
  fetch: createObservedFetch(globalThis.fetch, observe),
});
const client = new Client(
  { name: "dsers-mcp-inspector", version: APP_VERSION },
  {
    capabilities: {},
    jsonSchemaValidator: new DialectAwareJsonSchemaValidator(),
  },
);
await client.connect(transport, { timeout: connection.timeoutMs });
```

Import `Tool` and `CallToolResult` from `@modelcontextprotocol/client`, plus `AsyncLocalStorage` from `node:async_hooks`. Implement `DialectAwareJsonSchemaValidator` with `AjvJsonSchemaValidator`, draft-07 `Ajv`, and `Ajv2020`, registering `ajv-formats` on both engines; dispatch on a normalized `$schema`, default an absent dialect to 2020-12, and warn/accept for an unknown dialect so an inspector never hides a legal server response it cannot validate. Adapt `client.listTools({ cursor })` and call `client.callTool({ name, arguments }, { signal })`. Combine the caller signal and `AbortSignal.timeout(connection.timeoutMs)` with `AbortSignal.any`; classify timeout separately and never close the shared connection merely because one call aborts. Run each call inside an `AsyncLocalStorage<(event: WireObservation) => void>` context carrying `input.observe`; `createObservedFetch` reads the active call observer and falls back to the factory's connection-level observer. Never swap a mutable observer on the shared session, because concurrent tabs must remain isolated. Close partial clients on connection failure. Do not retry.

On connect success, persist negotiated protocol/server info and clear the last error; on failure, persist a normalized code/message and discard the partial session. Runtime status is in memory, so every saved connection correctly starts as `disconnected` after an application restart.

Emit:

```ts
export type WireObservation =
  | { kind: "http-request"; at: string; method: string; url: string; headers: Record<string, string>; body: unknown }
  | { kind: "http-response"; at: string; status: number; headers: Record<string, string>; body: unknown }
  | { kind: "rpc-out" | "rpc-in"; at: string; message: unknown };
```

Clone bodies without consuming originals. Parse `application/json` bodies into RPC events. For `text/event-stream`, return the original response immediately while an independently caught asynchronous parser consumes the cloned body. Follow SSE framing exactly: normalize CRLF, accumulate all `data:` lines until the blank event boundary, join them with newlines, and emit one `rpc-in` event for each valid JSON-RPC value. Preserve unparseable bodies as bounded text metadata, and redact authorization/cookie headers even though auth is not enabled yet.

- [ ] **Step 4: Add a genuine loopback fixture and integration test**

Use `McpServer` and `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`. Register deterministic `echo(message)` and `sum(a,b,delayMs?)` Tools; the optional delay exists only to force out-of-order test completion. Bind to `127.0.0.1` on an ephemeral port and return `{ url, stop }`.

Integration test: connect, list both Tools, call `sum` with `{ a: 2, b: 3 }`, assert `structuredContent.total === 5`, and assert at least one outgoing and incoming RPC observation.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/server/connections test-support
npm run typecheck
git add src/server/connections test-support
git commit -m "feat: connect Streamable HTTP MCP servers"
```

### Task 5: Persist and Display the Tool Catalog

**Files:**
- Create: `src/server/projects/migrations/003_tools.sql`
- Create: `src/server/tools/tool-types.ts`, `tool-repository.ts`, `tool-service.ts`, `routes.ts`
- Test: `src/server/tools/__tests__/tool-service.test.ts`
- Modify: `src/server/app.ts`
- Create: `src/client/features/tools/ToolTree.tsx`
- Test: `src/client/features/tools/__tests__/ToolTree.test.tsx`
- Modify: `src/client/app/App.tsx`

**Interfaces:**
- Consumes: `ConnectionRuntime.get(connectionId)`.
- Produces: `ToolService.refresh/list/get`, immutable `ToolSnapshot`, and Tool selection events.

- [ ] **Step 1: Write failing snapshot/drift tests**

Refresh identical definitions twice and assert one snapshot per Tool hash. Change `sum.inputSchema` and assert a new snapshot plus `status: changed`. Omit `echo` from a later refresh and assert `status: removed` without deleting its snapshots.

```ts
expect(service.list(projectId, connectionId)).toContainEqual(
  expect.objectContaining({
    name: "sum",
    status: "changed",
    currentSnapshot: expect.objectContaining({
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }),
  }),
);
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/server/tools/__tests__/tool-service.test.ts`

Expected: FAIL because Tool service is missing.

- [ ] **Step 3: Add Tool tables**

Create `003_tools.sql`:

```sql
CREATE TABLE tool_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(connection_id, tool_name, content_hash)
);
CREATE TABLE tools (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  current_snapshot_id TEXT NOT NULL REFERENCES tool_snapshots(id),
  status TEXT NOT NULL CHECK (status IN ('current', 'changed', 'removed')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(connection_id, name)
);
```

- [ ] **Step 4: Implement hashing, catalog APIs, and Tool tree**

Canonicalize object keys recursively, preserve array order, then compute SHA-256. Preserve the full definition including Input/Output Schema, annotations, and `_meta`. Drain `tools/list` pagination until `nextCursor` is absent, reject a repeated cursor, and fail after 1,000 pages.

Routes:

- `POST .../tools/refresh`: call `tools/list`, persist, return catalog.
- `GET .../tools`: read current catalog without network access.
- `GET .../tools/:toolName`: return current definition and snapshots.

After a successful connect, the UI performs one explicit refresh and reports refresh failure without disconnecting a healthy session. The Tool tree also exposes a manual refresh action, groups by connection, searches name/description case-insensitively, displays drift status, selects on click, and requests a new Tab on double-click.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/server/tools src/client/features/tools
npm run typecheck
git add src/server/projects/migrations/003_tools.sql src/server/tools src/server/app.ts src/client/features/tools src/client/app/App.tsx
git commit -m "feat: persist and browse MCP tools"
```

---

### Task 6: Add Persisted Independent Debug Tabs and Argument Editors

**Files:**
- Create: `src/server/projects/migrations/004_tabs.sql`
- Create: `src/server/tabs/tab-repository.ts`, `tab-service.ts`, `routes.ts`
- Test: `src/server/tabs/__tests__/tab-service.test.ts`
- Modify: `src/server/app.ts`
- Create: `src/shared/json.ts`, `src/shared/json-schema.ts`
- Create: `src/client/features/tabs/schema-form.ts`, `TabStrip.tsx`, `ParameterEditor.tsx`, `DebugWorkspace.tsx`
- Test: `src/shared/__tests__/json-schema.test.ts`, `src/client/features/tabs/__tests__/schema-form.test.ts`, `DebugWorkspace.test.tsx`
- Modify: `src/client/app/App.tsx`

**Interfaces:**
- Consumes: current Tool snapshots.
- Produces: `DebugTab`, Tab CRUD/reorder APIs, and isolated `arguments` drafts consumed by Runs.

- [ ] **Step 1: Write failing same-Tool isolation tests**

```ts
const first = service.open({ projectId, connectionId, toolName: "sum" });
const second = service.open({ projectId, connectionId, toolName: "sum" });
expect(first.id).not.toBe(second.id);
expect(first.title).toBe("sum");
expect(second.title).toBe("sum (2)");
service.updateDraft(first.id, { arguments: { a: 1, b: 2 }, inputMode: "form" });
service.updateDraft(second.id, { arguments: { a: 10, b: 20 }, inputMode: "raw" });
expect(service.get(first.id).arguments).toEqual({ a: 1, b: 2 });
expect(service.get(second.id).arguments).toEqual({ a: 10, b: 20 });
```

The component test renders two `sum` tabs, edits each, switches between them, unmounts/remounts from the API fixture, and proves isolation survives.

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/server/tabs src/client/features/tabs`

Expected: FAIL because Tab modules are missing.

- [ ] **Step 3: Complete the tab migration**

Create `004_tabs.sql`:

```sql
CREATE TABLE debug_tabs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  input_mode TEXT NOT NULL CHECK (input_mode IN ('form', 'raw')),
  arguments_json TEXT NOT NULL DEFAULT '{}',
  raw_text TEXT NOT NULL DEFAULT '{}',
  view_state_json TEXT NOT NULL DEFAULT '{}',
  last_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX debug_tabs_project_position_idx
  ON debug_tabs(project_id, position);
```

Migration tests apply versions 1–4 to an empty DB, refuse duplicate application, and verify foreign keys.

- [ ] **Step 4: Implement Tab service and routes**

```ts
export interface DebugTab {
  id: string;
  projectId: string;
  connectionId: string;
  toolName: string;
  title: string;
  position: number;
  pinned: boolean;
  inputMode: "form" | "raw";
  arguments: Record<string, unknown>;
  rawText: string;
  viewState: {
    editorScrollTop: number;
    resultScrollTop: number;
    splitRatio: number;
  };
  lastRunId: string | null;
}
```

Provide list, open, update draft/view state, reorder, duplicate, pin/unpin, close, close others, and close right. Bulk-close operations preserve pinned Tabs. Title numbering chooses the lowest free suffix. Validate the referenced project, connection, and Tool server-side.

- [ ] **Step 5: Implement Form/Raw conversion**

```ts
export function parseRawArguments(text: string):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string; offset: number | null };
export function formatRawArguments(value: Record<string, unknown>): string;
export function fieldsFromSchema(
  schema: Record<string, unknown>,
  value: Record<string, unknown>,
): SchemaField[];
export function validateArguments(
  schema: Record<string, unknown>,
  value: Record<string, unknown>,
): Array<{ path: string; keyword: string; message: string }>;
```

Support top-level string, number, integer, boolean, enum, array, and object properties. Arrays/objects use nested JSON inputs. Show descriptions, required markers, defaults, and numeric/string constraints without silently inserting defaults. For `$ref`, composition, conditional, tuple, or another unsupported form construct, fall back to a lossless JSON subtree editor while still validating the complete value with Ajv. Preserve unknown keys and show them as “additional arguments” in Form mode rather than deleting them.

Use draft-07/2020-12 Ajv dispatch in `src/shared/json-schema.ts`. Convert Ajv `instancePath` plus `required.missingProperty` into stable JSON Pointer paths. Form controls display issues at the matching field; Raw mode displays syntax offsets or schema issues and cannot execute until both are clean. Unknown dialects produce a non-blocking warning consistent with the MCP client adapter.

Form edits immediately regenerate formatted Raw text. A valid Raw edit updates the canonical arguments/Form model on blur, mode switch, save, and execute. Invalid Raw text remains preserved in that Tab, leaves the last valid canonical arguments untouched, and blocks switching to Form until corrected; no mode change may discard user text.

- [ ] **Step 6: Build the Apifox-style workspace**

Implement the Tab strip, `调试 / Tool 定义 / 当前 Tab 历史` navigation, resizable request/result areas, `Form / Raw JSON`, Copy Arguments, dirty/running markers, duplicate/pin/close/close-others/close-right actions, and `Ctrl/Cmd+Enter`. Restore per-Tab split and scroll positions. The Tool definition view shows description, annotations, Input/Output Schema as tree and Raw JSON, current hash/time, and historical snapshots. Debounce draft/view-state persistence by 300 ms and flush before execute or project change.

- [ ] **Step 7: Verify and commit**

```bash
npx vitest run src/server/tabs src/shared src/client/features/tabs
npm run typecheck
git add src/server/projects/migrations/004_tabs.sql src/server/tabs src/server/app.ts src/shared src/client/features/tabs src/client/app/App.tsx
git commit -m "feat: add independent persisted tool tabs"
```

---

### Task 7: Execute Tools and Persist Runs with Wire Events

**Files:**
- Create: `src/server/projects/migrations/005_runs.sql`
- Create: `src/server/runs/run-types.ts`, `run-repository.ts`, `run-event-bus.ts`, `run-service.ts`, `routes.ts`
- Test: `src/server/runs/__tests__/run-service.test.ts`
- Modify: `src/server/connections/connection-runtime.ts`, `observed-fetch.ts`
- Modify: `src/server/tabs/tab-service.ts`, `src/server/app.ts`

**Interfaces:**
- Consumes: `McpSession.callTool`, scoped `WireObservation`, `DebugTab`, Tool snapshot, and `validateArguments`.
- Produces: `RunService.start/cancel/list/get`, `RunDetail`, Run REST APIs, and per-Run SSE events.

- [ ] **Step 1: Write failing state/idempotency/isolation tests**

```ts
const first = service.start({
  projectId, tabId: tabA, idempotencyKey: "submit-a",
  arguments: { a: 1, b: 2 },
});
const duplicate = service.start({
  projectId, tabId: tabA, idempotencyKey: "submit-a",
  arguments: { a: 1, b: 2 },
});
expect(duplicate.id).toBe(first.id);
expect(() => service.start({
  projectId, tabId: tabB, idempotencyKey: "submit-a",
  arguments: { a: 99, b: 1 },
})).toThrow(/idempotency conflict/i);
const second = service.start({
  projectId, tabId: tabB, idempotencyKey: "submit-b",
  arguments: { a: 10, b: 20 },
});
expect(second.id).not.toBe(first.id);
```

Resolve the second fake call first and assert both responses/events stay isolated. Repeat with eight simultaneous calls resolved in shuffled order. Cover `queued → connecting → running → succeeded`, `failed`, and `cancelled`.

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/server/runs/__tests__/run-service.test.ts`

Expected: FAIL because Run modules are missing.

- [ ] **Step 3: Add run tables**

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  tab_id TEXT REFERENCES debug_tabs(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  tool_snapshot_id TEXT NOT NULL REFERENCES tool_snapshots(id),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'queued','connecting','authorizing','running','succeeded','failed','cancelled','interrupted'
  )),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  network_duration_ms INTEGER,
  protocol_version TEXT,
  server_info_json TEXT,
  client_info_json TEXT NOT NULL,
  UNIQUE(project_id, idempotency_key)
);
CREATE TABLE run_requests (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  arguments_json TEXT NOT NULL,
  jsonrpc_json TEXT NOT NULL,
  http_json TEXT
);
CREATE TABLE run_responses (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  result_json TEXT,
  error_json TEXT,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  original_bytes INTEGER
);
CREATE TABLE run_events (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(run_id, sequence)
);
CREATE INDEX runs_project_created_idx ON runs(project_id, created_at DESC);
```

- [ ] **Step 4: Implement Run state machine and repository**

```ts
export interface StartRunInput {
  projectId: string;
  tabId: string;
  idempotencyKey: string;
  arguments: Record<string, unknown>;
}
export interface RunService {
  start(input: StartRunInput): RunSummary;
  cancel(projectId: string, runId: string): boolean;
  list(projectId: string, cursor?: string): RunPage;
  get(projectId: string, runId: string): RunDetail;
}
```

`start` resolves Tool/connection from the Tab server-side, validates `arguments` against that immutable Tool snapshot, returns 422 with pointer-addressed issues when invalid, then inserts queued request data and schedules execution. A repeated idempotency key returns the existing Run only when project, Tab, Tool snapshot, and canonical arguments match; otherwise return 409. Store the full read-only JSON-RPC preview and client identity immediately; snapshot negotiated protocol/server identity when the call reaches `running`. Derive network duration from the matching call HTTP exchange. If disconnected, transition through `connecting` using the shared in-flight connection promise; otherwise transition directly to `running`. Never hold a transaction while awaiting MCP.

Keep one `AbortController` per active Run and perform terminal transitions with a compare-and-set so cancellation and a late response cannot both win. A resolved `CallToolResult` with `isError: true` is `failed` but remains available as a Tool result; a rejected call stores a normalized error; an abort is `cancelled`; all other resolved calls are `succeeded`. Every terminal transition stores `completedAt` and duration exactly once, updates the originating Tab's `lastRunId`, and removes the controller.

- [ ] **Step 5: Scope observations and expose REST/SSE**

Use:

```ts
runtime.callTool(connectionId, {
  name: tab.toolName,
  arguments: input.arguments,
  signal,
  observe: (event) => runEvents.append(runId, event),
});
```

Only traffic inside scoped `callTool` belongs to the Run; initialize traffic remains connection-level. Allocate each Run's next sequence and insert the event in one synchronous SQLite transaction, then publish live only after commit.

Routes:

- `POST /api/projects/:projectId/runs` → 202.
- `POST .../runs/:runId/cancel` → 202 or 409 when terminal.
- `GET .../runs` and `GET .../runs/:runId`.
- `GET .../runs/:runId/events?after=<sequence>` → SSE.

SSE IDs are decimal sequence values, heartbeat every 15 seconds, and subscriptions close on abort. Reconnect reads missing persisted events for that Run before subscribing live, so cursors from concurrent Runs can never mask each other.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run src/server/runs src/server/connections
npm run typecheck
git add src/server/projects/migrations/005_runs.sql src/server/runs src/server/connections src/server/tabs/tab-service.ts src/server/app.ts
git commit -m "feat: execute tools with persisted run traces"
```

---

### Task 8: Render Results, History, and Protocol Details

**Files:**
- Create: `src/client/features/runs/use-run-events.ts`, `RunResultPanel.tsx`, `RunHistory.tsx`
- Test: `src/client/features/runs/__tests__/RunResultPanel.test.tsx`, `RunHistory.test.tsx`
- Modify: `src/client/features/tabs/DebugWorkspace.tsx`, `ParameterEditor.tsx`
- Modify: `src/client/app/App.tsx`, `app.css`

**Interfaces:**
- Consumes: Run REST/SSE and Tab execute callback.
- Produces: live execution, formatted/Raw/RPC/HTTP/timeline views, project history, and per-Tab history.

- [ ] **Step 1: Write failing safe-render/history tests**

```ts
render(<RunResultPanel run={runWithTextStructuredAndHtmlResource} />);
expect(screen.getByText("5")).toBeInTheDocument();
await user.click(screen.getByRole("tab", { name: "Raw" }));
expect(screen.getByText(/structuredContent/)).toBeInTheDocument();
expect(document.querySelector("script")).toBeNull();
```

Also prove RPC excludes HTTP-only rows, HTTP shows status and redacted headers, history is newest-first, and a deleted originating Tab opens a read-only result Tab.

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/client/features/runs`

Expected: FAIL because Run UI is missing.

- [ ] **Step 3: Implement authenticated run-event streaming**

Use `fetch` streaming rather than native `EventSource`, because the session header is required. Track the last cursor, reconnect UI streaming with bounded backoff, refetch active Run details before applying live events, and stop on project change/unmount. This reconnects observation only; it never resends a Tool call.

- [ ] **Step 4: Implement result and trace views**

- `格式化结果`: escaped text, structured JSON, and content blocks in server order. Render only base64 `image/png`, `image/jpeg`, `image/gif`, and `image/webp` as Blob URL thumbnails; revoke URLs on replacement/unmount. Show metadata plus raw-copy actions for SVG, unknown MIME types, audio, binary, and unsupported blocks. Render embedded text resources as escaped text and never fetch a returned URI.
- `Raw`: complete JSON plus Copy All.
- `RPC`: `rpc-out` and `rpc-in` only, with per-frame copy.
- `HTTP`: method, URL, status, redacted headers, body, and per-exchange copy.
- `时间线`: every event ordered by sequence with relative time.

The detail header shows Run ID, status, total/network duration, timestamps, Tool snapshot hash, negotiated protocol, server identity, and Inspector client identity so a successful call is reproducible without consulting mutable connection metadata.

Every block and JSON subtree has Copy, and the whole result has Copy All. Escape HTML/unknown MIME source. Never use `innerHTML` or a same-origin iframe.

- [ ] **Step 5: Wire Execute and both history views**

Flush the active draft, validate Raw JSON, generate `crypto.randomUUID()` as idempotency key, then POST. Mark only that Tab running. `Ctrl/Cmd+Enter` uses the same path. Add global history and `当前 Tab 历史`, status/duration chips, copy actions, and reload restoration through `lastRunId`.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run src/client/features/runs src/client/features/tabs
npm run typecheck
git add src/client/features/runs src/client/features/tabs src/client/app
git commit -m "feat: inspect tool results and run history"
```

---

### Task 9: Ship the One-Command Core and Prove the Vertical Slice

**Files:**
- Create: `bin/dsers-inspector.mjs`, `playwright.config.ts`, `e2e/core-debugger.spec.ts`
- Test: `src/server/__tests__/main.test.ts`
- Modify: `src/server/main.ts`, `src/server/app.ts`, `package.json`
- Create: `README.md`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces: npm bin, production static serving, graceful shutdown, and E2E acceptance.

- [ ] **Step 1: Write failing bootstrap tests**

```ts
const opened: string[] = [];
const runtime = await startInspector({
  host: "127.0.0.1",
  port: 0,
  dataRoot,
  openBrowser: async (url) => { opened.push(url); },
});
expect(runtime.address.host).toBe("127.0.0.1");
expect(new URL(opened[0]).searchParams.get("session"))
  .toMatch(/^[A-Za-z0-9_-]{43}$/);
await runtime.close();
await expect(startInspector({ ...options, host: "0.0.0.0" }))
  .rejects.toThrow(/loopback/i);
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/server/__tests__/main.test.ts`

Expected: FAIL because `startInspector` is missing.

- [ ] **Step 3: Implement production startup and bin**

`startInspector` requires `127.0.0.1`, generates `randomBytes(32).toString("base64url")`, serves `dist/client` with SPA fallback, assembles all services, and closes MCP sessions, project DBs, registry DB, and HTTP on SIGINT/SIGTERM. Open `http://127.0.0.1:<port>/?session=<token>` only after listening.

Set:

```json
{
  "name": "dsers-mcp-inspector",
  "version": "0.1.0",
  "bin": { "dsers-inspector": "bin/dsers-inspector.mjs" },
  "files": ["bin", "dist", "README.md"],
  "scripts": {
    "start": "node bin/dsers-inspector.mjs",
    "verify": "npm run typecheck && npm run test && npm run build && npm run test:e2e"
  }
}
```

The bin imports `dist/server/main.js`, reports the local URL, and never logs the session token on failure.

- [ ] **Step 4: Write the Playwright vertical slice**

The E2E test must:

1. Start the loopback MCP fixture and Inspector with isolated data.
2. Create `Core E2E`, save/connect the fixture, and see `echo`/`sum`.
3. Open `sum` eight times and assert every Tab has a distinct title and draft.
4. Alternate Form and Raw input across the Tabs; assign unique operands and reverse-order `delayMs` values.
5. Start all eight calls without waiting for earlier calls to finish, then assert each expected total stays with its originating Tab as responses complete out of order.
6. Assert every Tab's RPC view contains its own `tools/call`, HTTP shows 200, and no neighboring arguments/result appear.
7. Reload and assert all eight Tabs, modes, drafts, and results restore.
8. Assert project history contains eight succeeded Runs with distinct IDs and the UI remains interactive.

- [ ] **Step 5: Document only delivered capabilities**

README documents Node.js 22+, `npm install && npm run build && npm start`, `npm run dev`, `npm run verify`, loopback-only security, and current scope “unauthenticated Streamable HTTP Tools”. Do not claim OAuth, SSE, replay, saved cases, or import/export.

- [ ] **Step 6: Run the completion gate and commit**

```bash
npm run verify
npm pack --dry-run
git add bin e2e playwright.config.ts src/server README.md package.json package-lock.json
git commit -m "feat: ship core MCP tool debugger vertical slice"
```

Expected: every command exits 0; package contains only `bin`, `dist`, `README.md`, and package metadata; no listener remains.

## Plan Completion Gate

Before declaring this plan complete, verify with command output that:

- `npm run verify` passes.
- A real Streamable HTTP fixture completes initialize, tools/list, and tools/call.
- Eight same-Tool Tabs preserve independent arguments/results across out-of-order completion and reload.
- Every call has one request, one terminal response/error, and ordered wire events.
- The service refuses non-loopback binding, missing tokens, and foreign Origins.
- README claims only capabilities delivered by this plan.

After this gate, write the History and Replay implementation plan against the code that now exists. Its file boundaries must follow the exercised repositories and UI seams rather than guesses made before core implementation.
