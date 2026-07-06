# Legion QA-91 Live Retest — Round 3 — Notice Card at tip bb3d68a1 (launcher fix, 3 layers)

**Date:** 2026-07-06
**Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`)
**Tip verified:** `bb3d68a1` (URL-rewrite to skip the Teams launcher chooser, `webjoin=true` fallback, click-through safety net)
**Method (new this round):** a genuinely separate second human-style participant — Chrome **Guest mode**, launched on the Legion's own local desktop via the pyautogui agent (not SSH, which lands in the wrong Windows session) — joining the same live Teams meeting as "Sarah Morgan (guest observer)." This solves the "single shared server Chrome profile" limitation disclosed as unsolved in rounds 1 and 2.

## Headline result: nuanced, not a clean PASS — read the whole thing before repeating the verdict

**The literal test the coordinator asked for was met: YES.** A real second participant, in her own separate browser, on her own screen, saw a visible, readable "Recording Notice (Guest)" tile join the meeting after being admitted. Screenshot `09-DEFINITIVE-PROOF-tile-visible-from-guest.png` is the proof — this is the first time in this whole QA-91 saga that has happened.

**But it does not hold.** ~29 seconds after that same admission, the app's own detection logic decided the join had failed, closed the Notice Card's window, and it left the meeting — the tile that had just appeared **vanished again**, and the app told me (the presenter) "Notice card couldn't join," even though it had, and a real attendee had already seen it.

**So: this is not "all six demo steps green."** It is a major breakthrough (the three fix layers do exactly what they were built to do — get the card past the launcher, into the lobby, and admitted, live, with a real second person watching) plus one new, precisely-located bug that would still make Step 5 look broken on stage: the card would flicker in and vanish, and the presenter's own screen would show a false failure message right when they're trying to calmly point at the tile per the script.

---

## What happened, in order

### Attempts 1–2 this round: proving the card now reaches the lobby (solo, no second participant yet)

Before setting up the guest browser, I ran two solo attempts (host only) to confirm the launcher fix works at all:

| Attempt | Meeting dir suffix | Started | Failed | Duration | Reason |
|---|---|---|---|---|---|
| 1 | `-7` | 05:47:55.616Z | 05:49:55.618Z | exactly 2:00 | `join-timeout` |
| 2 | `-8` | 05:52:31.601Z | 05:54:31.604Z | exactly 2:00 | `join-timeout` |

Both timed out at **exactly 2:00**, not the earlier rounds' ~29s `page-unrecognized` — meaning the card got past the launcher and prejoin and sat in the lobby the full timeout with nobody there to admit it (I was still setting up the guest browser). Screenshot `01-attempt7-host-waiting.jpg` and `02-attempt7-host-waiting2.jpg` show the host view with a "1 person with new activity" badge during this window; `03-attempt7-timedout-left.jpg` shows the state after it gave up and left. **This alone confirms layers A/B/C work** — the card no longer dies at the launcher chooser page like it did in round 2.

### Attempt 3 this round: the real 2-person test

- Launched a genuinely fresh Chrome **Guest mode** window on the Legion's own desktop (via the pyautogui agent, `legion_agent.py` — SSH-launched processes land in the wrong Windows session and are invisible to this tool). Screenshots `04`–`06` show the guest browser launching, entering the name "Sarah Morgan (guest observer)," and reaching "ready to join."
- Started a fresh recording attempt from the app at **05:59:47.680Z** (meeting dir suffix `-9`).
- Joined the guest browser into the same live meeting.
- Confirmed via the **host's** Participants panel (screenshot `07-host-BOTH-waiting-in-lobby.jpg`) that both were simultaneously "**Waiting in lobby (2)**": "Recording Notice (Guest)" and "Sarah Morgan (gues... (Guest))," each with explicit Admit/Deny buttons.
- Admitted both at **06:00:48** (`chrome-cdp click-xy` on each Admit button).
- Guest browser screenshot `08-guest-admitted-joining.png` shows the moment of joining.
- **`09-DEFINITIVE-PROOF-tile-visible-from-guest.png`** — captured ~16 seconds into the guest's own view: three tiles — Sarah Morgan (black, camera off), **"Recording Notice (Guest)" on a light mint tile with a person icon, clearly labeled and readable, not black** — and Jameson Daines (host). This is the exact criterion the coordinator asked for, met.
- Checked the app's own recorder widget at this point: it still showed recording in progress, one line partially visible reading "...card waiting to be let in" (stale — it hadn't yet caught up to the admission).
- **`.consent-ledger.json` for this attempt:** `notice-context` at `05:59:47.680Z`, `notice-card-failed` at **`06:01:16.585Z`**, reason **`page-unrecognized`** — **1:29 after the notice-context timestamp, ~28 seconds after the 06:00:48 admit.** So the app's own success/failure detection did NOT recognize the real admission and gave up anyway, on its own separate ~29s clock.
- **`10-tile-disappeared-29s-later.png`** — the guest's own view, ~1:34 into the call: People count dropped from 3 to **2**, the "Recording Notice (Guest)" tile is **gone**, and the app's floating widget behind the browser now reads "...oin. Say the notice aloud" (i.e. "Notice card couldn't join. Say the notice aloud.") — the app force-closed the companion window and told the presenter it failed, despite the card having genuinely joined and been seen moments earlier.

### One more thing observed, not previously reported: stale "Leaving..." ghost entries

The host's participants panel (`07-host-BOTH-waiting-in-lobby.jpg`) also showed **two additional "Recording Notice (Guest)" rows already inside the meeting marked "Leaving..."** at the same moment a fresh one was still waiting in the lobby — leftover companion-window instances from the two solo attempts a few minutes earlier that hadn't fully cleaned up from the Teams meeting's own roster yet. Not investigated further; flagging in case it's relevant to whoever fixes the admitted-phase detection (there may be more than one companion window instance alive at once across attempts).

---

## What this proves about the 3-layer fix

| Layer | What it does | Verified this round? |
|---|---|---|
| A — URL rewrite to skip launcher | Rewrites `teams.live.com/meet/...` straight to the `/v2/` route | **Yes** — the card never got stuck on the browser-vs-app chooser page in any of 3 attempts this round (that was the round-2 failure) |
| B — `webjoin=true` fallback | Carried in the rewritten URL in case a redirect still bounces through the launcher | Not separately distinguishable from A this round — no launcher page was ever seen, so it wasn't needed as a fallback |
| C — click-through safety net (`dismissLauncher`) | Clicks "Continue on this browser" if the launcher does appear | Not exercised — never needed, per above |

**Conclusion: the card now reliably reaches the lobby and, when admitted, genuinely joins and is visible to a real attendee.** This is a first for QA-91.

## The new bug (not previously reported): admitted-phase detection doesn't recognize a real admission

Across all three same-session Notice Card fixes to date, each one has hit a wall at a *later* stage than the last:
- Round 1 (4cafb72f): generic `page-unrecognized`, no visibility into why.
- Round 2 (f7847f63): proved it never got past Teams' launcher/chooser page.
- Round 3 (bb3d68a1): the launcher is now handled — but proved the card **can be genuinely admitted and become visible, and the app still doesn't know it**, timing out on its own ~29-second clock and reporting `page-unrecognized` again (a different meaning of that same failure string this time — not stuck on the launcher, but stuck on whatever DOM state it expects *after* admission, which this join flow doesn't produce).

This is a new, narrower target for the next fix: whatever selector(s) `detectPhase` uses to recognize `'admitted'` don't match the real post-admission page for this join flow (anonymous/guest join via the rewritten `/v2/` URL). The same pattern that was fixed for the prejoin/lobby phases in earlier rounds likely needs to be repeated for the admitted phase.

## Filed as BUG-DB QA-82 (see `coordination/qa-campaign/BUG-DB.md`).

---

## Honest verdict

- **The coordinator's literal screenshot-based PASS criterion: MET.** A real second participant saw a visible, non-black, clearly labeled "Recording Notice (Guest)" tile.
- **NOT "all six demo steps green."** A live presenter following the script would see the tile appear, then vanish about 30 seconds later, while their own app tells them it failed — the opposite of "point at it calmly," and a visibly broken moment on stage.
- **Recommend one more fix round** (admitted-phase selector fix, same playbook as the last two rounds) before Step 5 is safe to run live. Given the pattern (launcher → prejoin/lobby → now admitted), this looks like the last remaining stage, not a new open-ended problem.

## Evidence
All 10 screenshots are in `screenshots/`, named and numbered in chronological order with the story in each filename. Consent-ledger excerpts are quoted inline above (not separately screenshotted — structured JSON already legible as text).

## State left on the Legion
- App running at tip `bb3d68a1`, Cloud AI mode, Beacon Ridge Demo workspace, 3 clients (sidebar fix still confirmed live from round 2).
- Recording for attempt `-9` already auto-stopped by the app itself when the notice card gave up; confirmed no recording still in progress.
- The Legion's local Guest-mode Chrome window (Sarah Morgan) is still open at end of this report — safe to close, contains nothing sensitive (guest/anonymous session, no login).
- Meeting recordings from all 3 attempts this round (`-7`, `-8`, `-9`) sit under The Hendersons' Meetings tab — left as-is as evidence, same as prior rounds; happy to clean up on request.
- `qa91c3host` chrome-cdp session (server's shared Chrome, used as meeting host/organizer) still open — safe to close.
