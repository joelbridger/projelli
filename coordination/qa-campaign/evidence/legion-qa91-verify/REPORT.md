# Legion QA-91 Re-Verify — Notice Card retest at tip 4cafb72f

**Date:** 2026-07-06
**Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`), driven via CDP (`scripts/desktop-drive.mjs`)
**Second-participant tooling:** server's always-on Chrome (`chrome-cdp`), hosting a real live Teams meeting as organizer
**Worker:** cc-lantern-legionverify
**Tip verified:** `4cafb72f284a5c1523b7717ad2462d0e4d57866d` (merge: lp/qa91-noticecard-join — shared WebView2 browser-args fix for the `0x8007139F` env mismatch)

## Result: **FAIL** — but a different, more specific failure than before, with the original crash class no longer reproducing

| Check | Result |
|---|---|
| Legion rebuilt to tip 4cafb72f | **DONE** |
| Real live Teams meeting created + host joined | **DONE** |
| Notice Card recording started (3 separate attempts) | attempted |
| Notice Card joins and shows a visible tile | **FAIL — 3/3 attempts** |
| Original WebView2 `0x8007139F` window-creation crash | **NOT reproduced** (see below — good news, narrower bad news) |

## What I did

1. Rebuilt the Legion to tip `4cafb72f` (`git reset --hard`, no npm/Cargo dependency changes, small Rust diff — `webview_env.rs` new file, `notice_card/mod.rs` + `lib.rs` touched — incremental cargo rebuild, restarted `LanternPlusDev`).
2. Created a real, live Microsoft Teams meeting as host, using the server's always-on Chrome (`teams.live.com`, signed in as Jameson Daines): scheduled a fresh meeting ("QA-91 Notice Card Test"), grabbed its real join link (`https://teams.live.com/meet/9381392740202?p=...`) via the "Meeting created" invitation-preview dialog, then joined it live as organizer. Confirmed via the Participants panel: "In this meeting (1) — Jameson Daines, Organizer."
3. On the Legion app, opened The Hendersons' Meetings tab → **Record a meeting** → pasted the live join URL into the Notice Card field → checked consent → **Start recording**. Screenshots: `02-record-consent-dialog.jpeg`, `03-consent-url-pasted.jpeg`, `04-recording-started-notice-joining.jpeg`.
4. Watched the **host's own Teams meeting window** (Participants panel) continuously for a lobby/knock request to admit, across three separate recording attempts (stop → restart), each freshly re-pasting the join link. **Screenshots at multiple points across all three attempts show the Participants panel never changed from "In this meeting (1)" — no lobby request, no second participant, ever.** (`05-`, `07-`, `09-host-participants-still-1-*.jpg`)
5. Each attempt's recording widget eventually showed **"Notice card couldn't join. Say the notice aloud."** (`06-widget-failed-attempt1.jpeg`, `10-final-state-3-failed-attempts.jpeg`) — visually the same failure text as the original QA-91 bug.

## Root-causing further than the visible symptom (this is the useful part)

Rather than stop at "still fails," I checked the client's own consent ledger (`Meetings/.consent-ledger.json`), which records a specific machine-readable failure `reason` for every `notice-card-failed` event — not visible in the UI, but written by the app itself:

```json
{ "kind": "notice-card-failed", "at": "2026-07-06T02:48:29.236Z", "reason": "page-unrecognized" }
{ "kind": "notice-card-failed", "at": "2026-07-06T02:55:48.923Z", "reason": "page-unrecognized" }
{ "kind": "notice-card-failed", "at": "2026-07-06T03:00:32.577Z", "reason": "page-unrecognized" }
```

