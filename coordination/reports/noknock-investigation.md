# Investigation — Notice-Card guest never knocks (~1/3 of joins)

**Worker:** cc-lantern-noknock · **Branch:** `lp/notice-noknock` · **Date:** 2026-07-06
**Mode:** code-first investigation (no bench access — Legion pinned, cloud bench busy)
**Status:** root-cause hypotheses ranked below; a bounded fix (one pre-admission retry + diagnostics) is implemented on this branch.

---

## 0. TL;DR for a non-engineer

When you hit record, the app quietly opens a little second "browser guest" that walks into your Teams meeting and holds up a "this call is being recorded" sign. About one time in three, that guest gets lost on the way in and never even knocks on the meeting door — so the host never sees a join request, and the app falls back to "say the notice aloud."

Two things make this happen and keep it invisible:

1. **The guest only ever tries once.** If its first walk-in gets confused by a loading page or a pop-up it doesn't recognize, it gives up for good. Everyone else in the app (the recorder, the co-editing) gets a second try; this guest doesn't.
2. **The guest keeps its shoes on between calls.** It reuses the same saved browser state (cookies, "remember how I join" choices) every time and shares it with the main app. So a leftover choice from a previous call can quietly send it down a different, unrecognized path on the next call — which is exactly the kind of thing that would make it fail *sometimes* and not others, on the *same* laptop.

The fix I shipped on this branch gives the guest **one clean second try** and adds a **breadcrumb log** so the very next real test on Windows will tell us *exactly* where it got stuck — which we currently cannot see. A deeper fix (give the guest a fresh pair of shoes each call) is recommended but needs a live Windows test to do safely, so I did **not** do it blind.

---

## 1. The pipeline, end to end

`record start` → `startNoticeCard` (`noticeCardLifecycle.ts`) builds:

- a **driver** (`makeTauriDriver`, `tauriDriver.ts`) that calls the Rust command `notice_card_open`,
- a **supervisor** (`NoticeCardSupervisor`, `supervisor.ts`) — the state machine,
- a **status poller** (`startStatusPoller`, `tauriDriver.ts`) reading the window title every 700 ms.

`supervisor.start(config)`:
1. Guards: empty URL → `fail('no-join-url')`; non-auto-join platform → `fail('unsupported-platform')`.
2. `openWindow()` → `driver.open()` → `rewriteTeamsJoinUrl()` (`meetingPlatform.ts`) rewrites a Teams `/l/meetup-join/` or `/meet/` link to the direct `/v2/?meetingjoin=true#…` web route (skips the "browser or app?" launcher), then `invoke('notice_card_open', …)`.
3. Rust (`notice_card/mod.rs`) creates an **isolated companion webview** with `initialization_script` = `buildInjectionScript()` and mirrors the page title into the native title (`on_document_title_changed`) so the poller can read it.
4. Inside the webview, the injected runner (`injectionScript.ts`) ticks every 700 ms: `detectPhase(document)` (`teamsAdapter.ts`) → drives `dismissLauncher` / `fillGuestName` / `ensureMuted` / `clickJoin`, and writes `NC:<phase>` into `document.title`.
5. The poller reads `NC:<phase>` → `applyTitleStatus` → supervisor `handle*` methods → `joining → lobby → admitted`.

**"Knock" = reaching the Teams lobby** (`report('lobby')`), which is the first thing the host sees. A "total no-show" means the runner never got `detectPhase` to return `lobby`/`ready-to-join`, so `clickJoin` never fired **or** fired against a page that never advanced.

This is distinct from the already-fixed QA-91 layers: QA-91 (WebView2 `0x8007139F` creation crash — `webview_env.rs`), QA-91b (stale prejoin selectors), QA-91c (launcher interstitial), QA-91d/QA-82 (post-admission self-destruct latch). Those all landed. The remaining ~1/3 is a *pre-lobby* failure on runs where the window **does** open.

---

## 2. Where the pipeline can silently produce zero knock

Every pre-admission give-up funnels into **one of two terminal calls, neither of which retries**:

| Trigger | Path | Terminal | Retry today? |
|---|---|---|---|
| `detectPhase` sits in `loading` / launcher-stuck for 40 ticks (~28 s) | `injectionScript` `loadingTicks > UNRECOGNIZED_TICKS` → `report('unrecognized')` → `handleFailed('page-unrecognized')` | `fail('page-unrecognized')` | **No** |
| Never reaches `admitted` within 120 s | supervisor `joinTimer` → `fail('join-timeout')` | `fail('join-timeout')` | **No** |
| Window vanishes **before** admission | poller null title → `handleDisconnected()` — **ignored pre-admission** (only acts on `present`/`present-unknown`) | (falls through to 120 s `join-timeout`) | **No** |
| `ready-to-join` but Join button stays disabled | `injectionScript` calls `clickJoin` but **ignores its return value** and reports `'joining'` with **no give-up clock** in that branch | 120 s `join-timeout` | **No** |

