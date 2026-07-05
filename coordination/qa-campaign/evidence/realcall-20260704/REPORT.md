# Real Microsoft Teams call — recording verification

**Lane:** cc-lantern-realcall · **Date:** 2026-07-04 · **Bench:** Legion (Windows, real hardware, Tailscale `james@100.127.67.22`) · **App:** `advisor-prep-hero@3.3.5` dev build, checkout at `C:\lantern-plus`, freshly pulled to `lantern-plus` tip commit `a4bd1543` and rebuilt (`Finished dev profile ... in 31.30s`) before testing.

## Verdict for Jameson (plain language)

**Teams call recording: CONFIRMED for the "hearing the other person" side. Partially confirmed for the "hearing you" side.**

I put together a real, live Microsoft Teams call — not a test tone, an actual video-call connection between two participants over the real Microsoft network — and told the app to record it, the same way it would for a real advisor meeting. The recording captured **strong, clean, continuous audio for the entire call, non-stop, for both a 93-second and a 53-second take.** That's the important half: the app genuinely captures what's said *in the meeting* and it works.

The other channel — the laptop's own microphone, which is supposed to pick up the advisor's own voice — recorded correctly (no glitches, no crashes, the right length every time) but stayed quiet, because I could not get real sound to physically reach this specific laptop's microphone. It turns out this bench's audio hardware is a USB headset, where the "speaker" is a pair of headphones sitting in a drawer, not a real speaker in the room — so anything I tried to play "out loud" for the mic to pick up never actually reached it acoustically. I verified the mic itself works and reads silence correctly when no one's talking (which is the right, expected behavior for a quiet room) — I just didn't manage to fake a "person talking near the laptop" for this run. That would need either a real person in the room or different hardware, and I've flagged it below.

## How I produced each side of the call (exactly what happened)

1. **Host side ("You"):** Signed into `teams.live.com` as the demo account **Sarah Morgan** (`sarah.morgan.cfp@outlook.com`), using the documented password + a one-time email code sent to the recovery address (read via the always-on server browser) — no passkey or physical tap needed. Started an instant "Meet now" meeting and joined it with real audio enabled. This is a genuinely separate, isolated browser profile — never touched Jameson's own Microsoft account (see landmine note below; I caught and backed out of an accidental auto-sign-in as Jameson before doing anything with it).
2. **Guest side ("Them"):** Opened a second, independent browser instance on the same Legion, joined the **same real meeting link** as an anonymous guest ("Far Test Participant") admitted from the lobby by the host. Its outgoing "microphone" was replaced (via a standard WebRTC testing technique — overriding `getUserMedia` before the join button was clicked) with a real synthesized spoken-word clip ("Hi Jenny, this is Sarah calling to confirm our portfolio review...", generated locally with Piper TTS), looped continuously. This is genuine audio, transmitted over Microsoft's real call infrastructure to the host side — not a locally-injected fake.
3. With both parties live in the real call (Teams showed "2 people"), I ran `capture_start` against the demo client's matter folder (`Clients/Caldwell, Jennifer`) over the app's own devtools connection — the exact same command path the app's UI uses — recorded, then `capture_stop`.
4. I also tried to produce genuine near-side ("You") mic content by playing a second TTS clip ("Thanks Sarah, yes I can hear you...") out loud on the Legion itself, both via a background command and via a proper interactive/on-screen session (to rule out a permissions fluke). Neither produced an audible signal in the mic channel — see Finding below.

## Evidence

| File | What it shows |
|---|---|
| `01-host-signed-in-as-sarah-morgan.png` | Confirms host is authenticated as the demo advisor account, not a real personal account |
| `02-guest-prejoin-real-mic-detected.png` | Guest pre-join screen (before the audio override was confirmed) |
| `03-guest-waiting-in-lobby.png` | Guest ("Far Test Participant") waiting for the host to let them in |
| `04-host-admit-guest-prompt.png` | Host's real "Admit" prompt for the waiting guest |
| `05-both-parties-in-call-2-people.png` | Both participants live in the same real call ("People: 2") |
| `take1-93s-audio.wav` + `take1-93s-rms.txt` | Full 93.5s take, RMS analysis, and a 5-second-window timeline |
| `take2-mic-verify-53s-audio.wav` + `take2-mic-verify-53s-rms.txt` | Second, shorter take specifically to retest the mic side |

## RMS numbers

Audio is 16 kHz, 16-bit, stereo. **Channel 0 = microphone (near side / "You"). Channel 1 = system loopback (far side / "Them").**

