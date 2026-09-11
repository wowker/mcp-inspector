# MCP Inspector 3.7.0 Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-scoped textual Skill Registry that stores standard and user Skills together, lets browser users manage user Skills, and lets external Agents discover and pull exact published revisions over Authoring MCP.

**Architecture:** Shared Zod contracts define bounded textual Skill Bundles. A project SQLite repository owns immutable revisions, validations and publication state; a standard synchronizer seeds the same repository from packaged Markdown. Browser routes expose user CRUD while Authoring MCP remains read-only. Inspector never reads or writes `.agents/skills/`.

**Tech Stack:** TypeScript, Zod, Hono, better-sqlite3, React, Vitest, Testing Library, MCP TypeScript SDK, Playwright.

**Spec:** [`../specs/2026-09-11-mcp-inspector-3.7.0-skills-design.md`](../specs/2026-09-11-mcp-inspector-3.7.0-skills-design.md)

## Global Constraints

- Complete and merge the remaining 3.5.0 validation/review plan before starting Task 1.
- Re-read `docs/FRONTEND-DEVELOPMENT-STANDARDS.md` before Task 16.
- Use the next contiguous migration number on the implementation branch; this plan uses `027_project_skills.sql` because the current baseline ends at 026. Renumber before writing if another committed migration exists.
- Preserve project, connection, Tool, Run, Draft, validation, review, Skill and revision identity isolation.
- Store STANDARD and USER Skills in the same project tables; enforce origin-specific permissions server-side.
- Support only `SKILL.md` and `references/**/*.md` UTF-8 text in 3.7.0.
- Inspector must not read, write, install, update, remove or report the state of `.agents/skills/`.
- Add regression tests for every behavior change. Run focused tests during each task and `npm run verify` at the marked checkpoints.
- Do not rewrite any released migration or leak secrets through Skill content, URLs, logs, Toasts, exports or MCP errors.

## File Map

```text
src/shared/skills/skill.ts                         Shared schemas and wire contracts
src/server/projects/migrations/027_project_skills.sql
src/server/skills/skill-bundle.ts                  Canonical validation and digest
src/server/skills/skill-repository.ts              SQLite persistence
src/server/skills/skill-service.ts                 Browser management and read catalog
src/server/skills/standard-skill-loader.ts          Packaged Markdown loader
src/server/skills/standard-skill-sync.ts            Idempotent project synchronization
src/server/skills/routes.ts                         Browser Session routes
src/server/skills/authoring-skill-tools.ts          MCP registration adapter
src/server/skills/standard/**                       Seven standard Skill Bundles
src/client/features/skills/**                       Skills workbench
src/shared/i18n/locales/{zh-CN,en-US}/skills.ts     UI copy
```

---

### Task 1: Finish the 3.5.0 dependency

**Files:**
- Follow: `docs/superpowers/plans/2026-09-11-mcp-inspector-3.5.0-validation-review-implementation.md`

**Interfaces:**
- Consumes: current 3.5.0 Task 1–6 commits.
- Produces: stable validation-session MCP tools, Scenario evidence, Human Review browser routes and UI required by standard Skills.

- [ ] Complete Tasks 7–19 of the 3.5.0 plan in their documented order.
- [ ] Run `npm run verify` and the 3.5.0 release-artifact gates.
- [ ] Merge the completed 3.5.0 branch to the 3.7.0 implementation base before adding a Skill migration.
- [ ] Confirm `git status --short` is clean and record the highest committed project migration number.

### Task 2: Define bounded shared Skill contracts

**Files:**
- Create: `src/shared/skills/skill.ts`
- Create: `src/shared/skills/__tests__/skill.test.ts`
- Modify: `src/shared/server-export.ts` only if its public shared export surface explicitly enumerates project assets.

**Interfaces:**
- Produces: `skillBundleSchema`, `projectSkillSchema`, `projectSkillRevisionSchema`, list/get/file inputs and mutation inputs.

