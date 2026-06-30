# 2026-06-22 — Work Reconciliation & Plan (three streams)

**Branch:** `keepance-3.0` @ `48e0dfe` · tree clean · pushed · gates green (vitest 3718 / cargo 597 / typecheck).

This document reconciles **two separate handoff prompts** that landed at the same time:
1. A **Windows QA / bug-chasing** handoff from the previous implementation session.
2. A **marketing-driven product** handoff (two new missions) from a parallel marketing session.

Its job is to (a) record both, (b) record the verified ground-truth state, (c) lay out the
sequencing options, and (d) record the chosen plan. Plain-language summary for Jameson is at the bottom.

---

## The three bodies of work

### Stream A — Windows QA (from the implementation session)
- **BUG-098 (headline)** — Windows cited answers were 100% broken. **FIXED at the TypeScript layer
  (commit `237d0d4`) and live-verified green on the Legion bench.** The deeper Rust fix was reverted
  (`e11d421`) because forcing a full re-index exposed BUG-099 below. Rust tree is back to original.
- **BUG-099 (open, robustness)** — a full RAG index **stalls at "20/21 files"**; one file never finishes.
  Pre-existing. Normally tolerable (store already built from a prior run, app stays usable, that one file
  is just missing from search). Only became *fatal* (memory runaway → crash) under the **reverted** forced
  rebuild — so the shipped/normal build does **not** crash. Lives in Rust (`src-tauri/src/commands/rag/`).
- **Re-land BUG-098 Rust dedup (deferred)** — internal cleanup (store one copy per file, not two). No user
  impact today. Blocked on BUG-099 + a memory-safe re-index migration. Rust.
- **P4 (verification chore)** — re-confirm matters create/archive on Windows. TypeScript/UI. Not a known bug.
- **BUG-062 (separate, open)** — workspace-boundary/symlink-escape security cluster from the 06-21 audit.
  Rust-heavy, "do-not-rush" focused effort. Not a Windows regression, not blocking.
- **Verdict:** **Stable with robustness gaps — NOT a crisis.** The user-facing fire is already out in code.
  The bulk of remaining work is **Rust in `src-tauri/`** and needs **no Jameson input**.

### Stream B — Mission 1: "Start on your own" bottoms-up wedge (from marketing)
Spec: `docs/superpowers/specs/2026-06-18-bottoms-up-wedge/` (README, 01-design, 02-impl-plan, 03-copy-deck,
00-START-HERE). Let an individual safely download and use Advisor Prep Hero alone, and make that the path into a firm sale.
- **Phase 1 — Safe-by-default (the crux, 4 tasks).** Personal (non-firm) installs cannot send client text
  to a cloud AI until the user makes an explicit, logged, informed choice. Local retrieval/search/citations
  keep working out of the box. Medium size, fully specified with code. Net-new file:
  `src/platform/privacy/resolvePersonalEgressDefault.ts`. Change point: `egress.ts` default `'direct'`.
- **Phase 2 — Honest first-run onboarding (1 task, small).** One-screen informed choice + honest trust
  sentence. Hard dependency on Phase 1's choice-recording setter.
- **Phase 3 — One-click firm security pack PDF (1 task, medium).** Net-new `FirmSecurityPack.tsx` for IT/GC.
  Independent of Phases 1/2.
- **Phase 4 — Solo-to-firm bridge (1 task, medium-large, riskiest).** Carry a solo user's local matters into
  a firm workspace without duplicating data. Touches firm subsystem + matter store. Independent of 1-3.
- **Phase 5.1 — Frictionless trial + solo license recovery (1 task, small-med).** No-card, no-account,
  full-feature, **30-day** trial; solo recovery code. Recovery may already partly exist.
- **Phase 5.2 — website positioning → SKIP.** Owned by the marketing session. Do **not** touch `website/`.
- **Key facts:** **8 buildable tasks, 100% frontend/TypeScript/React, ZERO Rust, no collision with Stream A.**
  Phase 1 is the only hard prerequisite (Phase 2 depends on it); Phases 3/4/5.1 are independent.

### Stream C — Mission 2: Client Map (from marketing)
Net-new, larger, **needs a brainstorming interview with Jameson** (he is product owner). Spec dir
`docs/superpowers/specs/2026-06-22-client-map/` does **not** exist yet. Brand/names LOCKED: umbrella =
"private client intelligence," core object = "Client Map," sub-features = **Context Completeness**,
**Guided Client Interview**, **Firm Philosophy** (framed "stores and applies," never "learns"). The website
is already marketing this as "coming" — a real commitment to ship, but "coming" buys design time.

---

## Hard rules (apply to all streams)
- **No silent cloud fallback.** Personal installs never auto-egress. Firm installs unchanged — branch on `isFirm`/`useFirm`.
- **Local-first, matter isolation, confidentiality spectrum, BYOK are inviolable. AI proposes; the professional decides.**
- **Never claim "compliant."** There are tests asserting this.
- **Voice:** no em dashes (tested), no AI tells, first-person, concrete nouns. Marketing owns final wording; we build with copy-deck strings as written and don't pre-empt their harmonization pass.
- **No build/deploy cut without Jameson's explicit go** (commercial boundary).
- After any parallel-agent batch: re-check `git status` + grep for stray markers (a stray worktree has bitten this repo before).

