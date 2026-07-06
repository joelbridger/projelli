# Legion QA-92 Re-Verify — the demo machine proves the #1 fix

**Date:** 2026-07-06
**Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`), driven via CDP (`scripts/desktop-drive.mjs`) + pyautogui agent (`scripts/legion_agent.py`) for the native folder-picker dialog
**Worker:** cc-lantern-legionverify
**Tip verified:** `5b4deaf6f2fd48b74f8327f8983975acdedd1f0f` (merge: lp/qa92-preexisting-index — Ask finds pre-existing files, QA-92, #1 demo blocker)

## Summary

| Check | Result |
|---|---|
| Legion rebuilt to tip 5b4deaf6 | **DONE** |
| Fresh workspace deployed, opened as new workspace | **PASS** |
| 3 households registered as clients, folders mapped | **PASS** |
| Hendersons — docx question, cited | **PASS** |
| Hendersons — pdf question, cited | **PASS** |
| Alvarez — docx question, cited | **PASS** |
| Alvarez — pdf question, cited | **PASS** |
| Nair — docx question, cited | **PASS** |
| Nair — pdf question, cited | **PASS** |
| Acid test (full app restart, re-ask) | **PASS** |
| Local AI mode spot-check | **PASS** |

**Bottom line: QA-92 is fixed on the demo machine.** Every question was answered from a file that existed on disk *before* the app ever opened the workspace (deployed by `scripts/deploy-demo-workspace.mjs`, never touched by the app itself), with a correct, clickable citation back to that file. This held across cloud AI and local AI, and survived a full app close/reopen.

---

## Setup

1. **Legion repo was stale and off a different remote alias.** `C:\lantern-plus` was on branch `lantern-plus` at `2c0bd2f7` (88 commits behind `origin/lantern-plus`, pointed at the `keepance/keepance` GitHub alias which redirects to the canonical `lanternplatform/lantern`). The one local commit ahead of that base was already safely pushed upstream as `origin/lp/meetingnotegate-case-fix`, so `git fetch && git reset --hard origin/lantern-plus` was safe. Brought to `5b4deaf6`, ran `npm install` (package.json had one dependency bump), restarted the `LanternPlusDev` scheduled task (incremental cargo rebuild — small Rust diff in the RAG/reconcile/indexing modules — finished in a few minutes).
2. **Deployed the sample workspace to a brand-new path never opened by the app**: `C:\Users\james\Documents\Beacon Ridge Demo`, via `node scripts/deploy-demo-workspace.mjs`. Confirmed via `Get-ChildItem` that all 15 files (5 per household: signed advisory PDF, statement PDF, financial plan docx, IPS excerpt docx, meeting prep notes docx) existed on disk with real timestamps before the app ever touched the folder.
3. **Opened it as a new workspace** via the workspace switcher → Open Project → native folder picker (typed the path, since dialog navigation needs the pyautogui agent). App bound to it live — Rust log confirmed real `rag_index_workspace` runs against `C:/Users/james/Documents/Beacon Ridge Demo\...` for all 9 docx files (`work=9 reindexed=9 deleted=0 ... skipped=0, failed=0`), and PDF indexing completed (banner: "Indexing PDFs: 6 / 6").
4. **Registered all 3 households as clients** via **+ New client**, each mapped to its own subfolder (`The Hendersons`, `Maria & Luis Alvarez`, `Dr. Priya Nair`). Screenshots: `11-newclient.jpeg` through `14-clients-done.jpeg`.
   - Note: the client/matter roster is a global list (not reset by opening a different workspace) — the pre-existing Northcrest Wealth Partners client roster (42 clients from earlier test runs) stayed visible alongside the 3 new ones. This looks like intended design (clients are a manually-curated roster with folder pointers, confirmed by the in-app copy: "A client groups one client's work under one or more workspace folders"), not a QA-92 regression — but worth knowing for whoever runs the live demo, since old client names will still show in the sidebar.

## Core check — Ask answers from pre-existing files, with citations

Two questions per household from `docs/demo/DEMO-QA-CRIB.md` (one docx-sourced, one pdf-sourced, the second question hand-picked from content unique to each household's statement PDF to force a real PDF citation):

| Household | Question | Expected | Got | Source cited | Screenshot |
|---|---|---|---|---|---|
| Hendersons | Robert's first RMD due date + amount | Apr 1, 2027; ~$50,566 | Apr 1, 2027; ~$50,566 | Financial Plan Summary - Henderson.docx | `16-henderson-q1.jpeg` |
| Hendersons | Fidelity IRA beginning balance (10/1/2025) + YTD return | — | $1,247,905.10; 9.8% | Fidelity IRA Statement Summary - Q4 2025.pdf | `17-henderson-q2-pdf.jpeg` |
| Alvarez | Alvarez Family Taquerias appraised value | ~$2,100,000 | ~$2,100,000 (Meridian Business Valuations) | Financial Plan Summary - Alvarez.docx | `18-alvarez-q1-docx.jpeg` |
| Alvarez | Schwab account tax-loss-harvesting flagged positions | — | XLE -$4,120, KRE -$2,890 | Schwab Brokerage Statement Summary - Q4 2025.pdf | `19-alvarez-q2-pdf.jpeg` |
| Nair | Student loan balance + payoff plan | $178,400; PSLF, forgiven 2029 | $178,400; PSLF, forgiven 2029 | Financial Plan Summary - Nair.docx | `20-nair-q1-docx.jpeg` |
| Nair | 403(b) Q4 2025 contributions + ending balance | — | $9,200 contributions; $215,000 ending | Fidelity Statement Summary - Q4 2025.pdf | `21-nair-q2-pdf.jpeg` |

Every answer matched expected facts exactly, every citation chip was clickable and expanded to the correct source card in the right-hand "Sources · From your files only" panel, and most showed the green "Verified against source" badge. All 6/6 **PASS**.

**First-use consent gate:** each client's first Ask hit the "Let the AI search and open files on its own for [Client]?" consent gate (expected privacy-by-default behavior — "AI proposes, user decides"). Clicked "Allow file access" once per client, then all further questions for that client answered normally.

## Acid test — full app close + reopen — PASS

Fully killed the app process (`node`, `cargo`, WebView2) and restarted via the `LanternPlusDev` scheduled task — a real cold restart, not just a workspace re-open. On relaunch:
- App reopened directly on "Beacon Ridge Demo" (workspace persisted across restart).
- Re-asked a **new** question for Dr. Nair ("What disability insurance change are we discussing?") — answered correctly ($12,000/month → $15,000/month) with **2 clickable citations** (docx + meeting prep notes), no re-indexing delay, no re-consent prompt (per-client file-access consent also persisted).
- Screenshot: `22-acidtest.jpeg`.

This confirms the fix is durable across a restart, not just an in-memory session artifact.

## Local AI spot-check — PASS

Switched Settings → AI & Privacy → "On this computer only" (network lockdown auto-enabled, confirmed via the pink "Isolated client: outside connections are blocked" banner). Asked the crib's short single-fact Nair question ("What's Dr. Nair's target asset allocation?"). First attempt returned "couldn't get an answer — it may still be downloading or loading the local model"; the model was still warming up. Retried a few seconds later — answered correctly (55% US / 30% intl / 10% fixed / 5% cash) from `IPS Excerpt - Nair.docx`, "Verified against source". Screenshots: `23-localai-settings.jpeg`, `25-localai-answer.jpeg`. Restored to Cloud AI mode afterward (confirmed `confidentiality-mode-direct` `data-selected="true"`) so the bench is left in its normal default state.

## Coordinator's cosmetic-badge heads-up

The coordinator flagged a known, separately-tracked cosmetic timing issue: a citation can show a stuck red "Could not verify" / "Belongs to a different client" badge if checked while indexing is still in progress, and that this is not a QA-92 regression. **Not observed at all during this run** — indexing had finished (confirmed via the "Indexing PDFs: 6/6" banner and the Rust log's `DONE` line) before any question was asked, and every citation badge seen was green ("Verified against source" or "Answered over your own files"). No red/stuck badges to report.

## Testing-artifact note (not a product bug)

While creating "The Hendersons" client, an automation race (typing into the create-form's name field immediately followed by a click) caused the client to be created with the truncated name "The" and an accompanying empty "The" folder auto-created under the workspace. This was a driving artifact, not an app defect — the app itself did exactly what it was told with the text it received. Renamed the client to "The Hendersons" and deleted the stray empty folder before running any of the real checks above.

## Repo/build hygiene note

`scripts/legion-sync-launch.sh` still references the pre-fork path (`C:\keepance`) and task name (`KeepanceDev`) — stale since the `lantern-plus` fork/rename. Not touched in this evidence-only lane (out of scope), but worth a cleanup ticket so a future driver doesn't get bitten by it; `scripts/bench-smoke/targets.mjs` has the correct current values (`C:\lantern-plus`, `LanternPlusDev`) and was used instead.

## State left on the Legion

- App running at tip `5b4deaf6`, Cloud AI mode restored, network lockdown off.
- Workspace open: `C:\Users\james\Documents\Beacon Ridge Demo` (left in place — reusable for future demo/QA passes; the 3 households are cited above; the 3 households' client entries and the pre-existing Northcrest roster are both present).
- File-access consent granted for the 3 new clients (so a live demo won't hit the consent gate on stage).