- [ ] Write failing parsing tests covering STANDARD/USER, lifecycle states, `publishedRevision`, the 64-file/256-KiB/1-MiB limits, list limit 50/100, slug length 63, and strict unknown-field rejection.

```ts
expect(skillBundleSchema.safeParse({
  files: { "SKILL.md": "---\nname: sample\ndescription: Use when testing.\n---\n" },
}).success).toBe(true);
expect(listSkillsInputSchema.parse({ projectId }).limit).toBe(50);
```

- [ ] Define exact enums and constants from the spec without a second client-only shape.
- [ ] Define browser mutation inputs with `expectedRevision` and `idempotencyKey`; define publish input with `revision` and `validationDigest`.
- [ ] Define MCP read inputs so file reads require exact `revision`, `path` and Bundle `expectedDigest`.
- [ ] Export inferred TypeScript types from the same module.
- [ ] Run `npx vitest run src/shared/skills/__tests__/skill.test.ts` and `npm run typecheck`.
- [ ] Commit with `feat(skills): add shared project skill contracts`.

### Task 3: Add the project Skill migration

**Files:**
- Create: `src/server/projects/migrations/027_project_skills.sql`
- Create: `src/server/projects/__tests__/skill-migration.test.ts`
- Modify: `src/server/projects/__tests__/release-migration-matrix.test.ts`
- Modify: `src/server/projects/__tests__/authoring-migrations.test.ts`

**Interfaces:**
- Consumes: Task 2 state values and size limits.
- Produces: `project_skills`, `project_skill_revisions`, `project_skill_validations`, `project_skill_mutation_keys`.

- [ ] Write failing fresh-install, 026-upgrade, rollback, foreign-key, origin/state constraint, revision uniqueness, standard-key uniqueness and JSON-size tests.
- [ ] Add tables with composite project foreign keys, immutable revision triggers, bounded JSON checks and indexes for stable `(updated_at DESC, id DESC)` pagination.
- [ ] Make `(project_id, slug)` unique across active and soft-deleted records so deletion cannot transfer installation provenance.
- [ ] Bind validations to exact `project_id + skill_id + revision + content_digest`; make published revisions foreign-key valid.
- [ ] Update release-hash assertions only by appending the newly committed migration hash after it becomes a released baseline; never change prior bytes.
- [ ] Run `npx vitest run src/server/projects/__tests__/skill-migration.test.ts src/server/projects/__tests__/release-migration-matrix.test.ts src/server/projects/__tests__/authoring-migrations.test.ts`.
- [ ] Run `npm run typecheck`.
- [ ] Commit with `feat(skills): persist project skill revisions`.

### Task 4: Implement canonical text Bundle validation

**Files:**
- Create: `src/server/skills/skill-bundle.ts`
- Create: `src/server/skills/__tests__/skill-bundle.test.ts`

**Interfaces:**
- Produces: `validateSkillBundle(bundle, metadata)` and `digestSkillBundle(bundle)`.

- [ ] Write failing tests for missing `SKILL.md`, invalid YAML frontmatter, name/slug mismatch, non-UTF-8 input boundary, absolute paths, `.`, `..`, backslashes, hidden files, non-Markdown files, case-fold collisions and all size limits.
- [ ] Prove digest independence from object insertion order and sensitivity to path, byte length and content.

```ts
expect(digestSkillBundle({ files: { "references/b.md": "B", "SKILL.md": valid } }))
  .toBe(digestSkillBundle({ files: { "SKILL.md": valid, "references/b.md": "B" } }));
expect(() => validateSkillBundle({ files: { "references/../secret.md": "x", "SKILL.md": valid } }, meta))
  .toThrow(SkillBundleInvalidError);
```

- [ ] Parse frontmatter without rendering or executing Markdown/HTML; return bounded file/path issues.
- [ ] Canonicalize using a fixed format version, sorted paths, UTF-8 byte lengths and contents before SHA-256.
- [ ] Scan persisted content for known Inspector tokens and resolved secrets supplied by the caller; do not log rejected content.
- [ ] Run `npx vitest run src/server/skills/__tests__/skill-bundle.test.ts` and `npm run typecheck`.
- [ ] Commit with `feat(skills): validate textual skill bundles`.

