# Worker brief — QA-85: "Verified" badge must mean verified

You are **cc-lantern-qa85**, worktree **~/lp-qa85**, branch **lp/qa85-verified-badge** (off a4046edd). Frontend TS lane, trust-core. You do NOT merge; the coordinator merges.

## The problem (Codex investigation complete — verify, then build)
Full findings: `/tmp/claude-1000/-home-jameson-lantern-plus/cbf813e9-0636-4dab-94c6-c1621a39686c/scratchpad/codex-qa85.log` (read the last ~8KB). Summary:
- Ask sets `verified: inExpectedMatter && grounding === 'explicit'` at `src/features/ask/askHelpers.ts:1055` — i.e. "the model wrote a citation marker that resolved to a retrieved chunk in the right client". That is NOT verification of the claim.
- UI then says "Verified against source" (`src/features/ask/SourcePanel.tsx:22,302`) and "Every cited claim can be checked against the source" (`AnswerBlocks.tsx:167`, `TurnBlock.tsx:204`).
- A REAL backend checker exists and is unused by this path: `rag_verify_citation` (`src-tauri/src/commands/rag/verify.rs`) — checks chunk id + client id + that the stored chunk text actually contains the quoted text. The Ask smart path binds citations from groundingHits without calling it (`useAsk.ts:1112`).

## The fix (robust, no shortcuts — this is core trust UX)
1. **Wire the real checker in:** after citations bind, call the backend verifier (batch if a batch command exists; otherwise per-citation with sensible concurrency) and set each citation's verified state from the REAL verdict. Async is fine: render the citation immediately in a neutral "Source found" state, upgrade to "Verified against source" when the verdict returns, degrade to the amber "source found · not verified" style on failure. No blocking of answer streaming.
2. **Honest copy everywhere:** green pre-verdict state says "Source found" (or the existing neutral style); "Verified against source" appears ONLY on a real verified verdict. Replace "Every cited claim can be checked against the source" with "Every cited claim has a source you can open and check." Keep the existing amber post-hoc state. Check ALL render sites the log cites (AnswerBlocks.tsx, SourcePanel.tsx, TurnBlock.tsx) + saved-answer reload paths (askHelpers.ts:1450,1474 — reloaded answers must NOT resurrect stale verified flags without re-verification).
3. Browser dev (non-Tauri) has no backend: fall back gracefully to the "Source found" state, never fake-verify.
4. i18n: update strings the way neighboring Ask strings do (i18n gate in CI).

## Method
TDD: Vitest tests for (a) citation starts as source-found, upgrades on verified verdict; (b) failed/unavailable verdict never shows "Verified"; (c) reloaded saved answers re-verify rather than trust stored flags. Keep the diff scoped to the Ask feature + a thin invoke wrapper. Do NOT rename `matter_id`/`Matter`. Do NOT touch the Rust verifier unless a batch entry point is genuinely missing and trivial to add (if you add one: `cargo test` for it).

## Done criteria (HARD)
1. Tests red→green with real output; `npx tsc --noEmit` green; scoped `npx vitest run` green (+ `cargo test` if Rust touched).
2. Committed AND pushed (`git push -u origin lp/qa85-verified-badge`; `--no-verify` only for unrelated pre-push asset failures — say so).
3. THEN print exactly: `WORKER-DONE: lp/qa85-verified-badge` + 5-line summary (what verifies now, what copy changed, any gaps left).
