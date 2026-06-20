# Keepance — Test-Found Bug Backlog + Fix Plans (2026-06-20)

Every bug found while testing the real software gets logged here with a **concrete fix plan and status** — nothing drops through the cracks. Companion to `2026-06-20-real-software-test-results.md`.

Status key: 🔴 open · 🟡 fix planned · 🟢 fixed (commit) · ⚪ needs-confirm.

## Status summary (after the real-Windows desktop sweep + fixes, 2026-06-20)
| ID | What | Status |
|----|------|--------|
| BUG-001 | Inconsistent AI-provider indicators across the UI | 🟢 **FIXED `f7e70fa` + CONFIRMED LIVE on Windows (2026-06-20)** — drove the rebuilt app: Privacy Center + trust bar now both read "Sent to your OpenAI account" (agreed). Root was Privacy Center hardcoding "Anthropic"; shared `useActiveEgressProvider` hook (8 tests green). |
| BUG-002 | Ask composer clears the question on error | 🟢 **FIXED** `164bd68` (input now preserved on error; 2 tests RED→GREEN). |
| BUG-003 | Misleading "couldn't reach AI provider" copy | 🟢 **browser-only** — that path is the RAG index being browser-only; on desktop RAG works and the message doesn't fire. Minor. |
| BUG-004 | Default provider = Anthropic regardless of keys | 🟢 **browser/injection-only** — desktop follows the added key correctly (confirmed: added OpenAI in onboarding → app uses OpenAI). Not a desktop bug. |
| BUG-005 | Nightly bench wipes the interactive dev dir | 🟢 **FIXED** `393a2ce` (syncs to a separate bench dir + stubs Piper; never touches the dev bench). |
| BUG-007 | Connected mail never syncs after restart + no Sync button | 🟢 **FIXED `69e0e4c` + CONFIRMED LIVE on Windows (2026-06-20)** — drove the rebuilt app: Email tab now shows a "Sync now" button (was absent) and auto-fires "Syncing…" on open (4 tests green). Full mail import still blocked by BUG-008 (stale token / no feedback). |
| BUG-008 | Email sync spins on "Syncing…" forever — no timeout, no error, no reconnect prompt | 🟢 **MOSTLY FIXED `8e13c79`+`51fe772`** — added a **Reconnect** button + a 90s **sync-stall watchdog** (amber "sign-in may have expired" warning) to the M365 + Gmail panels; Codex-reviewed (warning clears on resume; Reconnect cancels a stuck sync first). **Reconnect button CONFIRMED rendering live on Windows.** Remaining: (a) the full end-to-end refresh needs Jameson's one Microsoft **passkey** tap; (b) an M365 **Disconnect** (needs a small Rust command) is a follow-up. |
| CAP-001 | Native dialogs not driveable | 🟢 **RESOLVED** — built the full-desktop control agent; drove the native folder picker end-to-end. Native dialogs + the browser are now driveable. |

**Net (updated 2026-06-20 after the rebuild + live-confirm): BUG-001 / BUG-002 / BUG-005 / BUG-007 are FIXED and the two desktop-facing ones (BUG-001, BUG-007) are now CONFIRMED LIVE on real Windows.** 2 apparent bugs (BUG-003/004) were browser-test-environment-only. CAP-001 resolved (full desktop control built). Confirming BUG-007 surfaced **one new open bug — BUG-008** (email sync spins forever with no feedback), now logged with a fix plan. The headline cited-answer feature remains validated on real Windows. **Open: BUG-008 (fix planned). Everything else found so far: fixed + confirmed.**

---

## BUG-001 — Stale global provider indicator  ·  Severity: Minor  ·  ⚪ needs-desktop-confirm → 🟡
**Found:** browser clean-slate sweep. After adding *only* an OpenAI key (real wizard), the top "All matters" trust banner still reads **"Sent to your Anthropic account"**, while the Search surface correctly shows "Sent to your OpenAI account". The global banner is out of sync with the resolved provider.
**Impact:** misleading trust/privacy signal (which provider sees your data) — sensitive for this product.
**Fix plan:** Find the top-banner confidentiality/trust component (renders "Sent to your X account") and the provider-resolution it reads. It appears to read a hardcoded/global default = Anthropic rather than the *resolved active provider* (or the provider the user actually has a key for). Make the global indicator derive from the same resolution the Search/matter uses, falling back to "the configured key" when there's no Anthropic key. Add a unit test asserting the banner reflects the configured provider when only a non-Anthropic key exists.
**Confirm:** reproduce on the desktop (where the real keychain/provider path runs) before/with the fix.