### Task 5: Implement the unified Skill repository

**Files:**
- Create: `src/server/skills/skill-repository.ts`
- Create: `src/server/skills/__tests__/skill-repository.test.ts`

**Interfaces:**
- Consumes: Task 2 contracts and Task 3 tables.
- Produces: insert, appendRevision, recordValidation, publish, setState, get, getRevision, getFile and paginated list methods.

- [ ] Write failing tests for project isolation, STANDARD/USER coexistence, immutable revisions, optimistic revision conflicts, idempotent mutation replay/conflict, stable cursors, disabled/deleted visibility and transaction rollback.
- [ ] Implement repository transactions that atomically append a revision and advance the aggregate revision without mutating old snapshots.
- [ ] Make publish require a VALID validation whose revision, content digest and validation digest exactly match.
- [ ] Keep browser administrative reads able to inspect drafts/history while Agent catalog reads receive only ACTIVE, published records.
- [ ] Reject cross-project IDs and cursor reuse with different filters.
- [ ] Run `npx vitest run src/server/skills/__tests__/skill-repository.test.ts` and `npm run typecheck`.
- [ ] Commit with `feat(skills): add unified skill repository`.

### Task 6: Seed and synchronize standard Skills

**Files:**
- Create: `src/server/skills/standard-skill-loader.ts`
- Create: `src/server/skills/standard-skill-sync.ts`
- Create: `src/server/skills/__tests__/standard-skill-sync.test.ts`
- Modify: `scripts/copy-static.mjs`

**Interfaces:**
- Consumes: `SkillRepository`, `validateSkillBundle` and packaged `skill.json`/Markdown.
- Produces: `syncStandardSkills(projectId)` and source/dist asset parity.

- [ ] Write failing tests for initial seed, repeated no-op, newer-version append, same-version/different-digest rejection, database-newer no-downgrade, missing seed deprecation and all-or-nothing rollback.
- [ ] Resolve source layout and bundled `dist/server/skills/standard/` layout using the existing migration resolver pattern.
- [ ] Validate the complete seed catalog before opening the write transaction.
- [ ] Preserve a project's DISABLED state while publishing a newer standard revision.
- [ ] Extend `copy-static.mjs` to copy standard Skill files and verify relative file names and bytes, not only directory presence.
- [ ] Run `npx vitest run src/server/skills/__tests__/standard-skill-sync.test.ts` and `npm run build`.
- [ ] Commit with `feat(skills): synchronize packaged standard skills`.

### Task 7: Implement user Skill management

**Files:**
- Create: `src/server/skills/skill-service.ts`
- Create: `src/server/skills/__tests__/skill-service.test.ts`
- Create: `src/server/skills/routes.ts`
- Create: `src/server/skills/__tests__/routes.test.ts`

**Interfaces:**
- Produces: browser CRUD/validate/publish/enable/disable/delete/restore and shared read catalog.

- [ ] Write service tests for create, draft revisions, validation, exact publish, enable/disable, soft delete/restore, reserved slug, stale revision, idempotency and STANDARD read-only enforcement.
- [ ] Implement USER mutations through one service; keep origin checks out of route conditionals.
- [ ] Write route tests for status/error mapping, malformed JSON, project identity mismatch and absence of secrets in failures.
- [ ] Mount the exact routes from the spec under `/api/projects/:projectId/skills` with existing Session middleware.
- [ ] Return an explicit warning on delete that Agent-installed copies are outside Inspector ownership.
- [ ] Run `npx vitest run src/server/skills/__tests__/skill-service.test.ts src/server/skills/__tests__/routes.test.ts` and `npm run typecheck`.
- [ ] Commit with `feat(skills): manage user skill lifecycles`.

### Task 8: Expose read-only Skill discovery over Authoring MCP

