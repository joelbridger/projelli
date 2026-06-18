# Keepance — Current State (2026-06-18)

> **Read this first.** Supersedes `2026-06-13-CURRENT-STATE.md` for the email-connector
> work. Companion: memory `reference_keepance_email_oauth.md` (the fast validation loop
> + every gotcha). Branch `keepance-3.0`, version now **3.3.5**, tree clean.

## TL;DR (round 2 — v3.3.5)
Jameson tested the v3.3.4 build on Windows and hit five email-connector/UI bugs. All five
are **fixed in source and version-bumped to 3.3.5**, with automated tests proving the logic
(full vitest 3252 green incl. 8 new; cargo mail 183 green incl. 2 new; typecheck + cargo
check clean). **No v3.3.5 build exists yet** — the Rust sync changes + the live import can
only be exercised in a running Windows app, so a v3.3.5 build is the next step (Jameson's go;
he is tired of the build-per-fix loop, so everything testable was proven server-side first).
Last PUBLISHED release is still **v3.3.0**; v3.3.4 remains a superseded draft.

### The five 3.3.5 fixes (root causes)
1. **MS panel showed Gmail's count / Gmail showed MS's error** — the sync progress event had
   no provider tag and the frontend kept ONE global progress object that both panels read.
   Fix: tag every event with its provider; store progress keyed by provider; each panel reads
   only its own. (`SyncProgress.provider`, `mailStore.progressByProvider`.)
2. **Connecting one account failed because of the other** (connecting M365 errored on a stale
   leftover Gmail token) — `mail_sync_all` ran every provider in one function with `?`
   propagation, so any provider's failure error-flagged the whole sync. Fix: each provider is
   a fault-isolated section (`sync_{m365,imap,gmail}_section` + `finish_section`) that emits
   its own terminal event; plus connecting scopes the sync to that one provider
   (`mail_sync_all(only_provider)` / `mailSyncAll(map, 'm365'|'gmail')`).
3. **Import count "restarted" from 0** — each folder's counter reset to 0; Gmail's many labels
   made it look like a restart. Fix: cumulative per-provider total across folders
   (`sync_one_folder` carries `base_written/base_removed`).
4. **Imported mail didn't appear in the Email tab** — the connectors live in a SEPARATE window;
   the Email tab queried once on mount and only reloaded *accounts* (not messages) on focus.
   Fix: `EmailWorkspace` re-queries the list on window focus AND on the sync 'done' event.
5. **Installer/uninstaller still said "Projelli"** — `src-tauri/icons/installer-{header,sidebar}.bmp`
   were pre-rebrand artwork (no text to grep; baked into the NSIS bitmaps). Fix: regenerated both
   as Keepance (navy shield + wordmark), verified visually, correct 24-bit BMP dimensions.

## TL;DR (round 1 — v3.3.4, superseded draft)
A round of email-connector + onboarding fixes (from earlier Windows testing) is built into
**desktop v3.3.4**, which is **built (signed, all platforms) but NOT published** — it's
a DRAFT. Both email connectors (Gmail + Outlook) were validated server-side against the
real providers. v3.3.5 carries all of v3.3.4 forward plus the five fixes above.

## What shipped this session (all on keepance-3.0)
Original Windows-testing feedback (all fixed):
- **"Projelli" gone:** app uninstaller already clean; the real leak was checkout, now LIVE
  on **checkout.keepance.com** (LemonSqueezy custom domain on the existing store; keepance.com
  Subscribe links swapped + deployed; zero "projelli" customer-facing).
- **Windows console flash:** all child-process spawns + browser-opens routed through a
  no-window helper (`src-tauri/src/util/proc.rs`).
- **Onboarding "How do you practice?":** 3 clear options (Create firm / Join firm / Continue solo).
- **Product tour:** added Workflows, Privacy Center, Settings, Account.

Email connectors (the hard part, iterated v3.3.1 -> v3.3.4):
- **Gmail:** Desktop client_secret added to the token exchange (injected from CI secrets,
  not source); connect now triggers the import; `mail_sync_all` no longer aborts on the
  missing M365 token when only Gmail is connected (guarded behind `mail_is_connected`).