`handleDisconnected` grants exactly **one** rejoin, but **only post-admission** (`_status.phase` must be `present`/`present-unknown`). The one place we already decided a retry is correct, we scoped it to *after* the card is in — the *pre-lobby* leg, where this bug lives, has **no** retry at all. Verified by the existing test *"the NEVER-ADMITTED fast-fail … a page-unrecognized still fails+closes"* — one call, immediate terminal.

**So: any single transient pre-lobby hiccup = permanent no-knock.** That is the amplifier that turns an occasional glitch into the observed 1-in-3 total no-show.

---

## 3. Root-cause hypotheses (ranked by evidence)

### H1 — Persistent + shared WebView2 profile contaminates the launcher/prejoin path across runs *(strongest for the intermittency)*

**Evidence (code-grounded):** `notice_card_open` (`notice_card/mod.rs:60`) builds the companion window with **no `data_directory`**, so it shares the app's single default WebView2 user-data-folder — this is *forced* by the `0x8007139F` invariant (`webview_env.rs`): every webview on one user-data-folder must use identical browser args, and the fix deliberately made the companion window share the main window's args/folder. Consequence: **cookies, `localStorage`, IndexedDB, service workers and Teams' "how do you want to join / remember my choice" preference persist between recordings and are shared with the main app webview.** The `rewriteTeamsJoinUrl` doc comment even assumes a *"cookieless"* companion webview — but it is not cookieless; it inherits whatever the last run (or the main app's own Teams/M365 usage) left behind.

**Why it produces 1-in-3, same machine, total no-show:** on a clean profile the `/v2/?meetingjoin=true#…` route loads the anonymous prejoin directly (runs 1–2 worked). On a run where a stale cookie / `deeplinkPreference` / prior-session token is present, Teams can (a) bounce back through the launcher, (b) land on a "you're already signed in as … / switch account" or "resume" interstitial, or (c) short-circuit the anon flow — none of which `detectPhase` recognizes → 28 s `page-unrecognized` (or worse, a `ready-to-join` on a page whose Join never advances → 120 s timeout) → terminal, **no knock**.

**Falsifiable prediction:** giving the companion window an **ephemeral/isolated profile per run** (fresh cookies each time) removes the run-to-run variance — the failure rate stops depending on history. Conversely, seeding the shared profile with a Teams "open in app" preference should reproduce the no-show on demand.

**Why not fixed blind:** changing `data_directory` interacts directly with the delicate `0x8007139F` args-vs-folder invariant (a second environment on a *new* folder must still not conflict; and an isolated in-memory profile may change autoplay/media behavior the card relies on). This **must** be verified live on Windows. → recommended follow-up, not implemented here.

### H2 — No pre-admission retry (the amplifier) *(highest-confidence, fully in our code, bounded)*

**Evidence:** §2 above — proven by reading `supervisor.ts` and the existing test suite. Whatever the *transient* trigger (H1, H3, or a cold-load timing miss), the single-shot give-up converts it into a permanent failure. If each independent attempt fails ~1/3 of the time, a single clean retry drops the compound no-show rate from ~33 % to ~11 %.

**Falsifiable prediction:** adding one fresh re-open cycle before the terminal `fail` measurably reduces the observed no-show rate and never double-knocks (because it is gated on *never reached lobby*).

**This is the fix implemented on this branch (§5).**

### H3 — An unhandled one-off interstitial (cookie/consent/region/"get the app") banner *(plausible, needs live capture)*

**Evidence:** QA-91c already had to special-case the launcher chooser; Teams web A/B-tests cookie-consent, region, and promo interstitials that `detectPhase` treats as `loading`. On runs where one appears, the runner never reaches prejoin → 28 s `page-unrecognized` → no knock. Intermittent because it is A/B- and cookie-state-dependent (overlaps H1).

**Falsifiable prediction:** the diagnostic breadcrumbs (§5) will show the runner parked in `loading`/`launcher` on failing runs with the prejoin container never appearing; a DOM capture of a failing run will show the specific banner to add to `dismissLauncher`.

**Why not fixed blind:** we have **no capture** of a failing run's DOM — adding a guess-selector without evidence risks clicking the wrong control. → diagnostics first, then a grounded selector fix.

### H4 — Cold-load timing race: prejoin renders slower than the 28 s give-up *(possible amplifier of H1/H3)*

**Evidence:** `UNRECOGNIZED_TICKS = 40` (~28 s) is a fixed budget. The give-up runs on the same laptop that is *already recording* (CPU/disk busy) and cold-loading the heavy Teams SPA in a second webview. On a loaded run the recognizable prejoin container can render after the budget, tripping `page-unrecognized` before the page was actually ready. Intermittent by definition (load-dependent).