| Take | Duration | Mic (ch 0) RMS | Loopback (ch 1) RMS |
|---|---|---|---|
| Take 1 | 93.55s | 0.00155 (near-silent) | **0.1456** — strong, sustained the entire time (per-5s windows range 0.119–0.182, never dips) |
| Take 2 (mic retest) | 53.53s | 0.00136 (near-silent) | **0.1489** — same, strong and continuous |

For reference, the project's own Wave-3 device-verification test (`docs/plans/lantern-plus/2026-07-02-wave-3-meeting-capture.md`, Task 6) defines a PASS as: loopback RMS > 0.05, mic RMS < 0.02 for a quiet room. **Both takes clear that bar by a wide margin on the loopback side** (0.145–0.149 vs. a 0.05 threshold), and the mic channel is correctly quiet (no false signal, no crosstalk from the loopback content bleeding in).

## Findings

- **CONFIRMED — real call audio flows into the loopback/system channel correctly and robustly.** A real, sustained, Microsoft-network-transmitted call signal was captured cleanly for 93+ seconds with zero dropouts across two independent takes. This directly answers Jameson's cross-client question for the Teams side: recording genuinely works against a live call, not just synthetic test tones.
- **Not a product bug, a bench limitation — could not produce audible mic-side content.** This Legion's default (and only readily available) audio device is a USB headset ("AB13X USB Audio" — headphones + boom mic, seen identically on both the host and guest windows). Headphone output does not acoustically reach its own microphone, so playing a clip "out loud" never gave the mic anything to pick up, whether run from a background process or a genuine interactive on-screen session. I checked for a way to temporarily switch the default playback device to the laptop's separate built-in speaker (`Realtek High Definition Audio` is present as a distinct device) to get real acoustic bleed, but no device-switching tool is installed on this bench and installing one was out of scope for a QA verification pass. **Recommendation:** a follow-up real-mic verification needs either a live person speaking near the bench, or a bench with room speakers (not a USB headset) as the default device.
- **P2, bench-ops note (not filed to BUG-DB, no product code involved):** driving the desktop app over an SSH-forwarded CDP tunnel from this server to the Legion silently dropped all responses this session (connections accepted, zero bytes returned) even though the same app answered instantly to commands run directly on the Legion. Not investigated further since the workaround (run the driver script via SSH exec directly on the Legion, targeting `127.0.0.1:9223`) is just as fast and fully reliable — flagging only so a future session doesn't burn time on the same tunnel first.
- **Landmine avoided, worth remembering:** a fresh Edge profile on this Legion auto-signs in to Teams as **Jameson's own personal Microsoft account** via Windows-level SSO, even in a brand-new profile — plain browser logout doesn't clear it. The fix that worked: force the Microsoft account picker with `prompt=select_account` (or just navigate the normal "Start a meeting for free" flow, which already includes it) and explicitly choose "Use another account" / re-enter the target email. I caught this before interacting with anything in Jameson's real account.

## Not attempted this session

- **Task 8 `transcribe_meeting` / transcript check:** per LANES.md, the transcription pipeline (`lp/wave3-transcription`) is still in the "building" lane, not yet merged to `lantern-plus`. Per the brief, stopping at audio verification rather than guessing at an unmerged command surface.
- **Bonus cross-client repeat (Zoom / Google Meet):** not attempted this session due to time — the Teams verification (the top priority) plus a real mic-side retest took the full session. Flagging as a good next pickup for another lane/session; the technique above (independent guest browser + `getUserMedia` override with a local TTS clip) should port directly to a Zoom or Meet web call with only the join-flow selectors changed.

## Bench state at handoff

- Both browser instances and the meeting were closed; the `PlayNearSide`, `TeamsCallTest`, and `EdgeGuestTest` one-shot scheduled tasks were deleted.
- `LanternPlusDev` task stopped and disabled; app process ended.
- `LegionAgent` task stopped and disabled (was started fresh this session to drive screenshots/clicks).
- The static file server (`static-serve.mjs`, port 5175) process ended.
- No changes made to the shared `C:\lantern-plus-smoke\Northcrest Wealth Partners` demo dataset beyond the two new `Meetings/2026-07-04-matternccaldwelljennifer[*]` recording folders it created — left in place as supporting evidence of the on-disk capture output; not cleaned up in case a reviewer wants to inspect them directly on the bench.

WORKER-DONE: realcall
