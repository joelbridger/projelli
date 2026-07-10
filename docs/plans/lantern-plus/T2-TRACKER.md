# Track 2 (Standing Plans) — Lane Tracker

**Lead:** Track-2 coordinator session, branch `lp/track2-standing` (worktree `/home/jameson/lp-track2`).
**Directive:** build every "planned" item on the feature tracker that doesn't depend on the intake program's rails, using Codex as the builder, this coordinator as reviewer/merger.

## Setup notes (read before touching a lane)

- `lp/track2-standing` was created off `lp/ux-simplify-v1` (tip `3939b96c`) and did **not** yet contain the three plan docs referenced in the brief — they exist only on the `lantern-plus` mainline branch (tip `7959344c`), not yet merged into this line. Cherry-picked the four **docs-only** commits so the specs are readable here:
  - `810de176` — ACATS plan (`docs/plans/lantern-plus/acats-autopilot/PLAN.md`)
  - `913fd47e` + `1fbd6c0b` — planning write-sockets plan (`docs/plans/lantern-plus/planning-write-sockets/PLAN.md`)
  - `1879b0aa` — integration honesty cards (`docs/trust/integration-cards/*.md`) — **this means the docs deliverable for item 3 is already done**; the remaining work is the in-app surface (see Lane C).
- **Known cross-track landmine:** `/home/jameson/lp-schwab-prefill` (branch `feat/schwab-prefill`, commit `e802d32d`) already contains a real Schwab account-opening prefill flow (`src/features/accounts/NewAccountFlow.tsx`, `accountApplication.ts`) — this is the "existing Schwab account-opening plan" the ACATS plan wants to compose with. It is **not merged** into `lp/track2-standing` and is owned by a different in-flight lane, not this track. Lane A (ACATS) must NOT merge or depend on that branch — build standalone, read-only-reference its field-map shape if useful, and leave the real Wave-D adapter as documented future work once that branch lands on the mainline.
- Only Lane B (write-sockets) touches Rust (`src-tauri/src/commands/writeback/`). Lanes A and C are TS/React-only. One cargo compile at a time box-wide (the intake session also builds) — Lane B retries on lock (exit 144) rather than fighting it.
- File-overlap check across the three lanes: disjoint by design (new feature folders + new Rust module). None of the three touch `AccountWindow.tsx` in this first slice (Lane B defers any new connector-settings UI since there's no live OAuth to wire up yet).

## Lane decomposition

### Lane A — ACATS Transfer Autopilot
- Worktree: `/home/jameson/lp-t2-acats`, branch `lp/t2-acats`
- Plan: `docs/plans/lantern-plus/acats-autopilot/PLAN.md`
- Scope for this build: Waves A–C in full (schema + research pack, statement extraction engine reusing existing PDF/OCR pipeline, advisor review UI), plus a standalone Wave-D-lite (Schwab Prep Packet export: copyable fields, checklist, statement-attachment reminder, official-form field mapping) that does **not** depend on the unmerged `feat/schwab-prefill` branch. Wave E (NIGO/onboarding-board wiring) and Wave F (Schwab partner API) explicitly deferred — E depends on the intake program's onboarding board (a different track), F is partner-gated with no sandbox access.
- Status: not started
- SHA / gate evidence: —

### Lane B — RightCapital / Holistiplan Write-Back Sockets
- Worktree: `/home/jameson/lp-t2-write-sockets`, branch `lp/t2-write-sockets`
- Plan: `docs/plans/lantern-plus/planning-write-sockets/PLAN.md`
- Scope for this build: Wave 0's non-code half (add RightCapital + Holistiplan rows to `docs/plans/lantern-plus/vendor-applications-checklist.md`) + Wave 1 in full (generic `ExternalWriteSocket` engine, ledger, queue, review-card prototype against **fixture/mock** targets — no live vendor calls, matching the "sandbox/mocks only" rule since we hold no RightCapital/Holistiplan credentials at all). RightCapital/Holistiplan-specific typed operations (`UpsertIncome`, `EnsureHousehold`, etc.) are stubbed behind the trait with mock-server-backed unit tests as a stretch goal, clearly marked partner-gated for live wiring. Waves 2–3 live sockets, Wave 4 research spike, and Wave 5 Wealthbox migration are out of scope for this pass (2–3 blocked on vendor access; 5 is a later cleanup).
- Status: not started
- SHA / gate evidence: —

### Lane C — Integration Honesty Cards (in-app surface)
- Worktree: `/home/jameson/lp-t2-honesty-cards`, branch `lp/t2-honesty-cards`
- Material: `docs/trust/integration-cards/` (TEMPLATE + 4 shipping cards already written and merged into this branch) + `docs/2026-07-10-advisor-pain-analysis-and-lantern-answers.md` §4 ("In-app, the connector shows the same card").
- Scope for this build: the docs are done. Build the in-app surface only — a shared `IntegrationHonestyCard` component/dialog with typed content (reads / writes / never-touch / gating / limits / last-verified) transcribed 1:1 from the four shipping cards (Wealthbox, Email, OneDrive/SharePoint, Calendly), triggered from each connector's row in Account → Connections (extends the existing `InfoHelp` affordance pattern). No new connectors, no vendor work.
- Status: not started
- SHA / gate evidence: —

## Merge order

No hard dependency between lanes — they land independently as each clears review + gate. Order of dispatch: A, B, C (parallel).

## Log
- 2026-07-10: tracker created, three worktrees created, docs cherry-picked, lanes about to dispatch.