---

## Sequencing options considered

**Option 1 — Hybrid parallel (RECOMMENDED).**
Foreground (Claude + Jameson): Mission 1 wedge now, **Phase 1 safe-by-default first** (it is both the wedge
crux and the integrity requirement the new website now implies), then Mission 2 Client Map (brainstorm →
spec → build). Background (Codex in an isolated worktree): Stream A robustness — BUG-099 investigation +
instrumentation + candidate fix + tests; final bench verification batched later.
- *Why:* honors Jameson's marketing-first hunch in the foreground; uses idle parallel capacity per the
  standing Codex rule; QA is Rust + needs no Jameson input + does not collide → ideal background track.
- *Risk:* must isolate the QA track in a worktree to avoid branch churn; BUG-099 final verification still
  needs the bench, so background work is investigation/fix-candidate, not full closure.

**Option 2 — Pure sequential (Jameson's literal hunch).**
Mission 1 → Mission 2 → then Stream A. Clean focus, but leaves the box idle on a QA track that needs no
human and could be progressing in parallel. Slower to fully close Windows.

**Option 3 — Stabilize-first.**
Finish Stream A to zero bugs, then marketing. Contradicts reality (headline already fixed), delays honoring
the live website promises, and risks rat-holing on BUG-099. Not recommended.

---

## CHOSEN PLAN
**CONFIRMED by Jameson 2026-06-22 = Option 1 (Hybrid parallel).**
1. **Foreground:** Mission 1 wedge via `superpowers:subagent-driven-development`, Phase 1 → 2 → (3 ∥ 4 ∥ 5.1).
   Gates green per task; commit per task; Codex review before merge.
2. **Background:** one isolated Codex/worktree track on BUG-099 (per-file index logging → identify the
   stalling file → time-box/skip-on-failure the indexer → regression test). Watched with the liveness rule.
3. **Then:** Mission 2 Client Map — brainstorming interview with Jameson, spec, plan, build.
4. **Separate decision flagged to Jameson:** the last *published* build (v3.3.0) still has the broken-citation
   bug; the fix exists but is unshipped. Cutting a new signed build is his explicit-go call. Low urgency
   given ~zero current users, but he should know.

---

## Progress log (2026-06-22 session)
Branch keepance-3.0. Mission 1 build via subagent-driven-development (ledger: `.superpowers/sdd/progress.md`).
- **Phase 1 (safe-by-default) COMPLETE + pushed.** Personal installs never send to a cloud AI for generation
  until an explicit choice. Tasks 1.1-1.4. Two Codex adversarial passes + SDD reviews closed ~7 bypasses and
  one over-gate. One subagent FABRICATED a result (caught by independent verification; redone by hand).
- **Phase 2 (honest first-run onboarding) COMPLETE + pushed.** Informed-choice screen (Local-only / Cloud BYOK
  / Decide later) wired to the recorder; firm seats bypass to the unchanged setup. Task 2.1.
- **Phase 3 (firm security pack PDF) COMPLETE + pushed.** FirmSecurityPack.tsx for IT/GC; review caught + fixed
  a truthfulness issue (Assured proxy honestly disclosed as not-yet-GA per DPA §6.4). Task 3.1.
- Gate green throughout; HEAD pushed; ~3815 vitest pass.
- **BUG-099 background track (Windows QA): Codex hardening DONE in worktree `.worktrees/harden-rag-indexer`,
  NOT merged — needs lead review + Windows-bench verify.**

### Remaining (not yet built)
- **Phase 4 (Task 4.1) — solo-to-firm bridge + matter carry-over.** The riskiest/biggest build phase (touches
  firm subsystem + matter store). Independent of 1-3.
- **Phase 5.1 — frictionless trial + solo license recovery.** Small.
- **Phase 5.2 — website — SKIP (marketing owns).**
- **Mission 2 — Client Map.** Net-new, larger; REQUIRES a brainstorming interview with Jameson before building.

## Plain-language summary for Jameson
- The scary Windows bug (answers not showing where they came from) is **already fixed and proven** on the
  test laptop. What's left there is small and behind-the-scenes.
- The website is now promising two things: people can **use Advisor Prep Hero safely on their own**, and a **Client
  Map** is coming. The product needs to make both true.
- **Recommendation:** build the "use it safely on your own" features first (they make the new website honest),
  then sit down together to design the Client Map. Meanwhile let the second AI engineer (Codex) quietly finish
  the small leftover Windows reliability gap in the background, since it doesn't need you and won't get in the way.
- Heads-up: the version people can download today is still the **older** one with the citation bug. The fix is
  ready but not packaged into a new release yet. That's your call to make, and not urgent.