- **Outlook:** rewrote device-code -> loopback PKCE (`outlook_connect`); personal MS accounts
  need a **localhost** loopback (not 127.0.0.1); auth code is now URL-decoded before exchange
  (MS codes contain percent-encoded chars -> was `invalid_grant`).
- **UI:** "Connect your email" + the Setup-checklist email row now open **Account -> Connections**
  (where the connectors live), not AI settings; real OAuth errors surfaced.

## The velocity fix (answers "stop building per fix")
Connectors are Tauri-native, so they can't be tested in the browser dev server. They CAN be
validated **on the server** with no signed build: ignored dev tests `gmail_live_smoke` /
`outlook_live_smoke` (in `src-tauri/.../mail/{gmail/oauth,oauth}.rs`) + driving the logged-in
Chrome through consent + reading the auth code from CDP (`curl http://127.0.0.1:9223/json`).
Both Gmail + Outlook token exchanges were validated this way (refresh tokens returned).
Full details + gotchas: memory `reference_keepance_email_oauth.md`.

## Config done (no code)
- **Azure** app `845ddba0-...` (tenant microsoft@projelli.com): `http://localhost` registered;
  the bad `oauth20_desktop.srf` removed; "Allow public client flows" on.
- **Google** OAuth ("Keepance Mail" project, Desktop client): consent screen in **Testing**
  mode -> only `jamesondaines4@gmail.com` can connect Gmail; the "unverified app" screen needs
  Google verification (restricted Gmail scopes) for GA.
- **Gmail creds** are GitHub Actions secrets `KEEPANCE_GMAIL_CLIENT_ID` / `_SECRET`, injected at
  build via job-level `env:` in `.github/workflows/release.yml` (never hardcode — push protection blocks).

## NEXT (Jameson's calls)
1. **Cut a v3.3.5 build** to Windows-test the five fixes. They are proven server-side (tests
   below) but the live import + multi-window refresh only run in the real app. Building is the
   expensive CI+sign step Jameson wanted to avoid, so it is his explicit go. The build runs on a
   git tag via `.github/workflows/release.yml` (produces a DRAFT release + installers + the
   auto-updater `latest.json`); tag `v3.3.5` on `keepance-3.0` when ready.
2. **Test v3.3.5** on Windows: Outlook connects and imports; Gmail connects and imports AND the
   mail appears in the Email tab; the two panels never show each other's count/error; the count
   doesn't restart; the installer/uninstaller say "Keepance".
3. **On his "publish"** (commercial deploy boundary — needs explicit go):
   - `gh release edit v3.3.5 --draft=false`
   - update keepance.com download links v3.3.0 -> v3.3.5 in `website/*.html`, then `bash infra/deploy.sh`
     (dry-run `--delete` first; Caddy serves 404s as 200, so check the page body)
   - verify live + the auto-updater `latest.json` points at v3.3.5.

## Open / watch
- The **live Gmail/M365 import + the multi-window Email-tab refresh** are the pieces that can only
  be exercised in the running app (the sync runtime won't run server-side). Everything else (per-
  provider isolation, scoping, cumulative count, the refresh trigger logic, the installer images)
  is covered by automated tests.
- Background servers running: dev `:5173` (https), installer `:8791` (still serving the OLD 3.3.4
  installer — re-point or stop it once a 3.3.5 installer exists).
- Draft releases v3.3.1/3.3.2/3.3.3/3.3.4 are superseded by v3.3.5.

## Gates (all green, round 2)
`npm run typecheck` = 0 · `npx vitest run` = **283 files / 3252 passed / 3 skipped** (+8 new) ·
`cargo check` clean · `cargo test --lib commands::mail` = **183 passed / 0 failed / 2 ignored**
(the 2 ignored are the live-OAuth smoke tests). New tests: `tests/unit/mail/mail-store-per-provider`,
`mail-connector-isolation`, `email-refresh-on-import`; cargo `should_sync_provider_*`.
