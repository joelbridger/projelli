# 2026-06-23 — NEXT SESSION handoff (Client Map v1 done)

## What happened this session
- Designed the **Client Map** WITH Jameson (one-question-at-a-time brainstorm) -> approved design spec.
- Wrote a 13-task TDD implementation plan and **built the whole thing** with subagent-driven-development (Sonnet implementers, per-task reviews, Codex on the crux + the final whole-branch review).
- **Merged to `keepance-3.0`** (merge `0ec8b8a0`). Full gate green; Codex final review = SHIP. **Nothing deployed** (no build cut — that is Jameson's explicit go).
- Independent Codex review of the leftover **Windows BUG-099** fix = **DO-NOT-SHIP as-is** (writeup: `docs/operations/2026-06-22-bug099-codex-review.md`); it stays unmerged.

## Current state
- Repo `~/keepance`, branch `keepance-3.0` @ `0ec8b8a0`, tree clean, pushed.
- Gate GREEN (`npm run gate`: typecheck 0 + i18n + full vitest + eslint + cargo).
- Client Map v1 LIVE in source (not deployed). Design + plan: `docs/superpowers/specs/2026-06-22-client-map/` (read the README there).
- SDD ledger (scratch, gitignored): `.superpowers/sdd/progress.md`.

## What the Client Map does (built)
A saved, per-matter, source-linked client profile built privately (on-device by default) from that matter's own files/emails: six core sections + Context Completeness (Thin/Getting there/Solid, no %) + user custom categories + reusable templates + a Guided Client Interview, with approve-first updates and sovereign user edits. Matter-scoped isolation throughout (Codex-confirmed). Opens from the matter view (`MatterHub`).

## NEXT STEPS (priority order)
1. **Jameson real-desktop smoke test of the Client Map** before anything else ships — drive it like a user on real Windows (open a matter, see the map build, add a custom section, save/apply a template, run the guided interview, accept an update). It is feature-complete in source but has NOT been exercised in the real signed app.
2. **Client Map v1 fast-follows** (small, documented in the spec README): route a source-link click to the EXACT file/chunk (extend the global launch event with a path arg + open the doc), and route Guided Interview answers to the right section instead of always `standing`.
3. **Mission 1 Phase 4 — solo-to-firm bridge + matter carry-over.** The riskiest build phase (firm subsystem + matter store). Brainstorm/plan first; slow down; verify.
4. **Mission 1 Phase 5.1 — frictionless trial + solo license recovery.** Small.
5. **BUG-099 robust fix.** Per the Codex review: on timeout/failure delete stale rows (no stale citations); surface skip counts to the UI; test blocking-work (not just async sleep); decide whether a true hard-kill needs process isolation. Then Windows-bench verify. Rust-only; do NOT re-apply reverted `f98aac6`. One cargo compile at a time on this memory-tight box.
6. **Client Map v2** (deferred): Firm Philosophy (firm-wide categories + guidance note + standard intake questions), advisor "household" unit, richer sections.

## Landmines / lessons (read before delegating)
- A subagent ran `eslint --update-baseline` and **absorbed real lint errors into `.eslint-baseline.json`** instead of fixing them. ALWAYS check whether a subagent touched `.eslint-baseline.json`; fix lint in code, never baseline it.
- Per-task gates were typecheck + scoped vitest + eslint-gate; the FULL `npm run gate` (i18n + whole suite + cargo) is the merge gate — run it before any merge.
- The plan built all components but under-specified the "wire everything into MatterHub" step; the final whole-branch Codex review caught the un-wired panels + the dormant approve-first flow. Always do a whole-branch integration review, not just per-task reviews.
- Hard rules that have tests / bit us: matter-scope only (never allMatters); no silent cloud egress (local-only forces Ollama; gate only on the cloud branch); user-origin items never AI-overwritten; NO em dashes in user-facing strings; never claim "compliant/guaranteed".

## Copy-paste prompt for a fresh session
```
You are continuing work on Advisor Prep Hero (~/keepance), branch keepance-3.0 @ 0ec8b8a0, tree clean, pushed,
gate green. Jameson is NOT a developer: plain language, explain like he's a smart 16-year-old; no jargon
dumps. Read these first: docs/operations/2026-06-23-NEXT-SESSION-clientmap-done.md (this file),
docs/superpowers/specs/2026-06-22-client-map/README.md, ~/keepance/CLAUDE.md (model/effort + voice rules).

DONE last session: the Client Map (Mission 2) is BUILT and MERGED to keepance-3.0 (a saved, private,
source-linked client profile per matter, with custom categories, templates, a guided interview, and
approve-first updates). Full gate green; Codex review = SHIP; matter isolation + no-silent-egress confirmed.
NOTHING is deployed (no build cut — that needs Jameson's explicit go).

NEXT (priority): (1) get Jameson to smoke-test the Client Map in the real signed Windows app before
shipping; (2) two small Client Map fast-follows (exact-source-link, interview answer routing); (3) Mission 1
Phase 4 solo-to-firm bridge (riskiest — brainstorm + plan first); (4) Phase 5.1 frictionless trial; (5) the
robust BUG-099 fix (Codex DO-NOT-SHIP writeup at docs/operations/2026-06-22-bug099-codex-review.md);
(6) Client Map v2 (Firm Philosophy, household, richer sections).

METHOD: superpowers:subagent-driven-development; implementer subagents on model "sonnet"; use Codex for
independent review (codex-task --read-only / codex-review) — it caught real integration bugs this round.
GATES: npm run typecheck (0); npx vitest run; node scripts/eslint-gate.mjs (run separately; NEVER
--update-baseline to hide new issues); npm run gate before any merge. Co-author trailer:
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>. Branch off keepance-3.0 for multi-step
work; merge when green. NO build/deploy without Jameson's explicit go.
```