**Falsifiable prediction:** breadcrumbs will show `page-unrecognized` firing while the page was still transitioning; raising/again-retrying the budget (the §5 retry effectively grants a second ~28 s window) reduces the rate.

### H5 — Join button disabled → stuck `joining` until 120 s timeout *(lower rank; contributes, not primary)*

**Evidence:** `injectionScript` `ready-to-join` branch calls `clickJoin` but **ignores the boolean return** and reports `'joining'` unconditionally, and that branch has **no** `loadingTicks` give-up. If Teams keeps Join disabled (media init, a device-permission prompt in the companion webview), the runner reports `joining` forever → 120 s supervisor timeout → no knock. Reads as "never knocked" if the user stops before 120 s.

**Falsifiable prediction:** breadcrumbs showing prolonged `joining` with `clickJoin` returning `false` confirm it; a fast-fail when `clickJoin` stays false for N ticks (mirroring the launcher path) would surface it in ~28 s instead of 120 s.

---

## 4. What telemetry is missing to prove this live

Today the status channel collapses **every** pre-lobby failure to a single `NC:unrecognized` (or a silent 120 s timeout) with **no record of how far it got**: which phase `detectPhase` last returned, whether `dismissLauncher`/`clickJoin` acted, the page URL, or which give-up fired. That is why the live root cause (H1 vs H3 vs H4) cannot be discriminated from the current evidence. The minimum needed:

1. **Supervisor breadcrumbs** — each attempt start, each pre-admit give-up (+reason), retry, admit, terminal. *(added in §5).*
2. **In-page phase trail** — the runner's last-seen `detectPhase` value + `doc.URL` + whether Join was found/disabled, surfaced on give-up. *(recommended; see §6 — kept out of this diff to stay bounded, but it is the single most valuable next probe).*

With (1)+(2), one real Windows run of a failing join tells us exactly which hypothesis is true.

---

## 5. Bounded fix implemented on this branch

**Scope (≪2 h, framework-free, unit-tested in the supervisor):**

1. **One pre-admission retry.** When the card gives up **before ever reaching the lobby** (`page-unrecognized` or a pre-lobby `join-timeout`), the supervisor now performs exactly **one** fresh re-open (destroy + re-navigate the companion window, restart the join timer) before the terminal `fail`. Gated on `!everAdmitted && !everReachedLobby && !preAdmitRetryUsed` and only for the two "stuck/unrecognized" reasons — so it **never** retries `denied` (host said no) or a lobby timeout (the card *did* knock; re-knocking would double-signal the host), and never fabricates presence. A fresh navigation re-runs the whole launcher→prejoin→knock flow, dodging a transient interstitial/timing miss (H3/H4) and giving H1 a second roll of the dice.
2. **Diagnostic breadcrumbs.** A new optional `onDiagnostic` supervisor dependency emits `attempt` / `pre-admit-giveup` / `admitted` / `terminal` events; the lifecycle glue wires it to a tagged `[notice-card]` console log so the next bench run shows the attempt trail and which give-up fired.

**Why this and not more:** the retry attacks the amplifier (H2) that makes *every* transient permanent, and it is the one change that is unambiguously correct and safe without a live bench. The profile-isolation fix (H1) and the in-page phase trail (H4/H5) are higher-surface and touch the `0x8007139F` invariant / the injected runner — they need real-Windows verification and are called out as the next step rather than shipped blind.

**Feedback loop (per the diagnosing-bugs skill):** the code-bounded part is proven at the supervisor seam with a scoped Vitest that goes **red** on current code (immediate terminal on first `page-unrecognized`) and **green** after the retry. Command: `npx vitest run src/features/meetings/noticeCard/supervisor.test.ts`. The *live* root cause (H1/H3/H4) is explicitly **not** claimed proven — that requires the bench + the §4 telemetry.

---

## 6. Recommended follow-ups (need a live Windows bench)

- **H1 — isolate the companion profile per run.** Give the notice-card webview an ephemeral/per-recording `data_directory` (or clear its cookies/storage on open) so run N+1 is never contaminated by run N, **while preserving** the `webview_env.rs` args invariant. Verify no `0x8007139F` regression and that media/autoplay still work. *Highest-leverage true fix.*
- **H4/H5 — in-page phase-trail telemetry + Join-disabled fast-fail.** Have the runner report its last-seen `detectPhase` + URL on give-up, and fast-fail (not 120 s) when `clickJoin` stays `false`. Grounds the next selector/interstitial fix in real evidence instead of a guess.
- **H3 — grounded interstitial handling.** After a failing-run DOM capture, extend `dismissLauncher`/`detectPhase` for whatever cookie/consent/region banner shows up, the same way QA-91c grounded the launcher.
- **Standing:** keep the ~1/3 no-show on the QA board until a live 3×-clean run confirms the retry (and, ideally, the profile isolation) closed it.