**Files:**
- Create: `src/server/skills/authoring-skill-tools.ts`
- Create: `src/server/skills/__tests__/authoring-skill-tools.test.ts`
- Modify: `src/server/authoring/authoring-mcp-server.ts`
- Modify: `src/shared/authoring/protocol.ts`

**Interfaces:**
- Produces: `inspector_list_skills`, `inspector_get_skill`, `inspector_get_skill_file`.

- [ ] Write MCP client tests for Tool discovery, search/origin pagination, exact historical revision, file digest, unpublished/disabled/deleted rejection, cross-project rejection and bounded structured output.
- [ ] Register only the three read Tools; assert no install/update/uninstall or Skill mutation Tool appears.
- [ ] Describe returned USER content as untrusted instructions and keep origin explicit in every summary/detail response.
- [ ] Require Bundle `expectedDigest` for file reads and never silently redirect a stale request to latest.
- [ ] Extend capabilities with a versioned `projectSkills` feature flag without renaming existing Tools.
- [ ] Run `npx vitest run src/server/skills/__tests__/authoring-skill-tools.test.ts src/server/authoring/__tests__/authoring-call-tools.test.ts` and `npm run typecheck`.
- [ ] Commit with `feat(authoring): expose project skill discovery`.

### Task 9: Wire one production Skill ownership graph

**Files:**
- Modify: `src/server/main.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/__tests__/main.test.ts`
- Modify: `src/server/__tests__/app.test.ts`

**Interfaces:**
- Consumes: standard sync, Skill service/routes and MCP adapter.
- Produces: one production repository/service instance shared by browser and MCP.

- [ ] Add failing bootstrap tests proving standard sync runs after migrations, browser and MCP share the same service, sync failure does not block startup, and close does not double-close project state.
- [ ] Construct Skill dependencies once in `main.ts`; inject the catalog into Authoring MCP and the management service into `createApp`.
- [ ] Keep tests able to inject fakes without causing fallback duplicate production instances.
- [ ] Ensure no Skill service receives connection authentication values or filesystem access to project worktrees.
- [ ] Run `npx vitest run src/server/__tests__/main.test.ts src/server/__tests__/app.test.ts` and `npm run typecheck`.
- [ ] Run `npm run verify` as Checkpoint A.
- [ ] Commit with `feat(skills): wire project skill services`.

### Task 10: Author `using-mcp-inspector`

**Files:**
- Create: `src/server/skills/standard/using-mcp-inspector/skill.json`
- Create: `src/server/skills/standard/using-mcp-inspector/SKILL.md`
- Create: `src/server/skills/standard/using-mcp-inspector/references/workflow-routing.md`
- Create: `src/server/skills/__tests__/using-mcp-inspector.behavior.test.ts`

**Interfaces:**
- Produces: routing from user intent to the six specialized standard Skills.

- [ ] Record baseline fixtures where an Agent confuses Scenario with Suite or begins diagnosis with a write call.
- [ ] Write a concise trigger-only description and a routing table for single Tool, Scenario, Run regression, validation, diagnosis and Suite requests.
- [ ] Ensure it directs the Agent to `inspector_list_skills`/exact revision reads and does not duplicate specialist workflows.
- [ ] Verify observable routing decisions against the fixtures and validate the Bundle through Task 4.
- [ ] Commit with `feat(skills): add inspector skill router`.

### Task 11: Author `authoring-tool-tests`

**Files:**
- Create: `src/server/skills/standard/authoring-tool-tests/skill.json`
- Create: `src/server/skills/standard/authoring-tool-tests/SKILL.md`
- Create: `src/server/skills/standard/authoring-tool-tests/references/assertion-sources.md`
- Create: `src/server/skills/__tests__/authoring-tool-tests.behavior.test.ts`

**Interfaces:**
- Produces: evidence-backed single-Tool Draft authoring workflow.

- [ ] Add baseline cases for guessed schemas, secret-bearing arguments, prose-only expectations and automatic enablement.
- [ ] Require Tool description/hash, explicit expectation sources, Draft validation and disabled formal assets.
- [ ] Define bounded retry/stop rules for Schema and revision conflict.
- [ ] Verify the Skill corrects each baseline failure without inventing business expectations.
- [ ] Commit with `feat(skills): add tool test authoring skill`.

