# Worker brief — QA fix batch 1: two first-run P1s (QA-5 client folders, QA-6 Ask layout)

**Lane:** cc-lantern-qafix1 · worktree `~/lp-qafix1` · branch `lp/qa-fix-batch1`. **Model:** Opus 4.8 · high (correctness + client-isolation-adjacent). tdd; robust-over-minimal (core-app rule). `timeout 1200` on cargo; CARGO_TARGET_DIR=$HOME/.cargo-target-lp-qafix1 (seeded) only if Rust needed.
Full findings + evidence: `coordination/qa-campaign/BUG-DB.md` (QA-5, QA-6) + `coordination/qa-campaign/evidence/qa1-*/`. Read those + reproduce BEFORE fixing.

## QA-5 (P1) — new clients have no folders linked; their documents look missing
Symptom: creating a client via "+ New client" links ZERO folders by default, so documents/imports land unscoped and the client's own Documents view shows "No documents yet" even though files exist. Breaks the client-isolation/"everything for this client in one place" promise on a first-time user's very first action.
- Investigate the new-client creation path (grep the "+ New client" flow → matter/client creation → folderPaths assignment). Find WHY a new client gets no folderPaths, and what the intended default is (a per-client folder created + linked under the workspace? a prompt to pick one?). This ties into matter.folderPaths (the isolation-critical field) — do NOT rename matter/matter_id.
- Robust fix: a new client should get a sensible default scoped folder (create-and-link a per-client folder under the workspace, or make the "no folder yet" state explicit and guide the user to link one — decide based on how existing seeded clients are structured; match that). Documents the user adds must land in the client's scope. Red-first test proving a freshly-created client has a usable, isolated document location.

## QA-6 (P1) — Ask input collapses to 0px at a normal window width
Symptom: `ask-composer-input` collapses to 0px wide and is non-interactable around 1028×749 (a normal laptop window); works at 1424px; the 3-column Ask layout clips instead of stacking at 600px. Ask is effectively unusable at a common window size.
- Investigate the Ask surface layout (`src/features/ask/` — AskComposer + the 3-column container). Find the flex/grid rule that lets the composer collapse (likely a missing min-width / a sibling column with no max, or a non-wrapping row).
- Robust fix: the composer must keep a usable min-width at all supported window sizes; the 3-column layout should degrade gracefully (stack/scroll) below its comfortable width, never clip the primary input. Add a test (vitest + a bench-mirror Playwright viewport spec at ~1028px and ~600px asserting the input is present and has non-zero width).

## Rules
Light theme; user-facing copy = client/meeting (never matter). Gates: scoped red→green, then full `npx vitest run` + `npx tsc --noEmit` + eslint-gate; cargo only if Rust touched (state it). Add bench-mirror Playwright specs for both (QA-6 especially — a viewport regression spec is the guard). Codex self-review per fix, cap ~3 rounds (if codex-review keeps getting killed under fleet load, note it and rely on the coordinator's independent review). Push; do NOT merge. Evidence handoff per QA id with exact outputs. Last line exactly: `WORKER-DONE: lp/qa-fix-batch1`
