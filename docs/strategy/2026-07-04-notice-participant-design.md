# The Notice Card: a Local Notice Participant — Design for Seamlessness

*Jameson-directed 2026-07-04 ("exactly the right direction — think through how this integrates really well"). Fable 5 design pass by the Lantern-Plus coordinator. Builds on `2026-07-04-recording-notice-brainstorm.md` (the approved Notice Kit) — this is the Tier-2 flagship that follows it.*

## What it is, in one sentence

When the advisor records a meeting, a second participant — running entirely on the advisor's own computer — joins the call as **"⏺ Recording Notice — Sarah"**, showing every participant a card that says the meeting is being recorded and that the recording never leaves Sarah's computer; it leaves the moment recording stops.

**The reframe that makes it ours:** Jump's bot joins to carry your words to their cloud. Our participant joins to *tell you what's happening*, records nothing, sends nothing, and its departure even signals recording has ended. We never say "bot" — it's the **Notice Card**.

## The seamlessness bar

The advisor is at their most cognitively loaded right before a client meeting. The design target is: **zero new habits, at most one extra click (the lobby admit), and no failure mode that ever blocks or degrades the recording.** Notice Card failure falls back to the Notice Kit's verified verbal notice — the compliance floor is always intact.

## The golden path (what the advisor experiences)

1. Advisor clicks the record pill, as today.
2. The consent dialog (already the notice control center after the Notice Kit) shows one new line, **pre-filled from calendar sync**: *"📎 Henderson quarterly review — Microsoft Teams · Add the Notice Card to this meeting? [✓]"* (checked by firm default). No URL hunting, no setup — the app already knows which meeting is happening now.
3. Advisor clicks Start. Recording begins immediately (never gated on the card). The card joins the meeting in the background; Teams shows the advisor its lobby prompt; the advisor clicks **Admit** — the one unavoidable click, and it's a click *inside the meeting client they're already looking at*.
4. All participants see: a join notification ("⏺ Recording Notice — Sarah joined"), a participant-list entry, and a tile showing the notice card. The advisor's pill quietly shows "Notice card in meeting ✓".
5. Advisor stops recording → the card leaves the meeting → participants see it go (an honest "recording has ended" signal no competitor offers) → the consent ledger holds the complete trail.

If anything fails (no meeting link found, lobby denied, platform hiccup): a calm inline note — *"Notice card couldn't join — remember to say the recording notice aloud"* — and the verified-verbal-notice path carries the load. Failure is informative, never disruptive.

## How it works (the technical shape — and the insight that collapses the cost)

**Join mechanism:** a companion window (Tauri webview — the same Chromium-family engine the meeting platforms' own web clients target) opens the meeting's public join URL and joins as a named guest, mic muted. No platform API keys, no vendor agreements, no bot registration — it joins exactly the way a human guest with a browser does. We already drive Teams and Zoom web clients daily on the test benches; this is proven muscle moved into the product.

**The cost-collapsing insight — no camera driver needed:** because *we* own the companion webview, we can hand the meeting page a "camera" that is actually a **locally rendered canvas** (standard web capability: intercept the camera request, supply a canvas stream). The notice card is just a small web page we draw: firm branding, the notice text, even a live "Recording · 12:34" timer. The OS-level virtual-camera driver from the earlier brainstorm — the expensive part — is unnecessary. The same trick later supplies a one-time **spoken announcement** through the card's own microphone channel (we already bundle local text-to-speech), delivering the "audible notice" idea with zero changes to the advisor's real mic.

**What the card needs from the app (all small, buildable pieces):**
- **Calendar model extension:** sync currently stores title/time/attendees; add the event's online-meeting **join URL** (one more field from the same calendar APIs — Microsoft and Google both expose it). This also unlocks future features (one-click join for the advisor).
- **Platform adapters:** per-platform join automation (fill name → mute → join → detect admitted/denied). Start with **Teams and Zoom** (guest join supported; Zoom passcodes ride in the URL). **Google Meet ships later** — it generally requires a signed-in Google account to join, so v1 shows "Meet: say the notice aloud" honestly rather than a flaky half-feature.
- **Lifecycle supervisor:** join on record-start, leave on record-stop, auto-rejoin once on disconnect, and a watchdog so a wedged companion window can never linger after the meeting (kill on meeting end, always).
- **Ledger integration:** `notice-card-joined` (platform, meeting, time), `notice-card-left`, `notice-card-failed (reason)`, plus a `notice-card-present-for-entire-recording` derived fact the policy engine can consume.
- **Policy hook:** the Notice Kit's Standard/Strict dial gains a configurable evidence rule — by default, *either* a verified verbal notice *or* full-duration card presence satisfies Strict; firms can require both. (Verbal stays recommended everywhere: it's the strongest single evidence and works on phone calls where no card can join.)