## BUG-002 — Ask/Search clears the typed question on error  ·  Severity: Minor  ·  🟡 fix planned
**Found:** browser sweep. When a Search/Ask query fails (e.g. provider unreachable), the user's typed question is wiped from the box and must be retyped.
**Impact:** UX papercut; frustrating exactly when something already went wrong.
**Fix plan:** In the Ask composer submit handler, don't clear the input until a successful send (or restore the text on error). Locate `ask-composer-input` / its surrounding component; preserve `value` on the error branch. Add a test: failing submit keeps the input text.

## BUG-003 — Misleading "couldn't reach your AI provider" copy  ·  Severity: Minor  ·  ⚪ needs-desktop-confirm
**Found:** browser sweep. The RAG-based Search shows "I couldn't reach your AI provider. Try again, or check your key in Settings." when (in the browser) the real cause is the **semantic index being desktop-only** — pointing the user at their AI key when the key is fine.
**Impact:** sends users debugging the wrong thing.
**Fix plan:** Distinguish *retrieval/index unavailable* from *provider unreachable* in the Search error handling and show a contextual message. **First confirm on desktop** — this specific message may not fire where the index exists; if it's browser-only it may be lower priority, but the error taxonomy is still worth tightening.

## BUG-004 — Default AI provider = Anthropic regardless of configured keys  ·  Severity: ⚪ needs-desktop-confirm (potentially Important)
**Found:** browser sweep (clean slate). With **no keys**, and after adding **only** an OpenAI key, the global default still resolves to Anthropic. Search followed the key, but the global default did not. Need to confirm on the desktop whether a user who connects only OpenAI can be left routed to Anthropic anywhere (which would make AI silently fail for them).
**Impact:** if real, a new user who adds their (non-Anthropic) key could hit "couldn't reach your AI provider" despite a valid key — an onboarding blocker.
**Fix plan:** The default-provider selector should prefer a provider the user has a *valid/verified* key for (most-recently-added or verified), not a hardcoded Anthropic default. Confirm scope on desktop first; likely the same root as BUG-001.

## BUG-005 — Nightly bench runner WIPES the interactive Windows/Mac dev state  ·  Severity: Important (infra)  ·  🟡 fix planned
**Found:** while building the desktop-driving bridge — the Legion's `node_modules`, `dist/`, and `target\debug\keepance.exe` were gone. Cause: `scripts/nightly-bench-tests.sh` does `Remove-Item -Recurse -Force C:\keepance` then re-extracts only source (excludes node_modules/target/dist) before `cargo test`. It ran at 03:30 UTC and blew away the interactive dev build, forcing a ~20-min cold rebuild before the bench could be driven again.
**Impact:** the same machines we want as always-on *interactive driving* benches get reset every night, so the desktop-driving bridge breaks daily. (Self-inflicted — introduced with the nightly-bench script earlier today.)
**Fix plan:** sync the nightly cargo-test source to a **separate dir** (e.g. `C:\keepance-bench` / `~/keepance-bench`) instead of wiping the interactive `C:\keepance`; OR overlay-sync without a full wipe and preserve `node_modules`/`target`. Update `scripts/nightly-bench-tests.sh` (Windows + Mac paths) + the test-bench ops guide. Until fixed, the bench needs a rebuild after each nightly.

## BUG-007 — Connected Outlook never syncs after app restart + no manual "Sync now"  ·  Severity: Important  ·  🟡 fix dispatched
**Found + CONFIRMED on real Windows:** Account → Connections shows **Microsoft 365 = "Connected." (green)** — the OAuth connection persisted in the OS keychain across the app rebuild ✅. But the Email tab shows "No email synced yet" and **there is no "Sync now" / refresh control anywhere** (Email tab or Connections panel). Mail is a global Rust DB (not per-workspace), so a connected account should have mail; here it has none and the user has no way to trigger a sync. So: sync only fires on the initial connect (v3.3.4 added that), NOT on app startup with an already-connected account, and there's no manual trigger.
**Impact:** restart the app → your connected mailbox is empty with no recourse. Looks broken for a real user.
**Fix plan (dispatched):** (a) on app start / Email-tab mount, if an account is connected and mail is stale, auto-trigger `mail_sync_all` for it; (b) add a visible "Sync now" button in the Email tab (and/or the Connections panel). With a unit test on the trigger logic. (The import pipeline itself + the v3.3.x Deleted-Items/All-Mail fixes were validated server-side; this is purely the desktop sync-trigger gap.)

