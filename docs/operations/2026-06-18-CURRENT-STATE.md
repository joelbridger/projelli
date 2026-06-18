# Keepance — Current State (2026-06-18)

> **Read this first.** Supersedes `2026-06-13-CURRENT-STATE.md` for the email-connector
> work. Companion: memory `reference_keepance_email_oauth.md` (the fast validation loop
> + every gotcha). Branch `keepance-3.0`, HEAD = `v3.3.4` commit, tree clean, synced.

## TL;DR
A round of email-connector + onboarding fixes (from Windows testing) is built into
**desktop v3.3.4**, which is **built (signed, all platforms) but NOT published** — it's
a DRAFT awaiting Jameson's test + explicit publish go. Last PUBLISHED release is still
**v3.3.0**. Both email connectors (Gmail + Outlook) were validated server-side against the
real providers.

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
1. **Test v3.3.4** (installer served at `http://100.68.20.52:8791/Keepance_3.3.4_x64-setup.exe`):
   Outlook connects (outlook.com); Gmail connects (jamesondaines4@gmail.com) AND imports mail;
   no flash; "Connect your email" -> Account/Connections.
2. **On his "publish"** (commercial deploy boundary — needs explicit go):
   - `gh release edit v3.3.4 --draft=false`
   - update keepance.com download links v3.3.0 -> v3.3.4 in `website/*.html`, then `bash infra/deploy.sh`
     (dry-run `--delete` first; Caddy serves 404s as 200, so check the page body)
   - verify live + the auto-updater `latest.json` points at v3.3.4.

## Open / watch
- The **live Gmail import** is the one piece not server-validated (the app's sync runtime can't
  run on the server) — confirm it imports when testing. The fix targets exactly why it was empty.
- Background servers running: dev `:5173` (https), installer `:8791`. Keep `:8791` up until Jameson downloads.
- Draft releases v3.3.1/3.3.2/3.3.3 are superseded by v3.3.4 (deleted/ignorable).

## Gates (all green this session)
`npm run typecheck` = 0 · `npx vitest run` = 280 files / 3244 passed / 3 skipped · `cargo check` +
targeted mail tests green.
