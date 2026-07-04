# Worker brief — QA fix batch 2: AI-hang UX + onboarding overlaps (QA-7, QA-8, QA-9)

**Lane:** cc-lantern-qafix2 · worktree `~/lp-qafix2` · branch `lp/qa-fix-batch2`. **Model:** Sonnet 5 · high. TS/CSS only (no Rust expected). tdd.
Findings + evidence: `coordination/qa-campaign/BUG-DB.md` (QA-7, QA-8, QA-9) + `coordination/qa-campaign/evidence/qa1-*/` screenshots. Reproduce first.
**File-scope discipline:** a sibling lane (qafix1) owns the Ask surface (`src/features/ask/`) and new-client/matter creation — do NOT touch those. You own onboarding + the Ask *loading/answer* state machine's user-feedback layer only. If QA-7's fix would touch the same Ask files qafix1 is editing, coordinate via the coordinator (flag it) rather than colliding.

## QA-7 (P1) — asking with local AI can hang on "Answering…" forever, no feedback
Symptom: a question can spin on "Answering…" indefinitely (30s+), no error, no timeout, no messaging — even when the real cause is a stalled local-model download (the app self-reported "The download looks stuck" elsewhere but the Ask spinner never surfaces it). Root cause may be environment-specific, but **the silent-forever-spinner UX gap is the real, in-scope bug**.
- Fix the FEEDBACK, not the model download: the Ask answer flow needs a visible timeout / progress signal and an error state. After a reasonable wait with no token, surface "This is taking longer than expected — the local model may still be downloading/loading" with a link to model status, and after a hard ceiling, a real error with a retry — never an infinite silent spinner. If a model-download-stalled signal already exists in the app, wire it into the Ask waiting state.
- Add a test for the state machine: no-progress → warning state → error/retry state (fake timers).

## QA-8 (P2) & QA-9 (P2) — onboarding splash overlaps
- QA-8: first-run onboarding splash decorative icon graphics overlap and obscure card text ("builds Client Maps", "Ask anything, with sources" illegible). 4 screenshots incl. genuine cold first-run.
- QA-9: the model-download progress banner overlaps the onboarding step header text ("2. Securely connect your data", "3. Setting up your firm" garbled behind it) at 9/49/93% progress; only during onboarding, not in the main app.
- Fix the layout/z-index/spacing so text is always legible over/around decorative graphics and the progress banner never overlaps step headers (reserve its own space / push content down). Light theme. Match the app's existing onboarding design language.
- Add bench-mirror Playwright specs asserting the key onboarding text nodes are visible + not overlapped (bounding-box non-intersection) at a couple of viewport sizes.

## Rules
Light theme; plain user-facing copy (client/meeting, never matter). Gates: scoped vitest red→green, full `npx vitest run` + `npx tsc --noEmit` + eslint-gate; Playwright specs you add. Codex self-review per fix (cap ~3; if codex-review keeps getting killed under fleet load, note it — coordinator's independent review is the gate). Push; do NOT merge. Evidence per QA id. Last line exactly: `WORKER-DONE: lp/qa-fix-batch2`
