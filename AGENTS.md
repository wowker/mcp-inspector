# MCP Inspector Repository Instructions

## Required context

Before changing user-facing UI, interaction, client state, CSS, accessibility, or browser behavior, read and follow:

- `docs/FRONTEND-DEVELOPMENT-STANDARDS.md`

Before implementing work scoped to the next major release, also read:

- `docs/UPGRADE-2.0.0.md`

Feature-specific specifications in `docs/` remain authoritative for their domain. If instructions conflict, stop and surface the conflict instead of silently choosing one.

## Non-negotiable boundaries

- Preserve project, connection, tab, and run identity isolation.
- Connection authentication is keyed by connection ID, never only by URL or domain.
- Preserve existing SQLite data and add new numbered migrations; never rewrite a released migration.
- Keep secrets out of URLs, ordinary logs, Toast messages, default exports, and browser storage.
- Reuse shared runtime schemas across client and server boundaries.
- Reuse existing UI tokens, Phosphor icons, and primitives; do not introduce a second design system for a local feature.
- Do not change established behavior as a side effect of a visual refactor.
- Add regression tests for every behavior change and bug fix.

## Verification

Run focused tests while developing. Before handing off a change, run the gates required by `docs/FRONTEND-DEVELOPMENT-STANDARDS.md`. Core workflow, authentication, persistence, routing, layout, or production-entry changes require `npm run verify`.
