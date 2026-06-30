# Advisor Prep Hero — Current State (2026-06-18)

> **Read this first.** Supersedes `2026-06-13-CURRENT-STATE.md` for the email-connector
> work. Companion: memory `reference_keepance_email_oauth.md` (the fast validation loop
> + every gotcha). Branch `keepance-3.0`, version **3.3.5**, tree clean, synced (HEAD `52216d5`).

## TL;DR (round 5 — picker follow-ups closed before the build, 2026-06-18)
Jameson chose "polish first, then build", so the four minor picker follow-ups left open in
round 4 were closed before cutting v3.3.5 (one build covers everything). All frontend-only; **no
Rust touched**, so the cargo gate is unaffected. Gates: **typecheck 0 · vitest 3289 passed / 3
skipped (+14 new)** · lint introduces nothing new (ApiKeyWizard back to its 9 pre-existing
findings). Still v3.3.5, **NO build cut yet** — that remains Jameson's explicit go.
- **Verified-provider preference (+ known-invalid exclusion).** A new chat now prefers a provider
  whose key actually passed a live check, and never defaults to one a live check already rejected.
  Per-provider markers (`src/platform/providers/keyVerification.ts`, mutually-exclusive
  verified/invalid) are written by the wizard's validate-on-save (only AFTER the key is persisted)
  and the manager's "Check" (which checks the stored key: working => verified, rejected =>
  invalid). `resolveNewChatDefault` drops known-invalid providers, then narrows to verified ones
  when any remain, then falls back to all present providers when nothing is known (no lockout);
  if every present provider is known-invalid it returns null so "add a key" takes over. Fixes the
  "stale Anthropic key chosen first and fails on message 1" case.
- **Ollama auto-detection in the chat picker.** The picker pings a running Ollama on mount and
  lists its installed models even with no apiKeys entry; local-only mode still hides cloud; fails
  closed off the desktop. (Contained to `ChatModelPicker.tsx`; does NOT touch the cloud
  key/model-fetch path.)
- **Legacy `keepance_default_*` fallback.** The new-chat default now consults the older
  profession-model localStorage keys when the settings-store default is empty
  (`resolveSettingsDefaults`).
- **Manual click-through DONE (the round-4 gap).** Drove the running dev server (Playwright,
  `?testMode=true&mailFixture=1`): with Anthropic present-but-unverified + OpenAI verified, the new
  chat defaulted to **OpenAI** (not Anthropic); the picker dropdown listed all keyed providers
  **plus auto-detected Ollama (llama3.1:8b / llama3.2:3b, "On this computer")**; switching to a
  Claude model updated the header to "Anthropic · claude-sonnet-4-6". Only console error is the
  known `/api/anthropic 401` (expired/fake key model-list fetch). Screenshot: `~/keepance-picker-followups-verified.png`.
- **Codex (gpt-5.5) independent adversarial review** of the whole diff found two valid P2s, both
  fixed + tested: (1) a rejected key could still be re-chosen via the fallback -> added the
  known-invalid marker + exclusion above; (2) the verified marker was written before the save
  succeeded -> moved all marker writes to after a successful save (and the wizard no longer touches
  markers on a rejected *typed candidate*, which would have demoted a good stored key). Codex
  cleared the Ollama picker + legacy-default fallback.
- Commits + CHANGELOG updated under `[Unreleased]`. **NEXT is unchanged: cut the v3.3.5 build on
  Jameson's go**, then this UX wave gets exercised on real Windows alongside the email connectors.

## TL;DR (round 4 — full user-test + UX fix wave, 2026-06-18)
Beyond the email connectors, Jameson asked for a full "drive it like a user" test and then to
fix everything found, autonomously. Done; committed `52216d5`; gates green (typecheck 0, vitest
**3275 passed**). A **repeatable playbook** is saved at `docs/quality/full-user-test-playbook.md`
(+ memory [[keepance-user-test]], + CLAUDE.md ref) — say "run the full user-test playbook".
- 🔴 **AI chat was 100% unreachable** (command-palette action pointed at a removed sidebar surface;
  Ctrl+Shift+A compared lowercase `'a'` while Shift makes `'A'` — also broke Ctrl+Shift+O/+P).
  FIXED earlier (`c9ec30c`), then verified live (an OpenAI "PONG").