**Security/privacy posture (state it, enforce it):** the companion webview receives meeting audio/video transiently, exactly as any participant's browser does, on a machine that is already in the meeting — nothing is captured, stored, or transmitted from it, and the window is isolated from the app's internals (meeting pages are untrusted web content; they get no bridge into the app). The recording pipeline remains the existing local system-audio capture, unchanged.

## Design details that make it feel finished

- **The name is the message:** even camera-off or shrunk to a sliver in speaker view, "⏺ Recording Notice — Sarah" reads in the participant list and the join toast. Name template is firm-configurable with a sane default and per-platform length guards.
- **The card is calm, not alarming:** light theme, firm logo slot, three short lines — *"This meeting is being recorded by Sarah Morgan · The recording stays on her computer — nothing is uploaded · Questions welcome."* Localized (en/de/es). No red flashing; trust, not sirens.
- **Host-awareness:** if the advisor isn't the host, lobby admission depends on whoever is — the app says so up front ("The host will need to admit the notice card") instead of failing mysteriously.
- **The departure signal:** when recording stops, the card leaves — participants get a visible end-of-recording moment. Worth a line in the card itself: "This card leaves when recording ends."
- **Do-not-annoy rules:** never auto-join without the toggle; remember per-client preferences; if the same meeting is re-recorded (stop/start), rejoin silently without re-prompting.

## Build ladder (each rung ships value)

| Rung | Ships | New tech |
|---|---|---|
| **v1** | Name-only guest join on Teams + Zoom, calendar-link detection, lifecycle + ledger + consent-dialog toggle, honest fallbacks | Calendar join-URL field; two join adapters; supervisor |
| **v2** | The visual card (canvas-camera), branding + live timer, localized | Canvas-stream camera in the companion webview |
| **v3** | Spoken announcement on join (local TTS through the card's mic) | Audio-track injection (same interception point as v2) |
| Later | Google Meet adapter (account strategy needed); consent-ack QR on the card | — |

**Sequencing:** the build starts **after the Notice Kit merges** — it extends the same consent dialog, ledger schema, and policy dial the Kit is creating right now (building in parallel would mean two lanes fighting over the same files). Estimated as one substantial lane (Opus-class) for v1+v2 together, v3 as a fast follow.

## Risks, named honestly

1. **Web-client drift:** Teams/Zoom update their join pages; adapters need the same maintenance discipline as our bench harness (which has survived exactly this all week). Mitigation: adapter self-tests in CI against recorded page fixtures + a fail-soft posture (fallback message, never a broken meeting).
2. **Lobby friction:** one extra click for the advisor, or dependence on a third-party host. Mitigated by messaging; eliminated when the advisor's org allows guests to bypass the lobby.
3. **Platform terms:** guest-joining via the web client is how every notetaker bot on the market operates; our participant is *less* invasive (no media leaves the machine). We describe it truthfully in the privacy documentation and never disguise what it is.
4. **WebView quirks:** meeting web clients occasionally gate features by browser detection. The adapters pin a tested user-agent posture per platform; the bench harness gives us a permanent place to re-verify after platform updates.

## Why this wins

No competitor can copy this story cheaply: bots exist to move meeting data into vendors' clouds, so *their* participant can never say "nothing leaves this room." Ours can — in every participant's face, for the whole meeting, in the advisor's own branding. It turns the industry's biggest objection to bot-less recording into the most visible trust feature in the category.
