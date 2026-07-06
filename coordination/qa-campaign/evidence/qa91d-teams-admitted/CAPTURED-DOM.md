# QA-91d — Real Teams in-meeting (ADMITTED) DOM capture (2026-07-06)

**Worker:** cc-lantern-qa91d · **Branch:** lp/qa91d-admitted
**Bug (QA-82 in BUG-DB):** the Notice Card companion webview genuinely reaches the lobby,
is admitted, and becomes VISIBLE to a real attendee — but ~28s later the app's own
detection decides the join failed, force-closes the card (the tile vanishes), and tells
the presenter "couldn't join." Root cause = the `teamsAdapter.ts` **admitted/in-meeting**
selectors no longer match today's real post-admission Teams web DOM, so `detectPhase`
never returns `'admitted'`, `everAdmitted` never flips, and the ~29s unrecognized give-up
fires on the ADMITTED page. (Proven live in `legion-qa91-retest3/REPORT.md`.)

## How this DOM was captured (the ADMITTED state, live from the server)

The server's always-on Chrome (signed in as Jameson Daines, `microsoft@projelli.com`)
was driven with `chrome-cdp`:

1. `teams.live.com` → **Meet** → **Create a meeting link** (title "…QA91d admitted capture"),
   producing a fresh Meet-now meeting.
2. Clicked **Join** → the prejoin → **Join now**. As the meeting's own host, Teams admits
   straight into the meeting (no lobby), rendering the **real in-call calling composite** —
   the exact `/v2/` in-meeting UI a Notice Card guest lands on the moment the host admits it.
3. DOM read with `chrome-cdp eval` (`document.querySelectorAll('[data-tid]')`, plus the
   `outerHTML` of the calling controls). Screenshot `screenshots/01-host-in-meeting-admitted.jpg`
   shows the call controls bar + a running call timer `01:17` + the **Leave** button.

**Why the host view is valid ground truth for the guest ADMITTED state:** once admitted,
every participant — host or anonymous guest — is in the same meeting and renders the same
calling composite (the `ubar-*` controls toolbar, the `hangup-main-btn` Leave button, the
`call-duration` timer, the `stage-layouts-renderer` stage). The retest's
`09-DEFINITIVE-PROOF` screenshot already showed the guest Notice Card tile living inside
exactly this composite. So the admitted signals below hold for the guest webview too.

## The smoking gun

The **old** `ADMITTED_SELECTOR` was:

```
[data-tid="hangup-button"], [data-tid="call-hangup"],
[data-tid="calling-retention-banner"], [data-tid="calling-composite-inner-container"]
```

**NONE of those four exist in today's real in-meeting DOM.** So on the admitted page the old
`detectPhase` fell through to `'loading'` forever → the in-page runner counted 40 ticks
(~28s) → reported `unrecognized` → the supervisor force-closed the card. That is the exact
~28-seconds-after-admit failure in the round-3 retest.

## Captured in-call `data-tid` inventory (the real admitted signals)

From the live capture, the stable in-call-only anchors are:

| Element | Signal | Notes |
|---|---|---|
| `button[data-tid="hangup-main-btn"]` | **PRIMARY** — the Leave/hang-up button | also `id="hangup-button"`, `data-inp="hangup-button"`, `aria-label="Leave"`, tabster name `calling-hangup-main-button` |
| `span[data-tid="call-duration"]` | running call timer (`00:51`, `01:17`) | present ONLY while in a call — a very strong admitted signal |
| `div[data-tid="ubar-horizontal-end"]` | `role="group"` `aria-label="Calling controls"` | the hang-up controls group |
| `div[data-tid="ubar-horizontal-middle-end"]` | `role="toolbar"` `aria-label="Meeting controls"` | Record / Chat / People / Raise / React / View |
| `div[data-tid="ubar-toolbar-wrapper"]` | the whole in-call toolbar wrapper | |
| `div[data-tid="stage-layouts-renderer"]` / `div[data-tid="calling-screen-avatar"]` | the participant stage | |
| `div[data-tid="calling-screen-background"]` | in-call background | |
| `button[data-tid="view-mode-button"]` (aria "View"), `button[data-tid="reaction-menu-button-without-raise-hand"]` (aria "React") | in-call-only controls | |

### Real captured `outerHTML` of the Leave button (classes/styles trimmed)

```html
<button type="button" data-tid="hangup-main-btn" data-inp="hangup-button"
        data-track-module-name="StopMeetingButton" data-track-action-scenario="CallStopMeeting"
        aria-keyshortcuts="Ctrl+Shift+H" aria-label="Leave" id="hangup-button"
        data-tabster='{"observed":{"names":["calling-hangup-main-button"]}}'>…</button>
```

### Real captured call timer + controls groups

```html
<span dir="auto" data-tid="call-duration">00:51</span>

<div role="group"   aria-label="Calling controls" data-tid="ubar-horizontal-end"        id="horizontalEnd">…</div>
<div role="toolbar" aria-label="Meeting controls" data-tid="ubar-horizontal-middle-end" id="horizontalMiddleEnd">…</div>
```

## Fix summary (see `adapters/teamsAdapter.ts`)

- **Admitted detection retargeted on this ground truth.** Recognize the in-meeting page by
  the real in-call anchors — `hangup-main-btn` (+ the `#hangup-button` id / `data-inp`),
  `call-duration`, the `ubar-*` calling/meeting controls (by tid AND by `aria-label`), and
  the `calling-screen-*` / `stage-layouts-renderer` stage — with an `aria-label="Leave"`
  button as a text fallback. The **old** four selectors are KEPT as legacy fallbacks so the
  legacy fixtures still pass.
- **Lobby / denied left as-is (deliberate, disclosed).** They could NOT be re-captured from
  the server: reaching them needs a genuinely separate *anonymous* second identity, which
  the server's single shared signed-in Chrome cannot open (the same limitation documented in
  `qa91b-teams-adapter/CAPTURED-DOM.md`). They did NOT need re-capture: the round-3 Legion
  retest **proved lobby detection works live** — the card reached the lobby and was admitted
  (screenshots `07`/`09`). The ONLY broken state was admitted, now grounded here.

## The second fix, in the runner + supervisor (not a selector change)

Grounding admitted is necessary but not sufficient: any future post-admission page drift
would re-trigger the same self-destruct. So admission is now a **one-way latch** — once the
runner has observed admitted, an unrecognized page can NEVER force-close the card or report
failure. It downgrades to a "state unknown, card presumed present" status and stays in the
meeting until recording stops normally. See `injectionScript.ts` (`present-unknown` token)
and `supervisor.ts` (`handlePresumedPresent`).

## Screenshots

- `screenshots/01-host-in-meeting-admitted.jpg` — the real in-meeting page the admitted fix
  is grounded in: call controls bar (Record/Chat/People/Raise/React/View/More/Camera/Mic/
  Share/**Leave**) + the running `01:17` call timer.
- `raw-capture.json` — the raw `data-tid` inventory + the `ubar-toolbar-wrapper` outerHTML.
