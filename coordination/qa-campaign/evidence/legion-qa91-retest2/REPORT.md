# Legion QA-91 Layer-2 Retest — Notice Card at tip f7847f63 (lp/qa91b-teams-adapter + lp/sidebar-archived)

**Date:** 2026-07-06
**Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`), driven via CDP (`scripts/desktop-drive.mjs`) + a small standalone read-only diagnostic script (see below)
**Second-participant tooling:** server's always-on Chrome (`chrome-cdp`), hosting a real live Teams meeting as organizer
**Worker:** cc-lantern-legionverify
**Tip verified:** `f7847f637511f0bc3359c58127e50692067de5c8` (merge: lp/qa91b-teams-adapter — Notice Card recognizes current Teams prejoin; also contains `lp/sidebar-archived` — archived clients leave the sidebar rail)

## Results

| Check | Result |
|---|---|
| Sidebar fix (archived clients hidden from left rail) | **PASS** |
| Notice Card joins a real live Teams meeting | **FAIL — 3/3 new attempts (6/6 total across both rounds)** |
| Root cause this round | **Found and directly proven** (not just inferred from symptoms) — see below |

---

## 1. Sidebar fix — PASS

Rebuilt the Legion to `f7847f63` (pure frontend diff, no Rust changes — confirmed via `git diff --stat 4cafb72f..f7847f63 -- src-tauri`, empty). Restarted the app. Confirmed:
- Main **Clients** table: "3 clients, 3 folders indexed" (unchanged from before).
- **Left sidebar** now shows exactly the same 3: The Hendersons, Maria & Luis Alvarez, Dr. Priya Nair — no trace of the 42 archived test clients. Confirmed via DOM query (9 sidebar buttons total = 3 clients + Client Map/Ask/Workflows nav + account row + spacer, down from 51 before the fix) and screenshot `01-sidebar-fixed-3-only.jpeg`.

This closes the item from the demo pre-flight report. Both PASS.

## 2. Notice Card retest — FAIL, but the real root cause is now directly proven

Created a fresh, real, live Teams meeting ("QA-91 Layer2 Retest") via the server's always-on Chrome (`teams.live.com` → Meet → Schedule a meeting → grabbed the real join link from the "Meeting created" invitation preview: `https://teams.live.com/meet/9335530171816?p=...`), joined it live as host/organizer, confirmed via the Participants panel: "In this meeting (1) — Jameson Daines, Organizer."

From The Hendersons' Meetings tab, pasted that live URL into **Record a meeting** → Notice Card field, consented, started recording — 3 separate attempts (fresh each time). **All 3 failed** with the same "Notice card couldn't join. Say the notice aloud." message, and the client's `.consent-ledger.json` recorded `"reason": "page-unrecognized"` for all 3 (attempts 4, 5, 6 overall — attempts 1-3 are the pre-fix round already reported in `legion-qa91-verify/REPORT.md`). Across all 6 attempts total (both rounds), the host's own Participants panel never once showed a lobby/knock request — consistent with the card never getting far enough to ask.

### This time, I found the actual page it's stuck on — not just the symptom

The prior round could only infer "it never recognizes the page." This round, I wrote a small **standalone, read-only** diagnostic script (`inspect-notice.mjs`, not part of the app or any test harness — just a thin Playwright/CDP reader, deleted from the Legion after use, never touched the app's own code) to find the Notice Card's own hidden companion webview as a separate CDP target (reachable on the same port `9223` the app already exposes) and read its actual URL/text/screenshot while a live attempt was in progress.

**What it's actually showing**, captured mid-attempt (screenshot `02-notice-card-stuck-on-browser-vs-app-chooser.jpeg`):

```
URL:   https://teams.live.com/dl/launcher/launcher.html?url=%2F_%23%2Fmeet%2F...&type=meet&...&msLaunch=true&...
Title: "Join conversation"
Text:  Join your Teams meeting
       Continue on this browser
       Join on the Teams app

       Don't have the app?
       Download it now
```

**This is a "how do you want to join — browser or the Teams app?" interstitial that Teams shows BEFORE the actual meeting prejoin screen** (the `[data-tid="calling-prejoin-screen"]` page the `lp/qa91b-teams-adapter` fix correctly re-grounded its selectors against). The Notice Card's automation never clicks **"Continue on this browser"** on this page, so it never reaches the prejoin screen at all — `detectPhase` correctly returns `'loading'` for this launcher page (it matches none of the prejoin/lobby/admitted/denied selectors, and rightly shouldn't), the in-page runner times out at ~29s exactly as before, and reports `page-unrecognized`. **The qa91b fix's selectors are very likely correct for the actual prejoin page — the card just never gets there.**

