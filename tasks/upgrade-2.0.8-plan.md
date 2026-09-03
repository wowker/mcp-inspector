# 2.0.8 implementation plan

## Status

Complete. Product analysis, stacked disclosures, and the left-flow/right-detail interaction are implemented and verified.

## Slices

1. Specify and test assertion value semantics and scenario configuration disclosure state.
2. Build a shared assertion renderer and scenario master-detail execution viewer.
3. Add the case-scoped execution-history query contract and regression tests.
4. Add stacked result/history disclosures and connect the scenario history button to the shared viewer.
5. Finish bilingual copy, responsive styling, production E2E, and release verification.

## Guardrails

- No migration, dependency, execution-engine, assertion-engine, or Run-persistence changes.
- Preserve all pre-existing 2.0.1–2.0.7 changes in the dirty worktree.
- Use stable IDs, defensive API decoding, shared primitives, Phosphor icons, and semantic tokens.
- Do not commit without an explicit user request.
