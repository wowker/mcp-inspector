# Task 4 report — real Streamable HTTP MCP runtime

## Outcome

Implemented a project-scoped, unauthenticated Streamable HTTP MCP runtime using the installed official client and SDK APIs. Connections now initialize against real MCP servers, persist negotiated metadata, expose authenticated connect/disconnect actions, share one session per saved connection, and keep concurrent Tool-call observations isolated.

## Delivered

- Added the `McpSession`, `McpSessionFactory`, `ConnectionRuntime`, and `WireObservation` seams.
- Coalesced concurrent connects, allowed explicit retry after failure, and made connect/disconnect races deterministic.
- Classified caller cancellation separately from configured timeout without closing or retrying the shared session.
- Closed partial clients, invalidated sessions, and sessions whose negotiated metadata could not be persisted.
- Added a real `Client` + `StreamableHTTPClientTransport` adapter with per-call `AsyncLocalStorage` observers.
- Added bounded (64 KiB) HTTP/RPC observation, case-insensitive secret-header redaction, JSON parsing, and live CRLF/multiline SSE framing.
- Added 2020-12/default and draft-07 AJV validation with formats; unknown dialects warn and accept.
- Persisted protocol version/server info on success and a fixed bounded error on failure; runtime status remains memory-only.
- Added authenticated, project-owned connect/disconnect routes with stable non-secret error responses.
- Added an official SDK loopback fixture on IPv4 `127.0.0.1` with an ephemeral port and deterministic `echo`/`sum` Tools.

## Security and concurrency rulings

- The saved MCP URL remains intentionally user-controlled because this is a local debugger; no generic proxy route was added.
- Runtime instances are scoped per project, so identical connection UUIDs in different project databases cannot share sessions.
- Session bootstrap headers are never forwarded. Authorization, proxy-authorization, cookie, and set-cookie observations are redacted.
- Remote failures and storage failures are normalized at the API boundary; raw remote messages and stacks are not returned.
- Network work occurs outside SQLite transactions. Persistence happens only after negotiation and before publishing the session as connected.
- Observation callbacks cannot alter the underlying transport if they throw.

## Verification

- Focused: `npx vitest run src/server/connections test-support` — 44 tests passed.
- Full: `npm test` — 116 tests passed across 15 files.
- `npm run typecheck` — passed.
- `npm run build` — passed (Vite client and Node 22 tsup server bundle).
- `git diff --check` — passed.
- The real loopback test completed cleanly without open-handle warnings.

All Node/npm/npx commands used the mandated bundled Node v24.19.0 PATH. No external network was used.

## Review fixes

- Replaced the SDK `callTool()` helper with the official low-level `request()` and `CallToolResult` schema, preserving timeout/cancellation while guaranteeing a single `tools/call` send even for `HEADER_MISMATCH`.
- Changed request, response, and SSE observation to clone-stream reads capped at 64 KiB of UTF-8 bytes. Metadata records `capturedBytes` and `truncated`, clone readers are cancelled at the cap, parser failures are contained, and the preserved Request stream branch is forwarded to the underlying fetch.
- Made outbound request/RPC observations complete before the network send and ordinary JSON response/RPC observations complete before the SDK call returns. SSE headers/status emit immediately as one stream marker before its detached parser emits inbound RPC frames, including for streams that never close below the cap.
- Made connection deletion await runtime disconnect before the SQLite delete. Close failures now retain the saved configuration and return the stable `MCP_DISCONNECT_FAILED` route error.
- Propagated failures from closing a session invalidated during connection, while still clearing the runtime entry and avoiding a false persisted connect failure.
- Bounded unknown-dialect warning values and replaced control characters to prevent log forging or unbounded diagnostic text.
