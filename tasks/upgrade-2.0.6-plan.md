# 2.0.6 implementation plan

## Status

Complete. All planned slices and the full release verification are finished.

## Slices

1. Extend shared module help with page descriptions and a refined information icon.
2. Separate Run status and pin controls in the history list.
3. Reorder automated-test actions, add collapsible basic information, rename the enable label, and place timeout under Test configuration.
4. Replace suite concurrency selection with bounded numeric input and add stable-ID member drag/keyboard reordering.
5. Rename and reorder Tool debug views, then run focused and full verification.

## Guardrails

- No API, persistence, identity, secret, or migration changes.
- Preserve all pre-existing user changes in the dirty worktree.
- Use shared primitives, semantic tokens, Phosphor icons, and bilingual copy.
- Add a regression test before each behavioral fix.
