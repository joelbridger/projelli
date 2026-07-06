# QA-92 Re-verify — cc-lantern-bench1

**Bench:** `lantern-cloud-bench-1` (Azure, `100.75.247.98`)
**Tip tested:** `5b4deaf6f2fd48b74f8327f8983975acdedd1f0f` (branch `lantern-plus`, includes `lp/qa92-preexisting-index` merge — "Ask finds pre-existing files")
**Date:** 2026-07-06
**Protocol:** per coordinator go-ahead — fresh workspace path, register clients via `+ New client` (no auto-registration assumed), run crib questions client-scoped, verify fresh-open and after close/reopen.

---

## Setup

1. Pulled bench-1 to `5b4deaf6` (fast-forward; rebuild ~5m17s, relink only — no dependency changes).
2. Deployed the Beacon Ridge sample workspace to a **fresh, never-before-opened folder**: `C:\Users\lpbench\Documents\Beacon Ridge QA92 Verify` (distinct from the earlier rehearsal's `Beacon Ridge Wealth Advisors` path — this guarantees a clean first-open index, not a warm cache from before).
3. Opened it via the real in-app flow: header workspace button → "Open Project" → "Open Existing" → native folder-picker's 90s watchdog timed out → the documented `QA-32` manual "Type the folder path" fallback appeared on its own → typed the path → OK. Confirmed via a live "Memory updating: 0/9 files" progress banner that indexing of the 9 pre-existing docx files began immediately on open.
4. Registered all 3 households as clients via **"+ New client"** (not assumed auto-registration): typed each client name exactly matching its folder name ("Dr. Priya Nair", "Maria & Luis Alvarez", "The Hendersons"). Each auto-linked to its matching pre-existing folder — confirmed via `data-checked="true"` on each folder-selection row in the Clients management dialog. Client Map went from 53→**56 clients**, 13→**16 folders indexed**.

## Fresh-open results (all 3 households, client-scoped "This client")

| Client | Question | Expected | Result |
|---|---|---|---|
| Dr. Priya Nair | Student loan debt + payoff plan | $178,400, PSLF, forgiveness 2029 | **PASS** — exact match, cited from *Financial Plan Summary - Nair.docx*, clean green "Answered over your own files" banner, no red badges |
| Maria & Luis Alvarez | Roth conversion amount | $40,000/year, 2025–2027 | **PASS** — exact match, 2 citations (*Financial Plan Summary* + *Meeting Prep Notes - Alvarez*), one marked **"✓ Verified against source"** |
| The Hendersons | First RMD due date + amount | April 1, 2027, ~$50,566 | **PASS** — exact match, cited from *Financial Plan Summary - Hendersons*, correct RMD math shown (IRA balance × Uniform Lifetime Table divisor) |

No red "Could not verify" / "Belongs to a different client" badges were observed on any of these three (the coordinator's flagged cosmetic-timing issue did not manifest here — all three were asked well after their respective indexing had settled).

## Close/reopen persistence test

- **First attempt** used a raw JS `location.reload()` to simulate reopening. This surfaced an unrelated error — **"Checking vault status timed out after 5s"** — that blocked the recent-workspace-row click from completing (confirmed via a captured `console.error`: `[WorkspaceSelector] Failed to open recent workspace: TimeoutError...`). This reproduced consistently on retry. I judge this a **methodology artifact, not a QA-92 regression or new bug**: a page-level JS reload restarts the frontend while leaving the Rust backend process running, which real users never do (they close/reopen the whole app). Flagging it here for visibility only — did not file it, did not re-investigate further, per scope.
- **Second attempt** (the valid test): killed `lantern.exe`/`cargo`/`node` processes and restarted the `LanternDevBench` scheduled task — a genuine full app relaunch, the same mechanism the VM uses on every real boot. The app **auto-resumed the exact same workspace** on its own (per the "Reopen last workspace" startup setting) — header showed "Beacon Ridge QA92..." and Client Map showed **56 clients / 16 folders** intact, confirming both the workspace path and the 3 client registrations persisted correctly to disk.
- Re-asked Dr. Priya Nair's question after this true restart: **PASS** — identical answer and citation as the fresh-open test ($178,400, PSLF, 2029, *Financial Plan Summary - Nair.docx*).

## Verdict

**QA-92 is confirmed FIXED.** Ask correctly finds and cites pre-existing, already-on-disk files for a newly-registered client, both immediately after first opening a fresh workspace and after a genuine close/reopen of the app. All 3 sample households tested clean, no partial/flaky results, no red verification badges.

## Evidence
32 screenshots (`qa92-01-*` through `qa92-32-*`) in this same evidence directory, documenting every step in sequence: workspace deploy → open → client registration → each Q&A → the vault-timeout dead-end → the true restart → the final re-verify answer.
