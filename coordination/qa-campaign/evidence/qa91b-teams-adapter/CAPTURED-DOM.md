# QA-91b — Real Teams web join-page DOM capture (2026-07-06)

**Worker:** cc-lantern-qa91b · **Branch:** lp/qa91b-teams-adapter
**Bug:** Notice Card companion webview fails with `page-unrecognized` (~29s soft-fail, 3/3)
on a real live Teams meeting — the host never sees a lobby knock. Root cause = the
`teamsAdapter.ts` selectors no longer match today's Teams web anonymous-join UI.

## How this DOM was captured

The server's always-on Chrome (signed in as Jameson Daines, `microsoft@projelli.com`)
was driven with `chrome-cdp`:

1. `teams.live.com` → **Meet** → **Create a meeting link**, producing the meeting
   `https://teams.live.com/meet/9350727562529`.
2. A second `chrome-cdp` session navigated to that join URL. Teams rendered its
   **prejoin screen** (title `Meeting join | Microsoft Teams meeting`), which is the
   exact surface the Notice Card companion webview loads.
3. DOM was read with `chrome-cdp eval` (`document.querySelectorAll('[data-tid]')`,
   inputs, buttons, and trimmed `outerHTML`). Screenshots saved alongside this file.

**Limitation (disclosed):** the server's Chrome is a single shared, signed-in profile,
so I could not open a genuinely *anonymous* second identity, and the bare meeting link
required a passcode I did not hold — so I could not drive the join through to the
**lobby** / **admitted** / **denied** states myself. The **prejoin** (where the reported
`page-unrecognized` failure actually happens — `detectPhase` never leaves `loading`) IS
fully captured and is what the fix is grounded in. The post-join states are updated with
robust multi-signal detection (data-tid + aria-label + text) and are marked VERIFY-LIVE
for the coordinator's Legion retest.

## The reported failure, root-caused

Old `detectPhase` only recognized the prejoin by the presence of
`[data-tid="prejoin-display-name-input"]`, and the prejoin container it implicitly relied
on (`prejoin-screen`) is gone. In today's DOM **none** of the old selectors match, so
`detectPhase` returns `'loading'` forever → the in-page runner counts 40 ticks
(~28s at 700ms) → reports `unrecognized`. That is the exact ~29s, 3/3 `page-unrecognized`
symptom in the Legion retest (`d000de06`).

## Captured `data-tid` inventory of the current prejoin

The prejoin lives under a single region container:

```
[data-tid="calling-prejoin-screen"]            role="region"   ← NEW recognizer (old adapter had nothing for this)
  [data-tid="prejoin-header-content"]
    [data-tid="prejoin-meeting-details-content"]
      [data-tid="meeting-header-title"]         "Microsoft Teams meeting"
      [data-tid="meeting-details-container"]
  [data-tid="calling-prejoin-render-content-container"]
    [data-tid="prejoin-v2-video-preview-container"]
      [data-tid="prejoin-v2-video-preview"]
      [data-tid="prejoin-v2-video-actions"]
      input[data-tid="toggle-video"]            role="switch"  data-cid="toggle-video-false"  (camera)
    [data-tid="calling-prejoin-v2-computer-audio-renderer-test"]
      input[data-tid="toggle-mute"]             role="switch"  data-cid="toggle-mute-false"   (mic)
  [data-tid="prejoin-cancel-button"]
  [data-tid="prejoin-join-button"]              aria-label="Join now"   ← UNCHANGED, still valid
```

### Mic toggle — real captured outerHTML (server has no mic, so `disabled`):

```html
<input id="switch-r1f" role="switch" type="checkbox" title="Mic is not available"
       disabled="" aria-describedby="toggle-mute-disabled-description"
       data-tid="toggle-mute" data-cid="toggle-mute-false"
       data-tabster='{"observed":{"names":["calling-prejoin-mic-toggle"]}}'>
```

Key change vs the old adapter: the mic control is now a **`role="switch"` checkbox**, not
a button with `aria-pressed`. State is carried by:
- `data-cid="toggle-mute-<bool>"` — `-false` = **unmuted (mic on)**, `-true` = **muted**.
- `aria-checked` on the switch (was `null` here only because the toggle is `disabled` for
  lack of a mic on this headless server; on real hardware it reflects the switch state).
- `data-tabster` observed name `calling-prejoin-mic-toggle`.

The old `ensureMuted` (looked for `aria-pressed` / an `aria-label` containing "unmute")
matches none of this → it never muted. New logic reads `data-cid` / `aria-checked`.

### Camera toggle — real captured outerHTML:

```html
<input id="switch-r1b" role="switch" type="checkbox" disabled=""
       aria-label="Camera is not available"
       aria-describedby="toggle-video-disabled-description"
       data-tid="toggle-video" data-cid="toggle-video-false" class="fui-…">
```

### Prejoin region `outerHTML` (trimmed; classes/styles/tabster stripped):

```html
<div data-tid="calling-prejoin-screen" role="region">
  <div role="group" data-testid="calling-prejoin-alert">…alert icon…</div>
  <div><div data-tid="prejoin-header-content"><div><div data-tid="prejoin-meeting-details-content">
    …teams glyph…
    <h1 aria-label="Microsoft Teams meeting">
      <span data-tid="meeting-header-title" title="Microsoft Teams meeting">Microsoft Teams meeting</span>
    </h1>
    <h2 data-tid="meeting-details-container"></h2>
  …
```

### Guest name field (anonymous flow)

Not present in the signed-in capture (Teams used the signed-in account card
`[data-tid="account-selection-change-account-button"]` instead of a name field). The
cookieless companion webview always hits the **anonymous** prejoin, which historically
renders `input[data-tid="prejoin-display-name-input"]`. The fix keeps that as the primary
name selector **and** adds fallbacks (any text input inside `calling-prejoin-screen`, or
an input whose aria-label/placeholder matches "name") so a drift there degrades to
`ready-to-join` (still clicks Join) instead of `page-unrecognized`.

## Fix summary (see `adapters/teamsAdapter.ts`)

- Recognize the prejoin by the **container** `calling-prejoin-screen` (+ `prejoin-join-button`)
  rather than by the name input — so recognition survives a name-field drift.
- `ensureMuted`: handle the `role="switch"` mic toggle via `data-cid`/`aria-checked`, keep
  the old `aria-pressed`/label heuristic as a fallback, and never click a `disabled` toggle.
- `clickJoin`: `prejoin-join-button` unchanged; added an aria-label/text fallback.
- Post-join states (lobby/admitted/denied): multi-signal (data-tid + aria-label + text),
  old selectors retained as fallbacks. **VERIFY-LIVE** on the Legion retest.

## Screenshots in this folder

- `guest-prejoin.jpg` — the real anonymous-style prejoin the fix targets
- `prejoin-audio.jpg` — audio/mic panel with the switch toggles
- `passcode-required.jpg` — bare link needs a passcode to complete the join (why live
  lobby/admitted could not be driven from here)
