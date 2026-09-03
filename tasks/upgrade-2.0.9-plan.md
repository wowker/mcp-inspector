# 2.0.9 implementation plan

## Status

Complete. The unified test-case disclosures and their lifecycle states are implemented and verified.

## Slices

1. Add failing interaction tests for the three new Disclosure sections and their lifecycle states.
2. Add a scoped ParameterEditor option that removes the duplicate parameter caret only in test cases.
3. Wrap request arguments and assertions with the shared Disclosure primitive.
4. Always render the single-Tool execution-result Disclosure and control it from execution state.
5. Synchronize bilingual copy, styling, documentation, and run release verification.

## Guardrails

- No API, migration, execution-engine, assertion-engine, or persistence changes.
- Preserve Tool debugging behavior and all pre-existing changes in the dirty worktree.
- Reuse shared primitives, Phosphor icons, semantic tokens, stable identities, and bilingual resources.
- Do not commit without an explicit user request.
