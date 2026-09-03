# Implementation Plan: 2.0.1–2.0.3 UI Remediation

## Overview

Complete the unimplemented 2.0.1 searchable-selector and layout requirements, retain the delivered 2.0.2/2.0.3 behavior, and add requirement-level browser acceptance so a green suite proves the version plans rather than only the existing implementation.

## Architecture decisions

- Build one internal `SearchableSelect` on the existing Popover, tokens, and Phosphor icons; Feature code receives stable values and never owns listbox mechanics.
- Dynamic identity-bearing collections are always searchable. Fixed short enums continue using `Select` or Radio controls.
- Preserve connection IDs, Tool names, test IDs, member IDs, scenario ordering, and all request-generation fences.
- Add failing behavior tests before every implementation slice and keep layout changes independent from selector migration.
- Do not modify APIs, SQLite migrations, or persisted wire contracts.

## Dependency graph

```text
Requirement tests
  -> SearchableSelect foundation
    -> Automated testing migration
    -> Environment/report/tool/schema migrations
  -> Page action placement and filter help
  -> Responsive and production E2E acceptance
  -> Documentation and final verify
```

## Task list

1. Add red tests for searchable Server/Tool selection, exact action placement/count, suite placement, report action placement, and filter help.
2. Implement `SearchableSelect` with filtering/ranking, bounded results, keyboard navigation, focus return, loading/empty/disabled/clear states, and bilingual accessible copy.
3. Migrate Tool test and scenario dynamic selectors while preserving stable values and stale-request fences.
4. Migrate environment/profile, report binding, Tool folder, and long Schema enum selectors; retain short fixed Select/Radio choices.
5. Replace the suite candidate search with the shared selection behavior while retaining the 2.0.3 member list, ordering, enabling, removal, and scenario inputs.
6. Move and deduplicate test-case, suite, and report actions; add the dedicated Run filter help.
7. Add 320/760/1024/1440 responsive acceptance, keyboard/axe checks, and one production searchable-test-case flow.
8. Update 2.0.1/2.0.2 delivery status only after all focused and full gates pass.

## Checkpoints

- Foundation: component tests, Foundation tests, typecheck.
- Feature migration: focused testing/environment/tools/tabs tests and build.
- Layout: exact action-count/location tests and responsive screenshots.
- Complete: `npm run verify`, `git diff --check`, bilingual key parity, reviewed screenshot changes.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Search returns the wrong identity | High | Return stable values only; test same-name/same-URL boundaries |
| Custom combobox accessibility drift | High | Contract tests for keyboard, focus, roles, active descendant, and IME |
| Large option lists block rendering | Medium | Bound visible results and test a 1,000-option fixture |
| Layout move duplicates callbacks | Medium | Lift one creation callback and assert exactly one visible entry |
| Existing 2.0.3 behavior regresses | High | Keep its direct-save, suite-member, assertion-help, and Tool-intent tests green |

## Definition of done

- Every dynamic long-list selector named by 2.0.1 uses the shared component and is searchable.
- All action placement and help requirements are proven by exact, behavior-level tests.
- 2.0.2 responsive and help behavior is proven in a real browser at the required widths.
- Full project verification passes without skipped tests or undocumented exceptions.

