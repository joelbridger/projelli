# cc-lantern-benchverify — bench-1 scorecard (2026-07-05)

**Target:** Azure cloud Windows bench `lantern-cloud-bench-1` (100.75.247.98)
**Tip verified:** `origin/lantern-plus` @ `b1794baf` (merge: lp/qa71-delete-guard)
**Mission:** independent smoke pass #2 of 3 (stability proof) + highest-value adversarial trust-breaker stress.

## Part A — Clean smoke pass #2 of 3

| Step | Result | Evidence |
|---|---|---|
| Bring bench to tip, build, launch, confirm real UI | **PASS** — relink in 43s (no `src-tauri` diff since VM's prior commit), CDP port live, real "Advisor Prep Hero" UI with existing QA Workspace (9 clients) rendered | `00-tip-launch.jpeg` |
| Create client | **PASS** — "Benchverify Smoke Run2" created, appears in sidebar + Client Map immediately | `01-client-created.jpeg`, `02-client-opened.jpeg` |
| Create .docx, type, autosave | **PASS (with caveat — see QA-80)** — document created and typed content renders; content **does** persist to disk, but only once the user navigates away from the document, not on a steady timer (see Part B) | `04-doc-created.jpeg`, `05-typed.jpeg` |
| Close & reopen (full app restart), verify content survived | **PASS** for content that had been navigated-away-from before restart (confirmed byte-identical) | `06-after-restart.jpeg`, `07-content-survived.jpeg` |
| Ask a question | **PASS** — real answer returned, correctly labeled "General guidance · verify current rules" (no file access granted, so correctly not file-cited) | `13-ask-response.jpeg` |
| Open Meetings tab | **PASS** — clean empty state ("No meetings yet"), no crash | `14-meetings-tab.jpeg` |
| Final full app restart, confirm still boots clean | **PASS** — 10 clients, 10 folders indexed, no crash/blank/hang | `32-final-clean-boot.jpeg` |

**Verdict: PASS overall**, no crash/blank/hang anywhere in the smoke flow — this is stability-proof run #2 of 3. One real, serious save-integrity gap was found along the way (below) — it does not manifest as instability, but as **silent data loss**, which is the more serious trust-breaker category.

## Part B — Adversarial trust-breaker stress

The originally-planned test was: hold an OS-exclusive lock on an open document while typing, confirm the app surfaces an honest failing state (not a false "Saved"), release the lock, confirm the content persists. While setting this up, I found something more fundamental that made the literal lock scenario moot on this tip — **filed as QA-80** (see `coordination/qa-campaign/BUG-DB.md`):

**A brand-new Word document's typed content is only actually written to disk when you navigate away from it — not on a steady autosave timer — and an abrupt app termination (crash / forced restart / power loss / Task Manager "End task") during that window loses the content permanently, with the toolbar showing "Saved" (idle) the whole time and zero rescue backup created.**

Verified three separate times (three different fresh documents), with disk-level confirmation (not just UI):
1. Typed real keyboard content (Playwright `keyboard.type`, not synthetic DOM events) into a fresh doc. Waited 30+ seconds — `auto-save-indicator` stayed `idle`/"Saved" throughout; the on-disk `.docx` never changed (confirmed via `python-docx`/zip inspection of `word/document.xml` — still the empty-paragraph skeleton).
2. Repeated on a second fresh doc, force-killed `lantern.exe` (`Stop-Process -Force`) ~5 seconds after typing — well past the 1200ms `SAVE_DEBOUNCE_MS` constant in `DocxEditor.tsx`. On relaunch: document opened **completely empty**, confirmed both in the UI and via the raw `.docx` on disk. **No `.backup-*.docx` rescue snapshot exists** for a document that was never actually saved once — compare to sibling documents where I *did* navigate away first, which have both an updated `.docx` and a `.backup-<timestamp>.docx`.
3. This reproduces the exact "said Saved, lost everything" class from QA-34/QA-43, but via an ordinary crash/reboot/power-loss trigger — no adversarial file lock needed at all. This is a broader, more likely real-world trigger than the antivirus-lock scenario QA-34/43 fixed, and it directly contradicts `TRUST-BREAKER-LOCKDOWN.md`'s "SAVE bucket largely done" status.

Evidence: `05-typed.jpeg` (typed), `08-check-state.jpeg`/`09-state-check.jpeg` (idle "Saved" after 30s+, disk unchanged), `11-crash-loss-evidence.jpeg` (post-force-kill relaunch, empty document).

**Secondary observation (lower confidence — not filed as a standalone bug):** while investigating, double-clicking to open a document that was *already* under an exclusive OS lock (before any open attempt) appeared to silently no-op (no error, stayed on the file list), compared against the same open mechanism succeeding immediately on an unlocked sibling file. This was observed while several stray automation processes were still attached to the same CDP session (see Landmine below), so I'm not confident enough in isolation to file it — flagging for a follow-up lane with cleaner tooling.

**What I could not cleanly complete:** the literal "type while a lock is actively held, watch the UI show an honest failing/retry state" repro. Environment/tooling issues (a stale file-tree row that stopped responding to double-click for one specific document, several stray background Node/Playwright processes left attached to the same CDP session from earlier steps) burned the remaining time budget for this pass. Recommend a follow-up bench session with a fresh CDP connection per step.

## Landmine for the next bench session

Scripts that call `getPage()` from `scripts/robot/connection.mjs` and don't explicitly call `process.exit(0)` at the end **do not terminate** — Playwright's CDP connection keeps the Node event loop alive, and the process is left running attached to the live browser session even after the SSH command that launched it appears to return. Running several such scripts back-to-back left 5+ zombie Node processes all issuing clicks/types against the *same* live app session concurrently, causing unpredictable navigation and click-target confusion. **Always end one-off verification scripts with an explicit `process.exit(0)`** (or `await browser.close(); process.exit(0);`), and check `Get-CimInstance Win32_Process | Where-Object Name -eq 'node.exe'` for stragglers before trusting a script's output.

## Bugs filed

- **QA-80** (P0, silent data loss, no adversarial condition needed) — see `coordination/qa-campaign/BUG-DB.md`.

## Bench state at handoff

- Repo at `C:\lantern-plus` on `origin/lantern-plus` @ `b1794baf`, working tree clean.
- App running cleanly (scheduled task `LanternDevBench`), CDP port 9223 live.
- No stray lock/zombie processes (verified clean before handoff).
- **Bench-1 should be deallocated (`az vm deallocate --resource-group lantern-bench --name lantern-cloud-bench-1`) once this evidence is reviewed** — it is still running as of this report to allow a coordinator to drive it further if desired.
