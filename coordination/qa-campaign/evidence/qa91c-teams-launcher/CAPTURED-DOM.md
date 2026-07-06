# QA-91c — Real Teams "browser or app?" launcher interstitial DOM capture (2026-07-06)

**Worker:** cc-lantern-qa91c · **Branch:** lp/qa91c-interstitial
**Bug (proven live, `cca5e1a4`):** the Notice Card companion webview ALWAYS lands on
Teams' launcher chooser page — *"Join your Teams meeting / Continue on this browser /
Join on the Teams app"* — and never clicks through it, so `detectPhase` sits in `loading`
and the runner soft-fails `page-unrecognized` at ~29s (6/6 across two Legion rounds). This
is a **step BEFORE** the prejoin screen that the QA-91b fix (`f7847f63`) correctly
re-targeted. The card just never reaches the prejoin.

## Why the QA-91b capture never saw this page (now confirmed)

The launcher chooser is shown based on the **User-Agent**. In a plain, already-warmed
Chrome profile (how QA-91b captured its DOM), `teams.live.com/meet/<id>` auto-continues
straight to the web client — the chooser is skipped. The Notice Card's companion webview
is a **Tauri WebView2** (an embedded Edge/Chromium webview). Teams sees that desktop-webview
User-Agent, assumes the Teams desktop app might be installed, and shows the
*"browser or app?"* chooser on **every** attempt (fresh isolated profile, no memory of ever
answering). That is why the card hits it 100% of the time while the QA-91b capture never did.

## How this DOM was captured (real, this round)

Server's always-on Chrome, driven by `chrome-cdp` + a small read-only CDP script:

1. Signed-in session: `teams.live.com` → **Meet** → **Create a meeting link** →
   **Join** (host joined live), producing meeting
   `https://teams.live.com/meet/9389551917420?p=…` (a real, live meeting).
2. A **fresh incognito browser context** (`Target.createBrowserContext` — no
   `teams.live.com` cookies, exactly like the companion webview's fresh profile) with the
   **WebView2 / Edge User-Agent spoofed**
   (`…Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0`) navigated to that meet URL.
3. Teams routed it to
   `https://teams.live.com/dl/launcher/launcher.html?url=…&msLaunch=true…` —
   **the exact chooser page the bug screenshot shows.** DOM, element inventory, and a
   screenshot were captured (`launcher-interstitial.jpg`, `launcher-inventory.json`,
   `launcher-buttons-outerHTML.html`).

Without the WebView2 UA spoof, plain Chrome auto-continued to web (`launchType=web`) and
the chooser never appeared — reproducing (and explaining) the QA-91b blind spot.

## The captured chooser — grounded selectors

Title: **"Join conversation"**. Body text:
```
Join your Teams meeting
Continue on this browser
Join on the Teams app

Don't have the app?
Download it now
```

Two action buttons (real captured `outerHTML`):
```html
<button aria-label="Join meeting from this browser" class="btn primary " data-tid="joinOnWeb">
  <div class="btnIcon"><div class="text"><h3>Continue on this browser</h3></div></div>
</button>
<button aria-label="Open Teams app to join a meeting" class="btn secondary " data-tid="joinInApp">
  <div class="btnIcon"><div class="text"><h3>Join on the Teams app</h3></div></div>
</button>
```

- **Click target:** `button[data-tid="joinOnWeb"]` — text "Continue on this browser",
  aria-label "Join meeting from this browser".
- **MUST NOT click:** `button[data-tid="joinInApp"]` ("Join on the Teams app") — that tries
  to hand off to a non-existent desktop app and would dead-end the companion webview.
- `data-tid` inventory on the page: `joinOnWeb`, `joinInApp`, `download`, `consumerPrivacy`.

## No cookie-consent banner precedes it (checked)

Scanned the full launcher `outerHTML` for `cookie`/`consent`/`onetrust`/`gdpr`/`banner`:
the only "cookie" match is the footer link text *"Privacy and cookies"*, and the only
`banner` match is an **empty decorative** `<div class="banner"></div>` plus an unrelated
config flag. **There is no blocking cookie-consent modal** on this page, so the fix does
**not** need to dismiss one. (If Teams ever adds one, the launcher branch re-runs every
poll, so a later banner-dismiss step could be added without restructuring.)

## Verified end-to-end: clicking through reaches the prejoin

Clicking `[data-tid="joinOnWeb"]` on the captured page navigated:

```
launcher.html  →  /light-meetings/launch (transient ~few s, "loading")  →  PREJOIN
```

and landed on the real prejoin with `[data-tid="calling-prejoin-screen"]` **and**
`[data-tid="prejoin-display-name-input"]` present (title "Microsoft Teams meeting") — i.e.
exactly the surface the QA-91b adapter already drives. The intermediate
`light-meetings/launch` page is a transient `loading` state lasting a few seconds, far
under the runner's ~28s (40-tick) unrecognized timeout, so it is harmless.

## Layered fix (coordinator scope addition) — and Layer A verified live

Per the coordinator's grounded research, the fix is **layered** so a private-route
change by Microsoft can't break the join:

- **Layer A — URL rewrite (try first, `rewriteTeamsJoinUrl` in `meetingPlatform.ts`,
  applied in `tauriDriver.ts` before the webview opens).** Rewrite
  `teams.live.com/meet/<id>[?p=…]` and `teams.microsoft.com/l/meetup-join/…` to the
  direct web route `…/v2/?meetingjoin=true#/<route>?…&anon=true&webjoin=true`. This
  loads the web client directly and **never shows the chooser**.
  **VERIFIED LIVE this round:** navigating a fresh cookieless context with the WebView2
  UA to the rewritten
  `https://teams.live.com/v2/?meetingjoin=true#/meet/9389551917420?p=…&anon=true&webjoin=true`
  went **straight to the prejoin** ("Join now", camera/mic controls) with **no launcher
  chooser** — screenshot `layerA-v2-rewrite-reaches-prejoin.jpg`. (The plain `/meet/`
  URL with the same UA hit the launcher — `launcher-interstitial.jpg`. Same UA, only the
  URL differs: the rewrite is what skips it.)
- **Layer B — `webjoin=true`** is carried inside the rewritten meeting URL; Microsoft's
  launcher script honors it if any redirect still bounces through the launcher.
- **Layer C — click-through (final safety net, ~95% single-method confidence).** The
  adapter recognizes the `launcher` phase and clicks "Continue on this browser"
  (`joinOnWeb`), so even if the private `/v2` route ever stops skipping the chooser, the
  card still gets in.

## The adapter click-through (Layer C — `adapters/teamsAdapter.ts`, `adapters/adapterTypes.ts`, `injectionScript.ts`)

- New adapter phase **`launcher`**, detected **before** prejoin/loading, keyed on the
  `joinOnWeb` control (+ text/aria/URL fallbacks). It is recognized and acted on within a
  poll or two — never mistaken for `loading`, so it can't drift into the ~29s give-up.
- New adapter method **`dismissLauncher(doc)`** clicks the grounded
  "continue in browser" control (never `joinInApp`). The in-page runner calls it on the
  `launcher` phase and reports `joining`; after the click the page navigates to the prejoin
  and the existing QA-91b flow takes over.
- Fixture tests built from this captured DOM: launcher → clicks continue → prejoin fixtures
  still pass; legacy fixtures unaffected.

## Files in this folder

- `launcher-interstitial.jpg` — the real chooser page (matches the bug screenshot)
- `launcher-inventory.json` — structured links/buttons/data-tids captured from the page
- `launcher-buttons-outerHTML.html` — the two action buttons' real outer HTML
