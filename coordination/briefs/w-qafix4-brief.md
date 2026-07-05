# Build brief — QA fix batch 4: duplicate-client isolation breach (QA-24 P1) + Ask discarded on client switch (QA-25) + inconsistent new-doc buttons (QA-26)

**Lane:** cc-lantern-qafix4 · dir `~/lp-qafix4` (own worktree, branch `lp/qa-fix-batch4`). **Model:** Sonnet 5 · high.
**Rules:** NO-SHORTCUTS on QA-24 (client isolation is the product's core promise). TDD. Stay in your lane — do NOT touch: `useMemoryWiring.ts` (qa19fix owns it), `src/platform/browserGuard/` + App gate wiring (webguard owns), the meetings list/load path (meetpersist owns). If a fix genuinely needs one of those files, STOP and ask (`COORDINATOR:`). Self-converge via `codex-review --base origin/lantern-plus`. Unique dev-server port. No interactive menus.

## Repro evidence
BUG-DB QA-24/25/26 + `coordination/qa-campaign/evidence/qa4-20260704/` (27 screenshots, full steps in the qa4 lane-detail section).

## Scope
1. **QA-24 (P1, isolation breach):** double/triple-clicking "Create client" creates multiple client records that silently SHARE one on-disk folder — files created in one duplicate are invisible in its own Documents view. Fix robustly at BOTH layers: (a) the dialog/button must be idempotent (disable-while-submitting / debounce so one submission can't run twice); (b) the deeper hole — client creation must guarantee a unique folder binding (name-collision → unique suffix or a hard duplicate-name check with honest UI), so no two client records can ever silently share a folder, however they were created. Tests for both layers (double-submit race; name-collision path).
2. **QA-25 (P2):** submitting an Ask question then immediately switching clients silently discards the question — no error, no processing state, no history entry. Decide the honest behavior (recommended: the in-flight ask completes and lands in that client's history, with the UI showing it as processing when you switch back; if a clean continue is genuinely impossible, an explicit "question cancelled by client switch" state — NEVER silent loss). Mind the consent/privacy-heavy paths — scope the change narrowly; if it forces deep surgery in useChatSending.ts, implement the honest-cancel option and note the deeper fix as a follow-up.
3. **QA-26 (P3):** toolbar "New document" creates instantly with a generic name; empty-state "+ New Word document" opens a naming dialog. Make them consistent (recommended: both open the naming dialog — matches the trust-building "Creating in: <path>" pattern).

## Gate + handoff
Red-first tests. `npx tsc --noEmit` · `npm run i18n:check` 0 · full `npx vitest run` · eslint-gate · Rust-touched ⇒ cargo (own CARGO_TARGET_DIR=$HOME/.cargo-target-lp-qafix4, timeout 1200, one cargo box-wide). PULL origin/lantern-plus into your branch and reconcile BEFORE handoff (the tip moves fast today). Handoff: HEAD SHA, gate counts, decisions + trade-offs, Rust yes/no, self-review rounds. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/qa-fix-batch4`