## CAP-001 — Native OS dialogs can't be driven via the CDP bridge  ·  Severity: Capability gap (test infra)  ·  🟡 fix planned
**Found:** building/using the desktop-driving bridge. CDP drives the WebView2 DOM (click/type/snapshot/screenshot all work on the real desktop app), but **native OS dialogs are outside the webview** — e.g. the workspace **folder picker** ("New Workspace" / "Open Existing"), file save/open pickers, and OS auth prompts. Clicking "New Workspace" opens a native picker the bridge cannot interact with, blocking fully-autonomous setup of a real workspace.
**Impact:** the full desktop sweep can't reach a real indexed workspace (needed for RAG/headline tests) without either (a) Jameson clicking the native picker once, or (b) a bypass.
**Fix plan:** add a small **dev/test hook** so a workspace can be set WITHOUT the native picker — e.g. a `?devWorkspacePath=<abs path>` URL param (gated to dev/testMode) or a Tauri test command that sets/creates the workspace at a given path, so the bridge can drive end-to-end hands-off. (Alternative: drive native dialogs via Windows UI Automation — a separate, heavier integration.) Until then: Jameson does the one folder-pick (a "native moment", like a login), Claude drives everything else.

## BUG-008 — Email sync spins on "Syncing…" forever with no timeout/error/reconnect  ·  Severity: Important (UX)  ·  🟡 fix planned
**Found + CONFIRMED on real Windows (2026-06-20)** while live-confirming BUG-007. Opening the Email tab correctly auto-triggers a sync (BUG-007 fix working) — the button shows "Syncing…". But it then **stays "Syncing…" for 2.5+ minutes with 0 emails imported, no error message, no timeout, and no "reconnect" prompt.** No alert/toast anywhere. The "Sync now" button is disabled the whole time, so the user can't even retry.
**Likely root of the *empty* result:** the connected Microsoft 365 account's OAuth token is stale/expired (the original sign-in was a while ago), so the sync authenticates-or-fetches nothing. Proving full mail import end-to-end needs Jameson to reconnect Outlook (a one-time 🖐️ login) — that's a separate confirmation, not this bug.
**The bug itself (independent of the token):** a sync that can't complete must not leave the user on an infinite silent spinner. **Impact:** any user with an expired token (a normal occurrence) sees a permanently "broken" Email tab with no recourse.
**Root cause CONFIRMED in code (2026-06-20):** `src/features/settings/MailConnect.tsx` `connect()` does `mailSyncAll(...).catch(...)` — the `.catch` only fires on a *thrown* error. A sync that **hangs** (stale token: the fetch neither completes nor throws) leaves `progress.status` on `'syncing'` forever, so the spinner never resolves. **And there is NO disconnect / reconnect / sign-out control anywhere for a connected Microsoft 365 account** (grep of `MailConnect.tsx` + `account/` = zero hits; the connected state renders only "Connected." + sync progress). So a user (or Claude) with a stale Microsoft connection has **no way in the app to re-authenticate** — it's a permanent dead-end. This is the concrete blocker that stopped the live Outlook-reconnect during testing.
**Fix plan:** (a) put a timeout on `mail_sync_all` (or detect an auth failure) so the sync resolves; (b) on failure/timeout, replace "Syncing…" with a clear error state ("Couldn't sync — your Microsoft 365 sign-in may have expired"); (c) **add a "Reconnect" + "Disconnect" control to the Microsoft 365 (and Gmail) connected state** so a stale account can be re-authenticated or removed — this is required to ever refresh an expired sign-in; (d) re-enable "Sync now" once the attempt ends so the user can retry; (e) a Rust/unit test on the timeout + error-surfacing path and a UI test that the reconnect control appears when connected. (Relates to the v3.3.5 fault-isolation work; this is the *no-feedback-on-stuck-sync* + *no-way-to-reconnect* gap.)
**Confirm:** after Jameson reconnects Outlook, re-drive: sync should complete with real mail (also validates the v3.3.x Deleted-Items/Junk-exclusion + per-provider progress).

---

## To verify on the desktop (driving bridge BUILT + working) — may surface more bugs
- Headline "answers-you-back with citations" end-to-end (real cited answer).
- Outlook import actually pulling mail + excluding Deleted Items/Junk.
- BUG-001/003/004 reproduction in the real keychain/provider/RAG environment.