### Task 12: Author `authoring-scenario-tests`

**Files:**
- Create: `src/server/skills/standard/authoring-scenario-tests/skill.json`
- Create: `src/server/skills/standard/authoring-scenario-tests/SKILL.md`
- Create: `src/server/skills/standard/authoring-scenario-tests/references/scenario-model.md`
- Create: `src/server/skills/standard/authoring-scenario-tests/references/data-flow-and-assertions.md`
- Create: `src/server/skills/standard/authoring-scenario-tests/references/mapping-update-example.md`
- Create: `src/server/skills/__tests__/authoring-scenario-tests.behavior.test.ts`

**Interfaces:**
- Produces: multi-Tool Scenario authoring with mappings, extractors, polling, assertions and cleanup.

- [ ] Capture baseline failures for Scenario/Suite confusion, guessed response paths, fixed sleeps, missing cleanup, forward references, revision edits during validation and prompt-like Tool output.
- [ ] Encode the approved create/read/poll/cleanup decision rules in `SKILL.md`; move schemas and the Mapping example to references.
- [ ] Make the example describe `get_store_product_mapping → apply_product_mapping → polling get → cleanup apply` without hard-coded argument/response paths.
- [ ] Require actual `inspector_describe_tool` results before constructing definitions and exact validation evidence before assessment.
- [ ] Verify all baseline failures are corrected and retries remain bounded.
- [ ] Commit with `feat(skills): add scenario test authoring skill`.

### Task 13: Author Run regression and diagnosis Skills

**Files:**
- Create: `src/server/skills/standard/creating-regression-tests-from-runs/skill.json`
- Create: `src/server/skills/standard/creating-regression-tests-from-runs/SKILL.md`
- Create: `src/server/skills/standard/diagnosing-mcp-tool-runs/skill.json`
- Create: `src/server/skills/standard/diagnosing-mcp-tool-runs/SKILL.md`
- Create: `src/server/skills/__tests__/run-skills.behavior.test.ts`

**Interfaces:**
- Produces: read-first Run diagnosis and safe conversion of immutable Runs to regression Drafts.

- [ ] Add baseline cases for replay without authorization, treating `[REDACTED]` as expected, pinning timestamps/IDs and ignoring Schema drift.
- [ ] Make diagnosis read-only by default and classify parameter, authentication, connection, business, timeout, environment, script and Schema failures.
- [ ] Make regression creation use exact Run/Call identity and remove unstable or secret values before Draft validation.
- [ ] Verify no write/replay happens without explicit user authorization.
- [ ] Commit with `feat(skills): add run diagnosis and regression skills`.

### Task 14: Author validation and Suite Skills

**Files:**
- Create: `src/server/skills/standard/validating-mcp-test-assets/skill.json`
- Create: `src/server/skills/standard/validating-mcp-test-assets/SKILL.md`
- Create: `src/server/skills/standard/authoring-test-suites/skill.json`
- Create: `src/server/skills/standard/authoring-test-suites/SKILL.md`
- Create: `src/server/skills/__tests__/validation-suite-skills.behavior.test.ts`

**Interfaces:**
- Produces: exact-revision validation/assessment and safe Suite composition.

- [ ] Add baseline cases for editing a frozen source, interpreting missing evidence as PASS, Agent review mutation, concurrent shared-resource tests and cross-member data dependencies.
- [ ] Require FAIL/ERROR/INCONCLUSIVE separation, immutable evidence and browser-only Human Review.
- [ ] Require Scenario for data-dependent calls and serial Suite execution for shared side-effect resources.
- [ ] Verify Suite concurrency remains within 1–8 and the Agent never creates cross-member variables.
- [ ] Run all standard Skill Bundle and behavior tests plus `npm run typecheck`.
- [ ] Run `npm run verify` as Checkpoint B.
- [ ] Commit with `feat(skills): complete standard skill library`.

