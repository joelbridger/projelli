# Demo Dress Rehearsal — Pass 1 (steps 1, 2, 3, 4, 6 — step 5 skipped)

**Date:** 2026-07-06
**Bench:** Legion Windows laptop, tip `781db953` (frontend-identical to `f7847f63` — the STATUS.md-only commit on top)
**Method:** followed `docs/demo/DEMO-RUNBOOK.md` **literally, in order**, as a first-time presenter would — the prep checklist top to bottom, then each demo step's exact "What to do" list, using the crib questions from `docs/demo/DEMO-QA-CRIB.md` verbatim. Every click and answer was timed with a wall clock. Step 5 (Record Meeting) was explicitly skipped per instructions — its fix was still building.

## One-line verdict per step

| Step | Verdict |
|---|---|
| Prep checklist | **PASS overall, but item 7 ("✓ Working" checkmark) is unreliable — see finding #1** |
| Step 1 — Connect AI | **PASS with a real script gap** — the checkmark isn't where the script implies (finding #1/#2) |
| Step 2 — Connect Data | **FAILS AS WRITTEN for this workspace** — only 2 of the 3 promised connections are actually connected (finding #3) |
| Step 3 — Progress Screen | **UNRELIABLE** — the exact crib-style banner did not appear on any of 3 trigger attempts (finding #4) |
| Step 4 — Ask | **PASS for Cloud AI; Local AI failed on first try, needed a retry** (finding #5), and switching AI modes is not the quick in-context action the script implies (finding #6) |
| Step 5 — Record Meeting | SKIPPED (per instructions — fix in flight) |
| Step 6 — Search Transcript | **NOT TESTABLE this round** — no real meeting transcript exists yet (finding #7) |

---

## Timing table

| Step | Wall-clock start | Wall-clock end | Duration | Notes |
|---|---|---|---|---|
| Prep checklist (items 1-6, verify only) | 04:57:29 | 04:59:33 | ~2m | All 6 already true in this workspace — instant to confirm |
| Prep checklist item 7 (ChatGPT key check) | 04:59:33 | 05:02:10 | ~2m37s | Multiple failed "Check" attempts before one succeeded — see finding #1 |
| Prep checklist item 8 (restart + warm-up) | 05:04:10 | 05:06:24 | ~2m14s | 1m44s restart, 5s warm-up answer — this part worked exactly as scripted |
| **Prep checklist total** | 04:57:29 | 05:07:48 | **~10m19s** | Inflated by the key-check flakiness investigation; a lucky first-try run would be ~4min |
| Step 1 — Connect AI | 05:08:03 | 05:10:03 | ~2m | Inflated by discovering the checkmark isn't on the main screen; a scripted click-through would be ~20-30s |
| Step 2 — Connect Data | 05:10:17 | 05:13:25 | ~3m8s | Mostly spent scrolling to check each of the 3 connections' real state |
| Step 3 — Progress Screen | 05:13:25 | 05:20:25 | ~7m | Three different trigger attempts (Wealthbox sync, OneDrive sync, direct file drop), chasing the promised banner |
| Step 4 — Ask | 05:20:45 | 05:37:19 | ~16m34s | Cloud AI half was instant (5s); Local AI half needed a full Settings round-trip + a failed first attempt + retry |
| Step 6 — Search Transcript | — | — | not run | Blocked on no real transcript existing (Step 5 skipped) |

**Total rehearsal time: ~41 minutes**, but a large share of that is *investigation* overhead (screenshotting, scrolling to verify, retrying) that a live presenter wouldn't spend — the estimates above separate "what actually took this long" from "what a presenter would experience." The single biggest real risk to on-stage timing is Step 4's Local AI first-attempt failure (finding #5): if that happens live, a presenter loses ~20-30 seconds to a visible error before a retry succeeds.

---

## Findings (in the order I hit them)

### Finding #1 — The "✓ Working" checkmark does not reliably stay set, even without restarting the app
The checklist's item 7 says to "ask it one test question to make sure it says yes, working," and Step 1 says to "point at the little ✓ Working checkmark." In practice: I verified both OpenAI and Anthropic as "✓ Working" once, then **just closing and reopening the "Manage AI Account Keys" dialog ~2 minutes later showed both back to "Unverified"** — with no app restart in between. Re-clicking "Check" fixed it again immediately in that instance, but the "Working" state does not appear to persist anywhere beyond the currently-open dialog. This means a presenter who checked the key in prep, then opened Settings live during Step 1, will very likely see "Unverified" again on stage unless they click Check again in that exact moment. Screenshots: `01-aikeys-unverified-after-restart.jpeg`, `02-aikeys-both-working-checklist-complete.jpeg`.

### Finding #2 — The checkmark isn't on the screen the script says to open
Step 1's "What to do" says: "1. Open the app's AI settings screen. 2. Show ChatGPT is already connected — point at the little '✓ Working' checkmark." Opening Settings → AI & Privacy (the obvious "AI settings screen") does **not** show any per-provider checkmark — only a generic "Cloud AI (your account) ✓" mode-selection badge. To reach the actual "OpenAI (GPT) ✓ Working" text, you must scroll down and click a separate "Manage AI Account Keys" button, which opens a dialog on top. The script doesn't mention this extra click. Screenshots: `03-step1-checkmark-not-on-main-screen.jpeg` (what you see first), `04-step1-checkmark-after-extra-click.jpeg` (what you have to click through to get to).

### Finding #3 — Step 2 is not true for this specific demo workspace: only 2 of 3 connections are live
Step 2 says: "Show the three example connections already made: Outlook, OneDrive, and Wealthbox." Checked all three in Account → Connections:
- **Microsoft 365 (Outlook): NOT connected** — shows a "Connect Microsoft 365" button, no prior connection at all.
- **OneDrive and SharePoint: Connected.** ✅
- **Wealthbox: Connected.** ✅

A presenter following the script would open this panel expecting to point at 3 green "Connected" states and find only 2. Screenshots: `05-step2-outlook-not-connected.jpeg`, `06-step2-onedrive-connected.jpeg`, `07-step2-wealthbox-connected.jpeg`.

### Finding #4 — Step 3's exact crib example ("Indexing PDFs: 6 of 6...") did not appear on any of 3 tries
Tried three different ways to trigger the "Progress Screen" moment:
1. **Wealthbox "Sync now"** (already connected) → completed with 0 new items, no visible progress screen ever appeared (too fast to catch, if it appeared at all).
2. **OneDrive "Sync now"** (already connected) → this one DID show a real progress line, but it was **"Importing... 0 items checked"** — a different message than the crib's PDF-indexing example — and it's only visible **inside the Connections dialog itself**, not on the main content area where the crib's example was presumably meant to be pointed at. It also completed with 0 new items (this OneDrive account isn't actually backing any of the 3 demo households with real cloud files). Screenshot: `08-step3-onedrive-importing-0-items.jpeg`.
3. **Dropping a fresh file directly into an existing client's folder** (closest analog to how I actually observed the "Indexing PDFs: X of Y" banner during earlier QA-92 testing) → the file was picked up into the Documents list within ~35 seconds, but no progress banner was caught on the main content area in that window — it likely completed too fast for a single small file to be visibly "in progress."

**Bottom line: for THIS demo workspace, there is no reliable, repeatable way I found to produce the exact banner the script's example describes.** The good news: the script's own "If something goes sideways" table already anticipates this exact failure mode ("Import looks stuck or finishes instantly... Say: 'This one was quick'") — so the contingency is sound, it's just that the *primary* path in the "What to do" section doesn't reliably work as written in this environment. Recommend either pre-arranging a guaranteed-slow trigger (a larger batch of real files behind a connector) or leaning on the already-written contingency as the expected path, not a fallback.

### Finding #5 — Local AI's first answer after switching modes can fail and require a retry
Step 4.3 says "Switch to Local AI and ask the same or a different short one-fact question." I did exactly that with a short, pre-written crib question. **The first attempt failed**: "Advisor Prep Hero couldn't get an answer — it may still be downloading or loading the local model. Check its status, then try again." (Screenshot: `09b-step4-localai-first-attempt-failed.jpeg`.) Clicking Ask again (no other change) succeeded ~20 seconds later with the correct, cited answer (`10-step4-localai-q-succeeded-after-retry.jpeg`). This is the **second time** I've reproduced this exact pattern in this environment (once in an earlier prep session, once here) — it looks like a real, repeatable "cold start" tax the first time Local AI is asked anything after switching TO it, even though the model itself shows "Installed and ready" in Settings the whole time. The script's own contingency table doesn't cover this specific case (it covers "shows an error instead of Working" for the connection check, not "the first live question after switching fails"). Recommend either warming up Local AI with a throwaway question immediately after switching (before going live with the real one), or adding this exact failure to the sideways-table.

### Finding #6 — There is no in-context way to switch AI brains; it's a full trip to Settings
Step 4.3's "Switch to Local AI" reads like a quick in-flow action. In this build there is **no model picker on the Ask screen itself** — switching requires: Settings gear → AI & Privacy tab → click "On this computer only" card (which also silently turns on Network Lockdown) → navigate back to Ask. That's 3-4 clicks and a full screen change, not a toggle next to the question box. Worth the script explicitly walking through this path rather than implying it's a one-click switch, so a presenter isn't caught navigating live.

### Finding #7 — Step 6 could not be tested this round
Step 6 needs a meeting with a real, non-empty transcript, which only Step 5 (skipped this round, per instructions — its fix is still building) produces. Checked the transcripts of all prior test meeting recordings under The Hendersons (from earlier QA-91 testing) — all have `"segments": []` (empty), since those were silent automated test attempts with no one talking. **Step 6 needs to be rehearsed in a follow-up pass once Step 5 is back in scope**, ideally reusing whatever real meeting the next QA-91 retest produces (if it succeeds and has real speech in it).

---

## What worked exactly as the script says (no notes needed)
- The prep checklist's items 1-6 (workspace, clients, sidebar, file indexing, crib sheet, Local AI download) were all already true and instantly verifiable — including the sidebar fix, confirmed clean.
- The full-restart + warm-up-question checklist step worked exactly as described — a clean restart, then an instant, correctly-cited warm-up answer.
- Step 4's Cloud AI question: instant (5 seconds), completely correct, with a working, clickable citation exactly as the script describes.

## Evidence
All 12 screenshots referenced above are in `screenshots/`, named to match the finding they support.

## State left on the Legion
- App running, Cloud AI mode (restored after the Local AI test), tip `781db953`, Beacon Ridge Demo workspace.
- One extra file left in The Hendersons' Documents: `Dress Rehearsal Live Drop.txt` (harmless test artifact from the Step 3 investigation — safe to delete before the real demo, or leave, since it doesn't appear anywhere in the crib questions).
- Both AI keys currently show "✓ Working" (rechecked as part of this rehearsal) but per finding #1, don't rely on that lasting — re-check live before the actual demo.
