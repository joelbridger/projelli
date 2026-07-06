# The 3× Demo Dry-Run — Legion, frozen tip `273183da`

**Date:** 2026-07-06
**Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`)
**Tip (frozen for this run, exact SHA):** `273183da` — "coordination: STATUS endgame entry + dry-run brief + session-9 briefs batch 2"
**Worker:** cc-lantern-legionverify

## Result: STOPPED after Run 1 — a real, unscripted failure at Step 4 (Local AI)

Per the brief's explicit rule ("One failure = stop, report precisely, await the coordinator — do NOT grind retries"), Run 1 is reported as a clean **FAIL** and the dry-run is paused here rather than proceeding to runs 2 and 3.

**0/3 clean runs completed. 1 run attempted, failed at Step 4.**

**Update — autopsy completed, root cause found (not wedged, too slow):** at the coordinator's request I checked the local engine directly rather than just through the app UI. The `llama-server` process was alive and healthy the whole time (`/health` → `{"status":"ok"}`, model loaded). Its own log showed the "failed" request had actually been quietly completed by the engine in **81.7 seconds** (70.5s prompt eval on ~4,500 tokens + 11.2s generation) — the UI's own patience window was much shorter than that, so it gave up and showed a false "couldn't get an answer" error while the real answer was still being computed underneath. A third live retry of the identical question, given a full ~90 seconds this time, **succeeded cleanly in ~50 seconds** with a correct, cited answer (screenshot `run1-06`). **Root cause: too-short UI patience for how long local answers genuinely take on this laptop, not a broken engine.** A fix (`lp/localai-patience`: prompt-size-scaled patience + an honest "still thinking" message) is in flight. App has been reset back to Cloud AI / Network Lockdown off (normal state) to stand by for the fix.

**Runbook note for whoever owns the script:** the runbook should tell the presenter plainly that **local (on-this-computer) answers can take 1-2 minutes on this laptop, and that's normal** — it's a real CPU-bound wait, not a malfunction. Once the patience fix lands, the app itself will say so on screen; until then, a presenter watching the current error message would reasonably (but wrongly) conclude Local AI is broken.

---

## Prep (done once, before Run 1)

- Pulled to `273183da`, rebuilt via the correct `LanternPlusDev` scheduled task (`C:\run-dev-lantern.bat` → `cd C:\lantern-plus && npm run tauri:dev`) — **note:** the `KeepanceDev` task seen in earlier rounds is stale/broken (points at an empty `C:\keepance` folder); `LanternPlusDev` is the real one.
- Deleted all 9 leftover test meeting recordings under The Hendersons (matches the frozen runbook's new checklist item). This triggered the RAG index's "sanity breaker" (mass-deletion safety guard) on the next boot — required one extra clean restart before the workspace was in a normal state. Not a bug; a side effect of my own cleanup, resolved before Run 1's clock started.
- Confirmed sidebar clean (3 real households only, no archived bleed-through) on a *proper* restart via `LanternPlusDev` — this further supports downgrading QA-83 (from `legion-staging/REPORT.md`) as likely a restart-methodology artifact, not a real regression.
- **Self-inflicted, corrected before timing Run 1:** while clicking through Settings, one of my stray clicks accidentally toggled Network Lockdown ON. Caught and reverted before it affected anything — noting only so the record is honest, not as an app finding.

## Run 1 — timing + verdicts

| Step | Verdict | Notes |
|---|---|---|
| Prep checklist | PASS | Sidebar clean, 3 clients/3 folders indexed, crib sheet ready, Local AI shows "Installed and ready," leftover meetings cleared. |
| Checkpoint: Step 1 "✓ Working" persisted checkmark | **PASS** | Manage AI Account Keys dialog showed both OpenAI and Anthropic as "✓ Working — checked 5 hr ago" with **zero re-clicking**. Screenshot `run1-01`. |
| Step 4 — Cloud AI half | **PASS** | Asked "What is the Hendersons' target asset allocation?" (This-client scope) — correct, fully cited answer, green "Answered over your own files" attestation. First attempt in a fresh conversation needed one "Allow file access" grant (expected per-conversation consent, not a failure). Screenshot `run1-02`. |
| Step 4 — Local AI half (checkpoint #3) | **FAIL** | Switched to "On this computer only" (Network Lockdown auto-enabled as scripted, correct). Asked a throwaway warm-up question — it failed ("couldn't get an answer... may still be downloading or loading," screenshot `run1-03`). Per the script, this alone would be an acceptable, scripted absorption of a cold-start hiccup. But the subsequent **real** crib question (a fresh, separate ask) **also failed the same way** (screenshot `run1-04`) — the runbook's script only accounts for one throwaway failure before the real question succeeds; it does not cover the real question failing too. This is an **unscripted recovery point** per the brief's rule, so Run 1 stops here. |

**Diagnostic detail (not root-caused further — that's a fix-round question, not an evidence-gathering one):** Settings → AI & Privacy shows the Local AI card as **"✓ Installed and ready"** the whole time (screenshot `run1-05`) — so per the app's own status indicator, nothing was actually downloading or loading. Two consecutive real inference attempts still failed to return an answer. `tauri-dev.log` has no local-AI-specific error lines around either failure (the failure surfaces only in the UI, not in this log stream).

## What this means for the checkpoint list

1. Step 1 checkmark persistence — **verified live, holds.**
2. Step 3 PDF-kit indexing banner — **not reached this run** (stopped at step 4 before getting there).
3. Step 4 cold-start fix — **does not hold** in this run: the fix was supposed to make failures rare enough that one scripted warm-up absorbs them; here it took more than one attempt and the run had to stop rather than silently retry past what the script covers.
4. Step 5 persistence / step 6 transcript — **not reached this run.**
5. Outlook — not reached; still known-pending per the standing NEED-JAMESON item.

## Evidence
6 screenshots in `screenshots/`, named `run1-0N-...` for the story each supports (`run1-06` is the successful third-try autopsy retry).

## State left on the Legion
- App running at tip `273183da`, reset back to **Cloud AI mode, Network Lockdown off** (normal state) after the autopsy.
- Sidebar clean, 3 real households, no leftover test meetings.
- **Standing by** for the `lp/localai-patience` fix to merge. Per the coordinator: once it does, rebuild and restart the 3x dry-run from Run 1 on the new tip — all 3 runs must be on the same final tip.
