# Winsmoke QA-90 / QA-91 — Local AI Pre-Download + Real 2-Person Meeting Notice Card

**Date:** 2026-07-06
**Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`), driven via CDP + pyautogui agent
**Worker:** cc-lantern-winsmoke
**Second-participant tooling:** server's always-on Chrome (`chrome-cdp`), anonymous guest join

## Summary

| Job | Result |
|---|---|
| JOB 1 (QA-90): Local AI model pre-download verification | **PASS** |
| JOB 2 (QA-91): In-meeting Notice Card, real 2-person Teams meeting | **BROKEN — QA-91 filed** (confirms/strengthens QA-81) |

---

## Job 1 — Local AI pre-download (QA-90): PASS

The bundled Local AI model ("Advisor Prep Hero Local AI") was already fully downloaded on this bench from a prior session (~2.4GB, Qwen3-4B-Instruct-2507 Q4_K_M GGUF). Verified from three independent angles:

1. **Filesystem:** `C:\Users\james\AppData\Roaming\lantern\models\qwen3-4b-instruct-2507\Qwen3-4B-Instruct-2507-Q4_K_M.gguf` exists, size **2,497,280,736 bytes**, SHA256 matches `manifest.json`'s recorded hash exactly, `"status": "ready"`.
2. **In-app UI:** Settings > AI & Privacy shows the model card as **"✓ Installed and ready. Pick 'Advisor Prep Hero Local AI' as your model in any chat."** (`01-local-ai-status-fresh.jpeg`)
3. **Real test prompt:** Switched "Where AI requests go" to **"On this computer only"** (network lockdown auto-enabled — confirmed zero cloud calls possible), asked a real question via the Ask feature, and got a correct answer ("Hello, how can I help?") tagged **General guidance** with the expected privacy caveat. (`07-local-ai-mode-confirmed.jpeg`, `08-ask-local-mode.jpeg`, `10-local-ai-answer-wait2.jpeg`)

State was restored to Cloud AI (the app's default) afterward. **Nothing to report as broken** — since the model was already present, there was no live download to trigger this run, but the pre-download state itself is solid and demo-ready.

**Evidence:** `00-app-current-state.jpeg` through `11-restored-cloud-ai.jpeg`.

---

## Job 2 — In-meeting Notice Card, REAL 2-person Teams meeting (QA-91): BROKEN

This is the first time this feature was tested against a **genuinely live** Teams meeting with a **real second participant** (all prior tests used a non-live URL with no second party — see QA-81).

**Setup:**
1. Created a real, live Teams meeting via "Meet now" on `teams.live.com` (signed in as Jameson Daines), generating a real join URL.
2. Pasted that URL into the Legion app's "Record this meeting?" dialog, checked consent, started recording.
3. Joined the **same** meeting as a second, genuinely distinct participant — "Sarah Morgan (guest observer)" — via an anonymous guest join in a separate `chrome-cdp` browser session, admitted into the meeting by the host.
4. Confirmed via the in-meeting **Participants panel** ("In this meeting (2)": Sarah Morgan + Jameson Daines/Organizer) and the **meeting chat log** (only the default "was invited to the meeting" system line) that this was a real, live 2-person call.

**Result: BROKEN.** No notice-card bot/participant ever joined the meeting, and no recording notice ever appeared anywhere in the meeting UI visible to the second participant — a real attendee would have **zero indication** the call is being recorded. On the Legion side, the recorder widget showed "Notice card joining" for about 9 minutes, then updated to an explicit failure: **"Notice card couldn't join. Say the notice aloud."**

This is a different failure *presentation* than QA-81 (which hung silently forever with no error) but the same underlying failure — the notice card never actually joins the call. The two different presentations (silent hang vs. explicit failure after ~9 min) for what looks like the same root cause suggest the underlying WebView2-based join mechanism is flaky/non-deterministic, not a single deterministic bug.

**What did work correctly:** the actual audio recording and transcript/notes pipeline — captured cleanly for the full ~11 minutes, notes generated normally afterward. This bug is isolated to the "show a notice inside the call" mechanism, not the recording itself.

**Filed as QA-91** in `BUG-DB.md` (confirms and strengthens QA-81 with much stronger evidence — previously this could only be tested solo against a non-live URL).

**Evidence:** `17-record-meeting-dialog.jpeg` through `19-recording-started.jpeg` (Legion side, notice card "joining"), `20-guest-joined-2person-meeting.jpeg` / `21-host-view-2person.jpeg` (real 2-person roster), `22-legion-recorder-widget-check.jpeg` (explicit failure message after ~9 min), `23-guest-participants-panel-no-notice-bot.jpeg` (Participants panel, no notice-card bot), `24-guest-chat-no-notice-message.jpeg` (chat log, no notice message), `25-recording-stopped.jpeg` (recording/notes pipeline worked fine).

---

## State restored after testing

- AI provider mode restored to Cloud AI (the app's default before this run).
- Both Teams sessions (host + guest) left cleanly; `chrome-cdp` sessions closed.
- No lasting changes to Jameson's real Teams/Microsoft account state (signed back in is not needed — the host session used the already-signed-in account and was left cleanly via the meeting's own Leave button, not by signing out of the account).
