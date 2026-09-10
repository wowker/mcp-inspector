# MCP Inspector 3.0.0 Authoring MCP Checklist

> Implementation plan: [`docs/superpowers/plans/2026-09-10-authoring-mcp-implementation.md`](../docs/superpowers/plans/2026-09-10-authoring-mcp-implementation.md)
>
> Authoritative spec: [`docs/superpowers/specs/2026-09-09-authoring-mcp-design.md`](../docs/superpowers/specs/2026-09-09-authoring-mcp-design.md)

## Slice A — Runtime, registry authentication, MCP transport

- [x] Task 1: Fixed port and CLI precedence.
- [x] Task 2: Registry migrations and installation settings.
- [x] Task 3: One-time Authoring Token management.
- [x] Task 4: Authenticated Streamable HTTP walking skeleton.
- [x] Checkpoint A: focused gates and `npm run verify` pass.

## Slice B — Discovery and connection policy

- [x] Task 5: Policy persistence and authorization semantics.
- [x] Task 6: Project, connection, and Tool discovery.
- [x] Task 7: Server Authoring permission UI.
- [x] Checkpoint B: focused gates and `npm run verify` pass.

## Slice C — Standalone Tool calls, audit, and Run lineage

- [x] Task 8: Project migrations 022–023.
- [x] Task 9: Policy-enforced standalone calls.
- [x] Task 10: Call history and Authoring Run origin.
- [x] Checkpoint C: focused gates and `npm run verify` pass.

## Slice D — Draft authoring and validation

- [x] Task 11: Draft Bundle contract and revision service.
- [x] Task 12: Draft validation and existing asset discovery.
- [x] Task 13: Authoring MCP workspace shell.
- [x] Checkpoint D: focused gates and `npm run verify` pass.

## Slice E — Trial execution and step-local QuickJS

- [x] Task 14: Bounded step-local `argumentTransform`.
- [x] Task 15: Asynchronous Draft trial execution.
- [x] Checkpoint E: focused gates and `npm run verify` pass.

## Slice F — Atomic Apply and editor handoff

- [ ] Task 16: Atomic save of exact validated revision.
- [ ] Task 17: MCP save and UI editor handoff.
- [ ] Checkpoint F: focused gates and `npm run verify` pass.

## Slice G — Hardening and release

- [ ] Task 18: Security, limits, restart, and observability.
- [ ] Task 19: E2E, documentation, packaging, and release gates.
- [ ] Final: `npm run verify` passes.
- [ ] Final: `npm run verify:release-artifacts` passes.
- [ ] Final: `npm pack --dry-run --json` passes.
- [ ] Final: `git diff --check` passes.
- [ ] Final: independent reviews have no Critical/Required findings.

## Explicit non-goals

- [ ] No embedded model, Provider adapter, Agent loop, or chat UI added.
- [ ] No stdio, LAN/remote listener, multi-user, or multiple Token support added.
- [ ] No AI-managed secrets, authentication, environment values, enablement, scheduling, deletion, pressure tests, or shared workflow edits added.