- 🟠 **Chat had no model/provider picker** + new chats hardcoded Anthropic. FIXED: `ChatModelPicker`
  in the header + new-chat default resolution (`providerModelResolution.ts`).
- 🟠 **API keys** saved silently with no validation + "Manage" only added. FIXED: validate-on-save +
  a real key manager (list/check/remove, `ApiKeyManager.tsx`).
- 🟡 Key wizard modal too tall (now `max-h-[85vh]` + sticky footer); email compose now closes on
  Escape; 11 user-facing em dashes removed.
- **Open follow-ups (minor):** the new-chat default uses `apiKeys.isValid` = "key present", so a
  present-but-expired key (e.g. a stale Anthropic key) is still chosen first — prefer a *verified*
  provider, or re-validate stored keys. Live Ollama auto-detection isn't wired into the picker (only
  shows if an apiKeys entry exists). Legacy `keepance_default_*` localStorage keys aren't consulted
  (picker uses the settings store `defaultProvider`). The picker's live click-through
  (switch provider → send) wasn't manually finished (it renders + 13 unit tests pass; send pipeline
  proven earlier). ApiKeyWizard carries 9 pre-existing (non-gating) lint findings.

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
   as Advisor Prep Hero (navy shield + wordmark), verified visually, correct 24-bit BMP dimensions.

## TL;DR (round 3 — live validation + 3 more fixes, still v3.3.5)
Jameson asked me to actually USE it, not just unit-test. I imported BOTH his real
mailboxes through the real pipeline (no signed build, via the `*_live_import` harnesses +
driving the logged-in Chrome through consent) AND drove the real UI in a browser
(Playwright on the Vite dev server, `?testMode=true&mailFixture=1`). Found + fixed three
more things:
- **Both mailboxes import clean:** Outlook **5,425** (Sent 4,919 / Inbox 38 / Deleted Items
  466 / Archive 2) and Gmail **966** — all listable, 0 empty subjects/senders/dates, 0
  errors. Proves "imported but not showing" was the window-refresh bug (fixed round 2), not
  the import.
- **Outlook was importing Deleted Items (466)** into confidential search → FIXED (`graph.rs`
  excludes well-known `deleteditems`+`junkemail`, locale-safe; test added).
- **Gmail switched to one All-Mail pass** (Jameson greenlit the matter-mapping tradeoff):
  catches archived mail, no per-label overlap, faster. Proven before→after on the real
  account: 28 labels / 1041 fetches / 811 unique / 233s → **1 folder / 966 fetches / 966
  unique / 211s** (the +155 were archived mail the per-label walk MISSED).
- **Em dash removed** from the Gmail panel copy (house style).
- **UI looks good:** app shell, Email workspace + message list, and the Account→Connections
  panels (M365 + Gmail) all render clean/light/polished. Browser limits (connect + read-body
  are Tauri-only) degrade gracefully; per-provider isolation is component-tested.
Still v3.3.5, NO build cut. New commits: `9d9157b` (Outlook Deleted Items + em dash),
`30b0abe` (All-Mail Gmail).

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
- **Google** OAuth ("Advisor Prep Hero Mail" project, Desktop client): consent screen in **Testing**
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
   doesn't restart; the installer/uninstaller say "Advisor Prep Hero".
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

## Gates (all green)
`npm run typecheck` = 0 · `npx vitest run` = **283 files / 3252 passed / 3 skipped** (+8 new) ·
`cargo check` clean · `cargo test --lib commands::mail` = **green / 0 failed / 4 ignored** (the 4
ignored are the live-OAuth/import harnesses: `gmail_live_smoke`, `gmail_live_import`,
`outlook_live_smoke`, `outlook_live_import`). New unit tests across rounds:
`tests/unit/mail/{mail-store-per-provider, mail-connector-isolation, email-refresh-on-import}`;
cargo `should_sync_provider_*`, `list_folders_excludes_deleted_and_junk` (graph),
`list_folders_returns_single_all_mail`, `all_mail_backfill_omits_label_filter` (gmail).
**Live-validated against the real mailboxes** (see round-3 TL;DR).