### Why the qa91b capture didn't see this page (a plausible, testable explanation)

The qa91b evidence (`coordination/qa-campaign/evidence/qa91b-teams-adapter/CAPTURED-DOM.md`) captured its DOM using the server's **already-signed-in, already-warmed** `chrome-cdp` browser profile — the same profile has now navigated to dozens of Teams meeting links across many test sessions (mine included). Microsoft Teams' browser-vs-app chooser is exactly the kind of interstitial that gets remembered/skipped by a browser that has already answered it before (a stored preference or cookie). The Notice Card's companion webview, by contrast, is a **fresh, isolated WebView2 guest profile every time** (by design, for privacy/isolation) — so it has no memory of ever answering that question and sees the chooser fresh on every single attempt. This would explain why the qa91b capture never encountered it (their capture browser had already "decided" to continue in-browser long ago) while the Notice Card hits it 100% of the time.

**Recommendation for the next fix round:** the adapter (or the injected runner) needs to explicitly recognize this launcher/chooser page (`teams.live.com/dl/launcher/launcher.html`, title "Join conversation", text containing "Continue on this browser") as its own phase and click through it before `detectPhase` is ever asked to recognize the prejoin. This is a **new, earlier** step than anything the qa91b fix touched — not a regression in that fix, a genuinely separate page the fix's capture methodology couldn't have seen given how it captured the DOM.

### Secondary symptom observed (new this round, not previously reported)

Several of this round's failed meeting entries show **"notes couldn't be written"** next to the duration in the Meetings list (screenshot `03-six-failed-meetings-total.jpeg`) — not seen in the pre-fix round's failures. Not investigated further (out of scope for this retest — flagging for whoever picks up the adapter fix, since it may be a related or separate small issue in the failure/cleanup path).

## Evidence

- `01-sidebar-fixed-3-only.jpeg` — sidebar shows exactly 3 clients post-fix
- `02-notice-card-stuck-on-browser-vs-app-chooser.jpeg` — the actual page the Notice Card's hidden webview is stuck on, captured directly from that webview mid-attempt
- `03-six-failed-meetings-total.jpeg` — all 6 failed attempts (3 pre-fix + 3 this round) sitting under The Hendersons' Meetings tab
- Consent ledger excerpt (`.consent-ledger.json`, not screenshotted — structured data quoted below):
```
2026-07-06-matter_880a5033...-4   2026-07-06T04:18:47.660Z   page-unrecognized
2026-07-06-matter_880a5033...-5   2026-07-06T04:23:07.313Z   page-unrecognized
2026-07-06-matter_880a5033...-6   2026-07-06T04:25:08.972Z   page-unrecognized
```

## Testing-environment note (unchanged limitation, disclosed again for completeness)

Same limitation as the first QA-91 retest: this server's always-on Chrome is a single shared signed-in profile, so a fully independent second human participant still isn't possible from it. This round I did not need to solve that: the Notice Card demonstrably never gets far enough to reach a lobby (proven directly from its own webview content, not inferred), so a second participant's view would not have shown anything different — there's no card to see yet, on any participant's screen, until the browser/app chooser page is handled.

## State left on the Legion

- App running at tip `f7847f63`, Cloud AI mode, Beacon Ridge Demo workspace, 3 clients (sidebar fix confirmed live).
- 6 failed test meeting recordings now sit under The Hendersons (3 from the pre-fix round, audio already deleted; 3 new from this round, audio not yet cleaned up — left as-is since they're direct evidence for this report; happy to clean up next pass).
- `inspect-notice.mjs` diagnostic script was deleted from the Legion after use — nothing left behind there; it's not part of any commit (kept only in this evidence report).
- The ad hoc "QA-91 Layer2 Retest" scheduled Teams meeting was not deleted (harmless, clearly named, timestamped).
