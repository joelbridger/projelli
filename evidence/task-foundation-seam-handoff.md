# Task foundation seam fix handoff

## Final code and evidence

- Final code commit: `2e816538ca8e53d4c191f26f5f5de2014075fb94`
- Branch: `v1/w2-task-foundation-seam`
- Receipt: `evidence/self-check-receipt-2e816538ca8e.txt` — `overall: GREEN`
- Review history: the independent foundation review returned `CHANGES`; this fix addresses its two blockers. No post-fix independent review was run in this worker round.
- Native/Rust touched: **NO**
- Migration: **none; `v0006` remains free**
- Push/merge/Cargo: **not run**

## What changed

`@/features/crm-workflows` now publicly exports a reactive canonical workflow-template store. Its documented surface provides template `list`, `get`, `create`, `update`, and `publish`, plus `start` and `getInstance` for a canonical started workflow. It exposes stable ordered step IDs and stable tag IDs without exposing the raw live-record writer.

The store writes only through the existing encrypted live-record route. New templates are drafts. Updating a template makes it a draft again. Starting a draft fails before any write with the exported typed `WorkflowTemplateError` and code `template_not_published`. Publishing makes the same persisted canonical template startable.

The consumer-shaped integration test imports only `@/features/crm-workflows` and proves: create -> fresh reload -> update/reorder -> publish -> fresh reload -> start -> fresh reload. The final instance retains the reordered stable step IDs and their tag IDs.

## Final-code checks

The machine receipt binds these fresh results to `2e816538ca8e53d4c191f26f5f5de2014075fb94`:

- Changed-code gate: PASS — 8,471 passed; 29 skipped.
- Typecheck: PASS.
- Test typecheck: PASS.
- Handle guard: PASS.
- Architecture boundary test: PASS.
- English language snapshot: PASS.
- Focused foundation tests: PASS — 15 files, 81 tests.
- Public feature-boundary check and ESLint on the four fix files were also run after the last edit and passed before the final code commit.
- `git diff --check` is clean for the code and handoff. It reports trailing spaces only on the machine receipt's generated `step:` lines; the receipt was not hand-edited because its header expressly forbids that.

## Six-consumer re-preflight

- `task-create-v1`: PASS; unchanged public canonical task store.
- `task-templates`: PASS; unchanged merge-safe task create/update route.
- `task-capacity-triage`: PASS; unchanged task/workflow stable tag-ID projections.
- `workflow-step-attachments`: PASS; unchanged typed step metadata save callback and public document references.
- `workflow-authoring`: PASS; public canonical create/update/publish/start/get/reload flow now exists, preserves ordered step IDs/tag IDs, and enforces publish-before-start with a typed error.
- `task-attachments`: PASS; unchanged public document-reference and task update contracts.

## Receipt drift cause

The drift was edit-after-receipt sequencing across earlier fix rounds. A receipt was generated, more code was then committed, and the older receipt was left in the tracked evidence set. That made the committed evidence collection contain proofs for older code revisions. This fix removes those stale receipts, generates one fresh receipt only after the final code commit, and makes every later change evidence-only.

## Attestations

1. **Fresh checks:** every reported final-code result was run after the last code edit and is bound by the receipt to `2e816538ca8e53d4c191f26f5f5de2014075fb94`. `[attest: yes + 2e816538ca8e53d4c191f26f5f5de2014075fb94]`
2. **Scope:** every code touch is within the authorized workflow foundation files (`workflowLive.ts`, the public `crm-workflows` index, the feature-owned workflow-template store, and its focused consumer test); evidence touches only refresh the required receipt and handoff. `[attest: yes]`
3. **Guard integrity:** no test, guard, assertion, type, timeout, snapshot, baseline, or manifest was weakened. `[attest: yes]`
4. **Contracts:** the public export is the minimal typed workflow-template lifecycle/store surface; durable templates and instances use only the existing canonical encrypted live-record path. `[attest: yes]`
