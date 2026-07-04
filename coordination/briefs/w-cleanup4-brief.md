# Build brief — cleanup batch 4: docx keep-alive (residual save-race) + CrmWriteReviewCard test flake

**Lane:** cc-lantern-cleanup4 · dir `~/lp-cleanup4` (own worktree, branch `lp/cleanup-batch4`). **Model:** Sonnet 5 · high.
**Rules:** NO-SHORTCUTS on item 1 (save integrity). TDD. Codex self-review foreground/watched. PULL + reconcile before handoff. Unique dev-server port.

## Item 1 (task #24) — docx-editor keep-alive for dirty tabs
qafix5's QA-34 fix (merged @9e87a8c2) left one honestly-flagged residual race: switching tabs away from an actively-FAILING docx save unmounts DocxEditor and reloads from disk on return, which can drop the in-memory dirty content the save was still retrying. The persistent-failure warning + rescue-copy guard it today, but the airtight fix is keeping a dirty docx tab's editor state ALIVE across tab switches until its save actually succeeds (don't unmount/reload-from-disk while dirty+failing). Read qafix5's DocxEditor changes + docxSaveRegistry first. Implement keep-alive for dirty tabs; test: switch away from a failing-save tab and back → no content loss, save still retrying, state intact.

## Item 2 (task #31, QA-42) — CrmWriteReviewCard.test.tsx flake
Pre-existing race between a resolved mock and the resulting DOM update (unrelated to the chunk-load flake flakefix already killed). Stabilize it (await the DOM update properly / deterministic mock resolution) — no product-behavior change. Prove with repeated runs.

## Gate + handoff
tsc · typecheck:tests 0 · i18n 0 · full vitest · eslint-gate. Handoff: item-1 approach + test, item-2 root cause, gate counts, self-review rounds. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/cleanup-batch4`

## Landmines
Item 1 is DocxEditor-owned now (qafix5 merged) — yours. Don't touch capture/meetings (regression + other lanes), useAsk/cloud-send (Tier C P1 staged there). No interactive menus.