### Task 15: Add client contracts and Skills controller

**Files:**
- Modify: `src/client/api/api-client.ts`
- Create: `src/client/api/__tests__/skill-api-client.test.ts`
- Create: `src/client/features/skills/use-skills-controller.ts`
- Create: `src/client/features/skills/__tests__/use-skills-controller.test.tsx`

**Interfaces:**
- Produces: typed list/detail/revision/CRUD/validate/publish/state methods and project-fenced controller state.

- [ ] Add failing strict-decoding tests for every browser response and error status.
- [ ] Add controller tests for search pagination, selected revision/file, dirty drafts, stale response fencing and complete project-switch reset.
- [ ] Reuse Task 2 schemas for wire decoding; do not duplicate client-only Skill types.
- [ ] Keep Skill contents out of `localStorage` and abort or ignore responses from an earlier project generation.
- [ ] Run focused API/controller tests and `npm run typecheck`.
- [ ] Commit with `feat(skills): add client skill controller`.

### Task 16: Build the Skills workbench

**Files:**
- Create: `src/client/features/skills/SkillsPage.tsx`
- Create: `src/client/features/skills/SkillList.tsx`
- Create: `src/client/features/skills/SkillEditor.tsx`
- Create: `src/client/features/skills/skills.css`
- Create: `src/client/features/skills/__tests__/SkillsPage.test.tsx`

**Interfaces:**
- Consumes: Task 15 controller.
- Produces: standard viewer and user draft/editor/publish lifecycle.

- [ ] Re-read the frontend standards and write failing keyboard, focus, long-content, origin/state text, standard-read-only, dirty-navigation and project-switch tests.
- [ ] Build the master/detail page with existing tokens, Buttons, Dialogs, form fields, Disclosures and Phosphor icons.
- [ ] Render standard metadata, history and Markdown as safe text/preview; show no edit/delete controls.
- [ ] Provide user basic fields, `SKILL.md`, `references/**/*.md`, validation issues, save, publish, enable/disable, delete and restore.
- [ ] Make publish and delete confirmations identify exact Skill/revision; make delete copy state that Agent-installed files are unaffected.
- [ ] Run `npx vitest run src/client/features/skills/__tests__/SkillsPage.test.tsx` and `npm run typecheck`.
- [ ] Commit with `feat(ui): add project skills workbench`.

### Task 17: Integrate navigation and bilingual UI

**Files:**
- Modify: `src/client/app/InspectorWorkbench.tsx`
- Modify: `src/client/app/InspectorWorkbench.test.tsx`
- Create: `src/shared/i18n/locales/zh-CN/skills.ts`
- Create: `src/shared/i18n/locales/en-US/skills.ts`
- Modify: `src/client/i18n/index.ts`
- Modify: `src/shared/i18n/locale.test.ts`

**Interfaces:**
- Produces: independent first-level Skills page and complete zh-CN/en-US terms.

- [ ] Add failing tests for navigation label/icon, persistent page state, project reset, compact sidebar accessible name and module help.
- [ ] Add `skills` to `WorkbenchPage`, use one existing Phosphor icon, and mount `SkillsPage` without disturbing Tool/Test drafts.
- [ ] Register the namespace through the existing locale composition module; do not concatenate translated sentences.
- [ ] Verify standard/user, draft/published, validation and deletion warnings in both locales.
- [ ] Run `npx vitest run src/client/app/InspectorWorkbench.test.tsx src/client/features/skills/__tests__/SkillsPage.test.tsx` and `npm run typecheck`.
- [ ] Run `npm run verify` as Checkpoint C.
- [ ] Commit with `feat(ui): integrate skills navigation`.

### Task 18: Extend project portability

**Files:**
- Modify: `src/shared/testing/test-transfer.ts`
- Modify: `src/server/testing/test-transfer-service.ts`
- Modify: `src/server/testing/__tests__/test-transfer-service.test.ts`
- Modify: `src/server/testing/__tests__/test-transfer-routes.test.ts`

