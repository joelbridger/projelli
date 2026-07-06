# Bench-1 Demo Rehearsal — cc-lantern-bench1

**Bench:** `lantern-cloud-bench-1` (Azure, `100.75.247.98`)
**Tip tested:** `381462f3484a5febcec51348f9a7ec24c6fbd924` (branch `lantern-plus`, includes the demo sample workspace merge)
**Date:** 2026-07-06
**Driver:** `scripts/desktop-drive.mjs` over SSH (DESKTOP_CDP_PORT=9223), same mechanism as `bench-smoke.mjs`, driven manually/interactively rather than via the automated checklist (this was a rehearsal, not a `bench-smoke.mjs` run).

Steps rehearsed: **1, 2, 3, 4, 6** (step 5 — meeting recording — is out of scope for cloud VMs per the brief; no real audio device).

---

## Scorecard

| # | Step | Result | Evidence |
|---|------|--------|----------|
| 1 | Connect AI (OpenAI + Local AI) | **PASS** | OpenAI key already saved on this VM from a prior session; clicked "Check" → **"✓ Working"** (`demo-28-checked.jpeg`). Local AI shows **"Installed and ready. Pick 'Advisor Prep Hero Local AI' as your model in any chat"** (`demo-26-scrolled.jpeg`) — confirms QA-90's "pre-download the ~2.4GB model, never live" concern is already satisfied on this bench. |
| 2 | Connect Data (Outlook, OneDrive, Wealthbox) | **MIXED** | **Wealthbox: PASS** — already connected from a prior session; clicked "Sync now" → real consent dialog **"Import 40 Wealthbox households"** → confirmed → Client Map grew from 13 → **53 clients** with real household names (Abernathy, Brennan, Caldwell, Castellano, …) (`demo-38` through `demo-43`). This is a genuine end-to-end connector→import→Client Map proof.<br>**Outlook (Microsoft 365): CANT-TEST** — clicking "Connect Microsoft 365" launched a real `msedge.exe` process (confirmed via `Get-Process`) for OAuth sign-in. This is a system browser window outside the WebView2 CDP bridge this harness drives — no way to complete the Microsoft login headlessly on this VM (no keyboard/screen-driving tool like the Legion's `legion_agent.py` is installed here).<br>**OneDrive: CANT-TEST** — not yet connected on this VM; same OAuth mechanism as Outlook (`demo-44-onedrive.jpeg`), not attempted further since the wall is already confirmed. |
| 3 | Progress Screen | **PASS** | Saw a real live progress banner: **"Indexing PDFs: 6/6. Nothing leaves your machine."** (`demo-19-postok.jpeg`) while the app indexed a newly-pointed-at folder, and a **"Syncing…"** state on the Wealthbox connect button during the 40-household import. Both are real, working progress indicators. |
| 4 | Ask (ChatGPT + pre-existing files) | **BROKEN — reproduces known QA-92** | Scoped Ask to **"Emily Chen Household"**, a client that has been registered in this workspace since before this session, with real files already in its folder. Asked: *"What documents do you have for this client? Summarize what you find."* Answer: **"I wasn't able to find any specific documents for Emily Chen Household in the current context provided"** — a general-knowledge fallback with **no citations** (`demo-33`, `demo-34`). This is a clean, direct reproduction of QA-92 (pre-existing files not searchable) via OpenAI, no test-methodology artifacts involved. Per the brief, not re-investigating — QA-92's fix is already in flight. |
| 6 | Search Transcript | **NOT INDEPENDENTLY VERIFIED (blocked by QA-92)** | No real meeting/transcript was recorded this session (step 5 out of scope for this cloud bench). Transcript search shares the same Ask/RAG file-search path just shown broken for pre-existing files in step 4, so it would hit the same wall for any transcript file that predates the app opening its folder. Did not fabricate a separate test — flagging as blocked-by-same-root-cause rather than claiming a fresh PASS/FAIL. |

---

## Additional finding: workspace-switch friction (separate from QA-92, root cause unconfirmed)

I deployed the newly-merged demo sample workspace (`docs/demo/sample-workspace/`, 3 fictional households) via `scripts/deploy-demo-workspace.mjs` to `C:\Users\lpbench\Documents\Beacon Ridge Wealth Advisors` and tried to switch the app to it, to use the known-answer questions in `docs/demo/DEMO-QA-CRIB.md`.

Two legitimate in-app paths were tried:
1. **Recent Projects list** (header dropdown → a workspace entry) — selecting the row updated the header label but the Client Map/Ask "whole practice" scope kept showing the old workspace's clients (confirmed via a 30s+ wait and a captured-console-errors check — no errors thrown).
2. **Open Existing → native folder-picker → 90s watchdog fallback → manual "Type the folder path" prompt** (a real, documented code path, `QA-32` in `WorkspaceSelector.tsx`) — typing the path and clicking OK **did** trigger real background PDF indexing ("6/6" matches the sample workspace's exact PDF count), confirming the root path did change at the file-index level. But the Client Map's client list never picked up the 3 new households as registered clients, and "whole practice" Ask reported **"12 clients"** in its consent dialog (the old count) and then "no clients in your book match that question."

I could not confirm whether this is a real defect (workspace-switch not fully propagating to the Client Map/matter list) or expected behavior (opening a workspace does not auto-register pre-existing subfolders as "clients" — that might always require an explicit "+ New client" action per folder, which I didn't have time to try for the 3 sample households). Flagging for the coordinator's judgment rather than filing a ticket myself. This blocked using the demo sample workspace's crib-sheet questions for this rehearsal; step 4's finding above was instead confirmed against the existing QA Workspace's "Emily Chen Household" client, which is an equally valid (arguably cleaner) reproduction of QA-92.

---

## Not tested
- Step 5 (Teams meeting recording) — explicitly out of scope per the brief (no real audio device on this cloud VM).
- OneDrive/Outlook full connect flow — blocked by real OAuth requiring a system browser, which this headless VM has no way to drive (would need a Legion-style `legion_agent.py`/pyautogui equivalent installed here, which does not currently exist for this bench).

## Bench state at end of session
- Repo on `lantern-plus` @ `381462f3`, working tree clean on the VM.
- Wealthbox now shows 53 clients imported (real sandbox data) in the currently-open "QA Workspace" — this is a durable change to the bench's persistent state for future sessions to be aware of.
- App left running (`lantern.exe` / CDP port 9223 up) per instructions not to deallocate the VM.
