# Keepance 3.0 Full-Vision Quality Campaign (umbrella plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take Keepance 3.0 from "launched with known defects and an unreachable Firm tier" to "full vision working, exhaustively tested by an attorney persona, every found defect fixed, v3.1.0 release candidate ready for Jameson's publish go."

**Architecture:** Three sequenced efforts. (1) Fix the 8 founder-confirmed bugs on a green baseline. (2) Build the missing Firm desktop layer (shared-matter lifecycle, member/seat/org management, live collaboration, purchase-to-provision) against the already-live backend at api.keepance.com, developed against a local backend instance. (3) Run one comprehensive usability campaign on the feature-complete product: Diane Marchetti persona protocol + firm scenario, mechanical every-control sweep against a coverage ledger, native Tauri pass, then triage, fix wave, and v3.1.0 RC.

**Tech Stack:** React 18 + TS strict + Vite + Zustand + Tailwind/shadcn; Tauri 2 (Rust, in-house keepance-docx OOXML engine, SQLCipher); Bun firm backend (Ed25519 seats, Yjs E2EE relay, zero-retention proxy); Playwright 1.58 (`?testMode=true` harness, 871 data-testids); Vitest; LemonSqueezy.

**Approved scope decision (Jameson, 2026-06-10):** the full vision must work before launch; Firm desktop wiring is mandatory now, not a later cycle. Product stays live-but-unpromoted until he declares launch.

---

## Phase map and sub-plans

| Phase | What | Detailed plan |
|---|---|---|
| 0 | Fix the 8 confirmed bugs, regression test each | `2026-06-10-phase0-known-bug-fixes.md` (written, execute now) |
| 1 | Firm desktop wiring WS-1..WS-5 to the firm exit gate | `2026-06-10-phase1-firm-desktop-wiring.md` (author at phase start, after loading `backend/src/contract.ts`, `spikes/firm-sync/DECISION.md`, `src/modules/firm/*`) |
| 2-3 | Campaign harness + fixtures + coverage ledger (overlaps Phase 1) | `2026-06-10-phase2-campaign-harness.md` (author at phase start) |
| 4-6 | Persona study + mechanical sweep + native pass | `2026-06-10-phase4-usability-campaign-runs.md` (author when product is feature-complete) |
| 7 | Triage, fix wave, v3.1.0 RC, launch-readiness report | checklist in this file, detail after findings exist |

Authoritative full campaign description (context, rationale, verification, Jameson gates): `~/.claude/plans/you-re-my-ceo-of-sparkling-planet.md` (approved 2026-06-10); key content mirrored across the sub-plans so each is self-contained.

## Standing gates (every merge point)

```bash
npx tsc --noEmit                      # must be clean
npm run test                          # vitest, 2528 passing baseline (2026-06-10)
cd src-tauri && cargo test            # all green, incl. matter-isolation adversarial tests
cd backend && bun test                # 104 passing baseline
```

Plus: the no-em-dash user-facing-copy test, light theme only, first-person-singular voice.

## Phase 7 checklist (expanded once findings exist)

- [ ] All findings triaged in `docs/quality/2026-06-10-v3-usability-campaign/findings.md` (P0-P3)
- [ ] Every confirmed bug fixed with a failing-test-first regression
- [ ] Stale docs reconciled (root `CLAUDE.md` still documents v1 pricing and "no collaboration" scope)
- [ ] `CHANGELOG.md` `[3.1.0]` written
- [ ] Version bumps: package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml → 3.1.0
- [ ] Tag `v3.1.0`, CI release workflow green, signed artifacts + latest.json in draft release
- [ ] Website updates staged (Firm card → real self-serve purchase once provisioning proven)
- [ ] Launch-readiness report + notify-jameson
- [ ] JAMESON GATES: publish release, deploy site, declare launch
- [ ] Post-publish: Jameson 5-minute Windows spot check (icons, new-docx typing, workflow layout, upload with spaces, Open on Desktop, firm sign-in)

## Jameson involvement (none until the end, unless automation loses)

1. Possibly one 2-minute LemonSqueezy dashboard task (Firm multi-seat variant) if Chrome automation fails on the picker again.
2. End gates above.
3. Optional: M365 test account for the device-code email flow (IMAP fixture covers the flow without it).