**Interfaces:**
- Consumes: Skill service/repository and standard synchronizer.
- Produces: versioned exports containing Skill identities/revisions without Agent installation metadata.

- [ ] Add failing export/import tests for all USER revisions, STANDARD revisions, publication pointers, disabled state, identity conflicts, newer-standard preservation and post-import standard resync.
- [ ] Introduce a backward-compatible transfer envelope version that accepts existing version 1 exports unchanged.
- [ ] Never export `.agents/skills/`, local paths, authorization state, tokens or mutation keys.
- [ ] Preserve USER data exactly; after import, run standard synchronization and never let STANDARD data overwrite a USER slug.
- [ ] Make import atomic with existing test-case/Suite imports or reject the entire request.
- [ ] Run focused transfer tests and `npm run typecheck`.
- [ ] Commit with `feat(skills): include project skills in transfers`.

### Task 19: Add adversarial integration and production E2E

**Files:**
- Create: `src/server/skills/__tests__/skill-security.test.ts`
- Create: `e2e/project-skills.spec.ts`
- Modify: `src/server/__tests__/main.test.ts`
- Modify: `scripts/copy-static.mjs`

**Interfaces:**
- Verifies: end-to-end project Registry, read-only Agent distribution and package parity.

- [ ] Test prompt-like user Markdown, HTML/script payloads, path traversal, oversized files, same slug/case variants, cross-project IDs, stale digest, cursor substitution and secret-like values.
- [ ] Prove Authoring MCP exposes only read Tools and never mutates Skill rows or filesystem paths.
- [ ] Exercise browser create → draft → validate → publish → disable/enable → delete/restore, then MCP list/manifest/file reads.
- [ ] Verify 1,000 metadata rows remain paginated and opening one Skill loads only its Manifest/current file.
- [ ] Build the npm artifact and compare every packaged standard Skill relative path and byte with source.
- [ ] Use a real MCP client to pull `authoring-scenario-tests`; have the test harness write it outside Inspector and verify Inspector made no filesystem write.
- [ ] Run `npx vitest run src/server/skills/__tests__/skill-security.test.ts`, `npx playwright test e2e/project-skills.spec.ts`, and `npm run verify`.
- [ ] Commit with `test(skills): cover project skill security and e2e`.

### Task 20: Finish documentation and release review

**Files:**
- Create: `docs/UPGRADE-3.7.0.md`
- Modify: `README.md`
- Modify: `package.json` only during the approved release procedure, not during feature implementation.

**Interfaces:**
- Produces: operator/Agent documentation and release evidence.

- [ ] Document STANDARD/USER distinctions, text-only limits, browser CRUD, the three MCP Tools, exact revision pulling and the Inspector-versus-Agent installation boundary.
- [ ] Include a safe Agent example that discovers and pulls `authoring-scenario-tests`, then asks its own runtime for permission to write `.agents/skills/`.
- [ ] State that deleting a Registry Skill does not remove an Agent-installed copy and installation may require a new Agent session to discover.
- [ ] Run manual keyboard, focus, screen-reader, light/dark, narrow/wide and long zh-CN/en-US checks required by the frontend standard.
- [ ] Run `npm run verify`, release-artifact checks and a clean-process startup test.
- [ ] Perform independent correctness, security/privacy, prompt-injection, migration, packaging and accessibility review; resolve every Critical/Required finding.
- [ ] Commit with `docs: document MCP Inspector 3.7.0 skills`.

## Final Completion Gate

- [ ] All 20 tasks and Checkpoints A–C are complete.
- [ ] All seven standard Skills are present in source, package and a newly opened project database.
- [ ] A USER Skill survives export/import with immutable revisions and exact digest.
- [ ] External Agent discovery is read-only and project isolated.
- [ ] Inspector contains no code path that reads or writes `.agents/skills/`.
- [ ] `npm run verify` and release artifact verification pass from a clean checkout.
- [ ] Independent review reports zero unresolved Critical or Required findings.