All **3/3 attempts** failed with the exact same reason: **`page-unrecognized`** ("the join page didn't match the adapter (web-client drift)" per `noticeCardTypes.ts`'s own comment) — **not** `window-closed` or `internal`, which is what the original `0x8007139F` WebView2-environment-mismatch crash would have produced. Each failure landed at a consistent **~28-29 seconds** after the notice-context was logged (02:48:00→02:48:29, 02:55:20→02:55:48, 03:00:03→03:00:32) — a fast, deterministic timeout on page-recognition, not the multi-minute join-timeout from the original bug reports.

I also sampled `msedgewebview2.exe` process counts on the Legion during a live attempt: baseline was 12 (main app only), and it briefly rose to 14 then settled at 13 for roughly a minute before returning to baseline 12 once the attempt failed — consistent with a **companion window actually being created and torn down**, not failing to open at all.

**Conclusion: the `0x8007139F` WebView2 shared-browser-args crash this fix targeted does appear to be resolved** (a companion window is created; the failure reason is never `window-closed`/`internal`). **But there is a separate, still-live bug**: the Notice Card's page-recognition adapter cannot recognize the join page for this specific meeting flow (a `teams.live.com` personal/consumer scheduled-meeting link), and gives up after ~29 seconds without ever reaching a state where Teams would show the host a lobby/admit prompt. This is very plausibly related to how convoluted this particular join flow is in practice — the pre-join screen for this link required navigating a "No camera is connected" panel, an "Allow Teams to access your mic" nag that reappears, explicit selection of an audio mode, and a "Join now" button that didn't respond to a first click — real friction I hit repeatedly myself while driving it manually as the human/host. If the adapter's automation expects a simpler/more standard join-page shape, this kind of consumer-Teams pre-join complexity would plausibly explain a fast "I don't recognize this page" bailout.

## Testing-environment limitation (disclosed, not a product finding)

I could not get a **genuinely distinct second human participant** the way the prior winsmoke run did: this server's always-on Chrome is a single shared browser profile/login (per its own operating rules), so any second tab/window I opened to the same meeting link just re-used the same signed-in Jameson Daines identity and merged into the *same* connected session (same elapsed timer, same single "Jameson Daines" participant) rather than creating a second party. `chrome-cdp` has no incognito/second-identity option exposed. I did not attempt to sign out mid-test since that would drop the *host* session too (same shared cookie jar). Given the Notice Card never even reached the point of asking to join (no lobby event ever appeared to the host), a second participant would not have added information for this run — the failure is demonstrably occurring before that would matter.

## Evidence

- `01-host-live-meeting.jpg` — host live in the Teams meeting, "Waiting for others to join…"
- `02-record-consent-dialog.jpeg` — the app's "Record this meeting?" dialog with the Notice Card URL field
- `03-consent-url-pasted.jpeg` — real join URL pasted, consent checked, "Start recording" enabled
- `04-recording-started-notice-joining.jpeg` — recording widget showing "Notice card joining"
- `05-`, `07-`, `09-host-participants-still-1-attempt{1,2,3}.jpg` — host's own Participants panel across all 3 attempts, never more than 1 participant, no lobby ever appeared
- `06-widget-failed-attempt1.jpeg` — "Notice card couldn't join. Say the notice aloud." (attempt 1)
- `08-meeting-saved-attempt1.jpeg` — first failed attempt saved as a 7-min "Needs review" meeting
- `10-final-state-3-failed-attempts.jpeg` — 2 saved failed meetings + 3rd attempt mid-failure, same message
- `.consent-ledger.json` excerpt above — the `page-unrecognized` reason for all 3 attempts, not reproduced as a screenshot (structured data, quoted verbatim above)

## State left on the Legion / cleanup

- All 3 test recordings stopped; the meeting entries remain on The Hendersons' Meetings tab as real evidence of the failure (left in place — didn't delete test data per "report only, don't fix").
- Host Chrome session left the Teams meeting and was closed; the ad hoc "QA-91 Notice Card Test" scheduled meeting was not deleted from the calendar (harmless, timestamped, clearly named).
- App left running at tip `4cafb72f`, Cloud AI mode (unchanged from QA-92 pass), on the Beacon Ridge Demo workspace.

## Bottom line for the coordinator

Real progress, not a clean pass: the specific `0x8007139F` crash this fix targeted is not reproducing anymore (a companion window does get created), but the Notice Card still never joins a real meeting in practice — it now fails for a different, identified reason (`page-unrecognized`, ~29s, 3/3 reproducible) before ever reaching the host's lobby. QA-91 is **not** resolved end-to-end yet; recommend filing the `page-unrecognized` failure as the next-round ticket, pointing whoever picks it up straight at the consent-ledger reason code and the ~29s timing rather than starting from scratch.
