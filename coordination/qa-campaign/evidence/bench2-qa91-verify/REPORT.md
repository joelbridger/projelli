# Bench-2 QA-91 Notice Card verify (parallel check) — SUPERSEDED by Legion result

**Date:** 2026-07-06
**Bench:** `lantern-cloud-bench-2` (Azure cloud VM, Tailscale `100.88.113.105`)
**Tip under test:** `4cafb72f` (merge: lp/qa91-noticecard-join — shared WebView2 browser-args fix)
**Worker:** cc-lantern-bench2
**Status:** **STOOD DOWN mid-run by coordinator** — the Legion bench independently ran the same
test against the same tip first and produced the authoritative verdict. This report exists to
record that bench-2's own evidence, gathered independently before stand-down, corroborates the
Legion result exactly (same reason string, same rough timing). Bench-2's own run is not the
official verdict; treat the Legion report as authoritative.

## Result: FAIL (independently corroborated, not authoritative)

**Coordinator-confirmed authoritative verdict (Legion, same tip):** FAIL — `page-unrecognized`
after ~29s. The old WebView2 crash (0x8007139F) is fixed; the Teams join-page recognizer no
longer matches the current Teams web UI.

**Bench-2's own evidence (gathered independently, before stand-down) matches exactly:**

## Setup

1. Brought bench-2 to tip `4cafb72f` (detached HEAD, exact commit — not just branch tip). Had to:
   - Re-authenticate Tailscale (VM logs itself out on every restart — known landmine).
   - Stash uncommitted WIP left on the VM from a prior QA-68 investigation (`git stash`, not
     discarded) before switching to the target commit.
   - `npm install` (package-lock.json changed between the VM's prior commit and `4cafb72f`).
   - Full rebuild via the `LanternDevBench` scheduled task (`npm run tauri:dev`, ~11m 41s,
     Cargo.lock unchanged so this was a relink, not a cold build). CDP port 9223 confirmed live
     afterward.
2. Created a real live Teams meeting via "Meet now" on teams.live.com from the server's
   always-on Chrome (signed in as Jameson Daines) — that Chrome tab is the host/organizer.
3. First attempt used the "QA-Workspace-B-ragleak" workspace already open on bench-2 (leftover
   from a prior QA-68 RAG-leak investigation) — **blocked**, unrelated to QA-91: every client's
   matter-folder metadata in that workspace pointed at a different workspace root
   (`AdvisorPrepHeroSample\<Client>` while the open workspace was `QA-Workspace-B-ragleak`), so the
   app's path-validation guard correctly refused to start any recording ("path escapes
   workspace"). Switched to the clean `AdvisorPrepHeroSample` workspace (already present on this
   bench, correctly rooted) and retried there — this is the workspace where the join actually ran.
4. Pasted the live join URL (`https://teams.live.com/meet/9350727562529`) into the "Record this
   meeting?" dialog's manual Notice-Card-link field, checked consent, started recording.

## What happened

- Recording started cleanly; recorder widget showed **"Notice card joining"** immediately
  (screenshot `01-recording-started-notice-card-joining.jpeg`).
- Polled the host's Teams meeting (Participants panel) every ~15s for ~2.5 minutes — **no lobby /
  admit request ever appeared** on the host side (screenshot `03-host-lobby-no-request-ever.jpg`,
  final poll shown; all polls identical: "In this meeting (1)", host only).
- The recorder widget flipped to **"Notice card couldn't join. Say the notice aloud."** at
  **0:29 into the join attempt** (recording-elapsed showed 3:40, but the notice-card's own
  join-context timestamp vs. failure timestamp in the consent ledger — see below — is the precise
  29s figure; the ~3-min recording-elapsed gap is because recording start and the notice-card open
  are not simultaneous). Screenshot `02-notice-card-couldnt-join.jpeg`.
- No `notice-card-*` webview window was present after the failure (checked via
  `desktop-drive.mjs pages`).

## Root-cause evidence (from the meeting's own consent ledger, ground truth — not inferred from
UI timing)

`AdvisorPrepHeroSample\Whitmore Family Trust\Meetings\.consent-ledger.json`:

```json
{
  "kind": "notice-context",
  "at": "2026-07-06T02:54:37.468Z"
},
{
  "kind": "notice-card-failed",
  "at": "2026-07-06T02:55:06.876Z",
  "reason": "page-unrecognized"
}
```

`02:54:37.468Z` → `02:55:06.876Z` = **29.4 seconds** — matches `UNRECOGNIZED_TICKS = 40` ticks at
`POLL_MS = 700` (~28s) in `src/features/meetings/noticeCard/injectionScript.ts`: the in-page
automation never saw the Teams adapter's `detectPhase()` return anything but "loading" for 40
consecutive polls, so it self-reported `unrecognized`.

**This is a materially different failure signature than the pre-fix QA-91 bug:**

| | Pre-fix (original QA-91 / QA-81) | Post-fix (this run, tip `4cafb72f`) |
|---|---|---|
| Where it fails | Rust `WebviewWindowBuilder::build()` — the companion window **never opens** | The window **opens successfully**; the in-page join automation runs but times out |
| Symptom | `failed to create webview: WebView2 error: WindowsError(HRESULT(0x8007139F), ...)` | `notice-card-failed`, `reason: "page-unrecognized"` |
| Timing | Immediate (Rust-level crash) or ~9 min supervisor watchdog in earlier reports | ~29s — the in-page `UNRECOGNIZED_TICKS` self-timeout |
| Conclusion | Environment/CDP arg mismatch prevented the window from existing at all | The window exists; `teamsAdapter.detectPhase()`'s `[data-tid="..."]` selectors never matched the actual page shown |

**Working hypothesis (not confirmed, worth a follow-up ticket):** `teamsAdapter.ts`'s selectors
(`[data-tid="prejoin-display-name-input"]`, `[data-tid="prejoin-join-button"]`, etc.) look like
they target the **business/enterprise** Teams web client (teams.microsoft.com). This test's join
URL was a **teams.live.com** ("Meet now" personal/consumer Teams) link — a different web app that
may not share the same `data-tid` DOM contract. If so, the notice-card crash (QA-91) is fixed, but
the adapter has a **separate, likely pre-existing gap**: it may never have been verified against
consumer teams.live.com meetings specifically.

## What did NOT regress

- The WebView2 companion-window creation itself: no `0x8007139F` crash, no Rust-level build
  failure. The QA-91 fix (shared browser-args) appears to hold.
- The core recording/audio-capture pipeline: unaffected, worked normally throughout (confirmed via
  growing `.capture/mic-*.wav` / `sys-*.wav` files, stopped cleanly on demand).

## Incidental, out-of-scope observations (not filed as new bugs, for awareness only)

- The recorder-pill widget's elapsed timer got stuck showing "0:00 / Recording…" after clicking
  Stop, even though the underlying audio capture had genuinely stopped (confirmed: `.capture/`
  `.wav` files stopped growing at the same moment). Likely a UI-only staleness bug, unrelated to
  QA-91 — not investigated further per stand-down.
- The `QA-Workspace-B-ragleak` workspace left on this bench from a prior QA-68 investigation has
  broken matter-folder paths for every client in it (see Setup step 3) — blocks recording on any
  client in that workspace. Worth a cleanup ticket if that workspace is reused again.

## Evidence files

- `01-recording-started-notice-card-joining.jpeg` — recorder widget right after start, "Notice
  card joining"
- `02-notice-card-couldnt-join.jpeg` — recorder widget after ~29s failure, "Notice card couldn't
  join. Say the notice aloud."
- `03-host-lobby-no-request-ever.jpg` — host's Teams Participants panel, final poll, showing no
  admit/lobby request ever arrived

## Disposition

Stood down by coordinator mid-second-attempt (was retrying to confirm determinism) once the
Legion's authoritative FAIL verdict on the same tip was confirmed. Bench-2's own evidence, gathered
independently up to that point, matches the Legion result exactly. No further action taken on this
bench; VM left with recording stopped, both Chrome/host and bench-2 app sessions closed cleanly,
scratch files removed, git tree clean at detached `4cafb72f`.
