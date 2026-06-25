# Keepance Live-Demo Setup — Build State (updated 2026-06-25, session 2)

Goal: a repeatable demo control panel on the Legion bench (`james@100.127.67.22`, Tailscale)
so Jameson can show people the product. Bench is a **dedicated testing bench** (do NOT use it
as a Parsec *client* — that steals its screen and crashes the GUI app).

Jameson is a product designer, not an engineer — explain plainly. He wants the demo **fully
functional first, THEN a dedicated UI pass** (hold all UI changes until the end).

## The demo, in plain terms
- **LOADED mode**: a full firm (Northcrest Wealth Partners, 26 clients) pre-loaded + indexed.
  Every client shows an instant "client map" (a one-page picture of the household). One client
  (the **Brennans**) is set up but their map is NOT built — on stage Jameson clicks "Client Map"
  and people watch it build itself in ~15 seconds. Asking questions returns cited answers.
- **BLANK mode**: a true first-run (onboarding wizard), build it up live with a small client.
- **Fake advisor email inbox** (Sarah Morgan, CFP) connected in-app, so a question can be
  answered from a real client email, cited.
- **One-click reset** between showings + simple desktop buttons (self-serve via Parsec).

---

## ✅ DONE (and verified live on the bench)

### LOADED mode — fully working
- **26 clients, all with rich pre-built client maps** (17–43 items each, 736 items total, none
  empty). Built by driving the UI; captured into the seed. Every client Jameson clicks shows an
  instant map.
- **Brennan live-build verified**: matter exists, folder mapped, its 5 `.txt` files indexed and
  **matter-tagged** (via `rag_retag_matter`, `absFwd` path format), cited Ask returns
  **"$8,540,000"** with a citation chip + green "answered over your own files" attestation, and
  the client map **builds in ~15s → 43 items** when you click Client Map. In the shipped seed
  Brennan's map is REMOVED so it builds fresh, live, on stage.
- **Feature tour suppressed** (`keepance:settings` → `state.featuresTourCompleted:true`) so it no
  longer blocks navigation after a reset.
- **Residue cleaned**: removed the orphan empty client map from the prior session.

### Reset scripts — working (run from the server through the CDP tunnel)
- `scripts/demo/reset-loaded.mjs` — wipes localStorage residue, lays down the captured LOADED
  seed (`scripts/demo/seed-loaded.json`: 27 matters incl. Brennan, 26 client maps EXCLUDING
  Brennan, advisor settings with tour suppressed + confidentiality already chosen), reopens the
  Northcrest workspace, dismisses any tour, verifies (27 matters / 26 maps / Brennan unbuilt).
  Verified OK. Brennan's index tagging lives in LanceDB so it survives the localStorage wipe.
- `scripts/demo/reset-blank.mjs` — clears all localStorage + reloads → boots to first-run. Verified OK.
- The OpenAI key (OS keychain) and the LanceDB index survive both resets.
- **Known cosmetic edge:** reopening the workspace re-runs the PDF index pass ("Indexing PDFs:
  X/301, nothing leaves your machine") for ~7.5 min. The app is FULLY usable during it (the index
  data is already on disk; Ask/maps work immediately). It's on-message (privacy). Reset a few
  minutes before showing someone. Making it skip already-indexed PDFs would be a core-app change
  (out of scope for demo tooling).

### Email inbox — ✅ DONE end-to-end (2026-06-25 session 3): emails in inbox, connected, cited Ask works
- **Account: `sarah.morgan.cfp@outlook.com`** (advisor persona "Sarah Morgan, CFP"), verified by
  Jameson (added jamesondaines@outlook.com as forwarding + recovery). Logged into the always-on Chrome
  (session `graph-consent`).
- **IMAP path FAILED — Microsoft anti-abuse lock on the brand-new account.** Even after enabling IMAP
  (Outlook web → Settings → Mail → Forwarding and IMAP, toggle ON), IMAP login still returns "User is
  authenticated but not connected" on all hosts (outlook.office365.com / imap-mail.outlook.com). The
  token is fine (XOAUTH2 passes); the mailbox just blocks 3rd-party IMAP/POP on new accounts until they
  age. NOT fixable on our timeline. `populate-inbox.py` (IMAP APPEND) is kept as a fallback for when the
  lock lifts, but we did NOT use it.
- **What WE USED — send the emails IN via Brevo (works immediately):**
  `scripts/demo/brevo_send.py all` sends the 15 client emails TO Sarah from a Brevo-**verified** domain
  (`jamesondaines.com`) with the real client **display names** (Thomas Brennan, Priya Patel, ...). Data
  lives in `scripts/demo/inbox_emails.py`. They arrive as genuine received mail with correct sender
  NAMES. Two cosmetic compromises vs IMAP: sender ADDRESS is `first.last@jamesondaines.com` (not a
  gmail), and DATES are "today" (Brevo can't backdate). Brevo first lands them in **Junk** — fixed by
  adding `jamesondaines.com` to Sarah's Safe-senders list (Outlook web → Settings → Mail → Junk email);
  after that all 15 go straight to Inbox. Verified all 15 in Sarah's Inbox.
- **Connect in Keepance on the bench — did NOT use the in-app browser OAuth** (the connector opens the
  bench's *system* browser, which we can't drive). Instead:
  1. Got a **Graph refresh token** for Keepance's own connector client (`845ddba0-70ab-4f90-88ba-e3522157e37a`,
     scopes `offline_access openid User.Read Mail.Read Mail.Send`, redirect `http://localhost`) via the
     always-on Chrome (Sarah already logged in → no password). Auth-code+PKCE, no secret. Scripts in
     scratchpad: `oauth_url_graph.py` + `oauth_exchange_graph.py`. Verified the token reads all 15 via Graph.
  2. **Injected the refresh token into the bench's Windows Credential Manager** (service `keepance-mail-ms`,
     key `ms-refresh-token` — what `mail_is_connected` / `fresh_access_token` read). Used a tiny Rust helper
     (`C:\Users\james\kcset`, `keyring = "3" features=["windows-native"]`, same crate as the app so the
     credential format matches exactly). **Must run in the INTERACTIVE desktop session** — over SSH it
     fails with `NoStorageAccess(1312)`; run it via a one-shot scheduled task (`run-kcset.ps1`).
  3. Triggered import: `window.__TAURI__.core.invoke('mail_sync_all', { matterMap: [], onlyProvider: 'm365' })`
     (matterMap is an ARRAY, not an object). → **20 messages written** (15 clients + 5 MS welcome). Account
     window then shows "Connected. All mail imported and searchable."
- **Cited-from-email Ask — VERIFIED.** "What did Thomas Brennan ask me about converting his IRA to a Roth
  before year-end?" → grounded answer with 3 citation chips + green "Answered over your own files"
  attestation, drawn from his actual email (Traditional IRA → Roth, lower bracket after business sale,
  $200k Cascade Climate lock-up). Screenshot in scratchpad `cited-email-answer.png`.
  - **⚠️ Demo-question rule (important):** the question must be SPECIFIC to the target email's content.
    A generic "What did Thomas Brennan email me about his **retirement accounts**?" retrieves the WRONG
    client (Carol Greer's "worried about the market" email also matches "retirement accounts") and the AI
    honestly declines. Embeddings match topic, not sender name. Use content-specific questions (Roth
    conversion, 529, RSU concentration, QCD, etc.). Retrieval is global top-8 then filtered to email, so
    the target email must out-rank documents+other-emails for that query.
  - **Two demo flows, both verified:**
    1. **GLOBAL** (no active client): clear `activeMatterId` → ask a CONTENT-SPECIFIC question (Roth
       conversion, 529, etc.). Works but needs careful wording (see rule above).
    2. **OPEN-CLIENT-THEN-ASK (recommended — robust, no careful wording):** the 14 client emails are now
       **tagged to their matters** (`scripts/demo/bench-tag-emails.mjs`, via `mail_retag_message_matter`
       — in-place RAG retag, no re-embed, matched by surname; only "Hollings Family Office" unmatched).
       Open a client (sets activeMatter) → Email scope → even a VAGUE question ("What did this client
       email me about their retirement accounts?") returns a cited answer from THAT client's email,
       because retrieval is scoped to the matter (no cross-client confusion). Verified in Brennan's hub:
       3 chips + "Answered over your own files". Screenshot `ask-matter-scoped.png`.
       Re-run after a fresh import: `node scripts/demo/bench-tag-emails.mjs`.

---

## REMAINING (priority order)

1. **Email inbox — ✅ DONE** (see the DONE section above). To re-run after a wipe: `brevo_send.py all`
   → ensure `jamesondaines.com` is in Sarah's Outlook Safe-senders → get a fresh Graph refresh token
   (`oauth_url_graph.py`/`oauth_exchange_graph.py` via the `graph-consent` Chrome) → inject via kcset
   scheduled task → `mail_sync_all`. Note the **refresh token is the only durable bit**; the bench
   keychain entry survives restarts, so a connected state persists. The 20 imported messages live in
   the workspace's encrypted mail store + LanceDB (survive app restarts).

2. **BLANK mode — ✅ staged + foundation verified.** Staged on the bench at
   **`C:\keepance-demo-blank`** = the small Brennan client folder (6 `.txt` files, $8.54M; the
   "drag-in to build the map live" set from `scripts/demo/staged-live-client/`). `reset-blank.mjs`
   boots to first-run (verified bench-local: clears 20 localStorage keys → "Your practice folder…
   Open Existing / New Workspace"). The live build-up itself (onboarding wizard → open
   `C:\keepance-demo-blank` → build the client map) is the **presenter's live flow** through the
   interactive FirstRunWizard; its pieces are each verified (first-run boot; small-folder indexing;
   client-map build = the same proven mechanic as the LOADED Brennan build) but the full wizard
   walkthrough was not auto-scripted (the wizard gates programmatic workspace-open). If you want it
   fully rehearsed end-to-end, drive the wizard once and confirm.

3. **Self-serve desktop shortcuts — ✅ DONE (bench-local).** 3 desktop shortcuts on the bench desktop
   (`Keepance - 1 Loaded Demo`, `2 Blank Demo`, `3 Restart App`) → `.bat` files in `C:\demo-buttons\`.
   They run the reset scripts **locally on the bench** (`set DESKTOP_CDP_PORT=9223` → `node
   scripts\demo\reset-loaded.mjs` / `reset-blank.mjs`); Restart App kills keepance/node/msedgewebview2
   and re-runs `Start-ScheduledTask KeepanceDev`. Decision = **bench-local** (the bench already has
   node v24 + playwright + the repo at `C:\keepance`; no SSH/tunnel needed). The current reset scripts
   + `seed-loaded.json` + `connection.mjs` were copied to the bench. Both Loaded + Blank buttons
   verified working bench-local. Self-serve via Parsec INTO the bench (host), not as a Parsec client.
   Setup script: scratchpad `setup-buttons.ps1` (re-runnable). The email connection + imported mail +
   matter tags SURVIVE a reset (they're in the OS keychain + LanceDB, not localStorage), so resetting
   between showings keeps the email demo working.

4. **THEN the UI pass** — gather Jameson's UI changes/questions and implement (held to the end).

---

## How to drive the bench (recreate each session)
- CDP tunnel from server:
  `ssh -fN -o ExitOnForwardFailure=yes -L 127.0.0.1:9444:127.0.0.1:9223 james@100.127.67.22`
  (MUST be 127.0.0.1, not localhost — localhost resolves to ::1 where CDP doesn't listen.)
- Drive via Playwright using `scripts/robot/connection.mjs` with `DESKTOP_CDP_PORT=9444`. Scripts
  that import `connection.mjs` must run from inside the keepance tree (so `playwright` resolves).
- If the tunnel dies: find the PID via `ss -tlnp | grep 9444`, `kill` it (NEVER `pkill -f`), restart.
- If the app dies: kill `keepance,msedgewebview2,node` on the bench, then `Start-ScheduledTask
  KeepanceDev`, wait for CDP 9223.

## Verified UI mechanics (critical)
- **Open a client hub reliably (avoids a stale-state bug):** go to the matters table (click
  `hub-back-btn` if in a hub, then `spine-nav-matters`), type the client name into
  `matters-search-input`, then click `matter-row-<matterId>`. This forces a FRESH MatterHub mount.
  ⚠️ **Do NOT** just dispatch `keepance:matter-launch` and click — `MatterHub` is not keyed by
  matterId, so its `useClientMap` `status` stays stale ('ready' from the last client) and the
  Client Map open click then NO-OPs (the build guard requires `status==='idle'`). The search→row
  path was the key to building all 26 maps.
- **Build a client map:** in the hub, one click `hub-panel-clientmap-open` calls `generate()` (only
  when status idle + panel closed). Build writes the map once at completion (~15s). Poll
  `keepance:client-maps` → `state.maps[matterId]`.
- **Matter membership is by `folderPaths`**; you can inject a matter straight into
  `keepance:matters` and reload (how all 26 were seeded). Files indexed while a folder was
  unassigned need `rag_retag_matter({path, matterId})` (absFwd path = `C:/.../Clients/<name>/<file>`).
- **After any reload the app shows the workspace PICKER** (it doesn't auto-open). Re-open via the
  `recent-workspace-row` whose text contains "Northcrest" (expand `recent-workspaces-toggle` first;
  it's a stateful toggle — ensure rows are visible before clicking).
- localStorage keys: `keepance:matters`, `keepance:client-maps`, `keepance:settings`
  (`state.featuresTourCompleted`, `state.values.confidentialityChoiceMade`), `keepance_recent_workspaces`,
  `keepance_onboarding_complete`, `keepance_profession`. OpenAI key is in the OS keychain (survives clear()).

## Email connector facts (from code research)
- Connect UI: Account window → Connections tab (`account-tab-connections`) → button text "Connect
  Microsoft 365" (no testid). Opens via `keepance:open-account` `{detail:{tab:'connections'}}`.
- Import is AUTOMATIC right after connect. Manual re-sync: `email-sync-now`.
- OAuth: loopback + PKCE, redirect **`http://localhost`** (personal MS accounts reject 127.0.0.1;
  on Windows localhost must resolve to IPv4 — handled in code). Client id `845ddba0-70ab-4f90-88ba-e3522157e37a`,
  scopes `Mail.Read Mail.Send`.
- **Email is searchable GLOBALLY** — matter association is optional. The main Ask has an **Email
  scope chip** (`scope-option-email`); it filters retrieval to `source_type==="mail"` chunks. So no
  per-client mapping is needed for the cited-from-email demo.

## Gotchas
- PowerShell-over-SSH breaks on quotes / `&` / spaces → write a `.ps1`, scp it, run `powershell -File`.
- The bench GUI app needs a free interactive screen; never run Parsec as a *client* on the bench.
- Codex `--read-only` is NOT enforced on this box (broken sandbox) — it CAN edit files.
- Verify before claiming done (run the actual ask/map and show the result).
- **Demo workspace = `C:/keepance-demo-northcrest/Northcrest Wealth Partners`** (name "Northcrest Wealth
  Partners"). There is ALSO a leftover `C:/kp-e2e-workspace` (test data, NO mail) — do NOT open it. The
  recent-workspace list can drift to kp-e2e; restore the correct one by setting localStorage
  `keepance_recent_workspaces` to the seed value (`seed-loaded.json` → `recentWorkspaces`) then restart
  the app so the picker re-reads it. LanceDB + mail are PER-WORKSPACE (under `<workspace>/.keepance/`).
- **App restart on the bench:** it runs `C:\run-dev.bat` = `vite preview --port 5173 --strictPort` (serves
  the PREBUILT dist; NOT tauri dev) + the prebuilt `keepance.exe`. To restart cleanly:
  `Stop-Process -Name keepance,node,msedgewebview2 -Force`, wait ~5s (strictPort needs 5173 free; leftover
  node/vite holds it), then `Start-ScheduledTask -TaskName KeepanceDev`. NOTE: Vite binds **IPv6 `::1`**, so
  a `127.0.0.1:5173` TCP check shows false-negative — the app still reaches it. CDP debug port is 9223.
- **CDP drops on in-app `page.reload()`** (stale targets → scripts hang past the node timeout). Prefer a
  full app restart over reload: set the localStorage you need, then kill+Start-ScheduledTask; the picker
  re-reads at boot. Simple connect+evaluate scripts (no reload) are stable.
- **Direct retrieval probe (very useful for diagnosing Ask):**
  `window.__TAURI__.core.invoke('rag_retrieve', { query, topK, scope:{kind:'allMatters'}, includePrivileged:false })`.
  Hit text is in `hit.chunkText` (NOT `hit.text`). The UI Ask uses `DEFAULT_WORKSPACE_TOP_K = 8` then
  `filterHitsByScope` (email/documents are a CLIENT-SIDE filter applied AFTER the top-8). `mail:` paths =
  email chunks. Reset scripts/probes live in `scripts/demo/bench-*.mjs` (probe, ragprobe, ask-clean, etc.).

## QA sweep — every demo run cleanly from scratch (2026-06-25 session 3)

**Verified WORKING (drove each as a presenter, from a clean `reset-loaded`):**
- LOADED: 26 instant client maps render rich; **Brennan live map build works** (~28s while the
  cosmetic index ran — faster when idle); **cited document Ask** ("$8,540,000" + allocation, cited);
  **cited email Ask** both global (content-specific question) and open-client (vague question).
- BLANK: `reset-blank` → first-run picker; `C:\keepance-demo-blank` opens with the Brennan folder
  (6 files, instant); New-client creation works.
- Reset buttons: `reset-loaded` + `reset-blank` both verified bench-local. App stayed up through the
  whole sweep (the only drops-to-picker were caused by MY in-app `page.reload()` scripts, not the app).

**FIXED (demo data — committed):**
- ✅ **Doubled client names** ("Brennan, Thomas & Karen - Brennan, Thomas & Karen" everywhere).
  Root cause: the New-client form has TWO fields — "Client name" + "Client" (org) — and `matterLabel`
  (`src/platform/rag/matterResolver.ts:91`) renders `"{client} - {name}"`; the seed had `client==name`
  on all 27 matters. Fix: cleared the org `client` field in `seed-loaded.json` (empty org = correct for
  advisors). Names now render singly.
- ✅ **`_README_FAKE_DATA.txt` visible to prospects** in the Documents view. Moved it OUT of the
  workspace root (to `C:\keepance-demo-northcrest\_README_FAKE_DATA.txt`) — notice preserved, off-screen.

**FIXED (frontend code — committed `b819e737`, built + deployed to the bench dist, verified live):**
- ✅ **Client hub EMAIL panel** now previews THIS client's connected emails (matched by household name)
  instead of "No email folders connected" — e.g. Brennan's hub shows "(1) Roth conversion before
  year-end?". `src/features/matters/MatterHub.tsx`. (There's still no "list mail by matterId" command;
  this matches on sender. The robust backend follow-up is a `matterId` filter on `mail_list_messages`.)
- ✅ **Egress indicator** now reads `keepance_default_provider` first (the same value the Ask uses), so
  the top bar shows "OpenAI" to match the Ask instead of hard-falling-back to "Anthropic".
  `src/platform/hooks/useActiveEgressProvider.ts`. (Model is still gpt-4o-mini — fine, but a stronger
  model would impress more; that's a settings change, not code.)
- ✅ **New-client dialog terminology** — the raw (non-facade) `matter.manager` strings (lockdown,
  folders, email, MCP) now say "client" not "matter". `src/locales/en.json`. NOTE: the facade strings
  (scope chips, dialog title) already adapt via `profession=advisor`; only these raw strings leaked
  "matter". Law-mode would now show "client" for these few strings — the robust fix is to route them
  through the `useEntityLabel` facade (advisor-reaim's terminology sweep). de/es locale copies unchanged.

**STILL-FLAGGED (data-fixed for the demo, code follow-up optional):**
- ⚠️ **`matterLabel` doubling** was fixed in DEMO DATA (seed `client=""`). The robust code fix for the
  broader product: `if (name && client && name !== client) return \`${client} - ${name}\`; return name || client`.

**Bench dist note:** these UX fixes live in the DEPLOYED `C:\keepance\dist` (server-built, scp'd over).
They survive app restarts (`vite preview` only SERVES dist, never rebuilds). They are ALSO committed to
`keepance-3.0`. The only way to lose them on the bench is a manual `npm run build` there from stale src —
so pull `keepance-3.0` before any bench rebuild. To redeploy after a code change: `npm run build` on the
server → zip `dist/` → scp → expand to `C:\keepance\dist` → restart the app.

**DEMO-OPERATION tips:**
- **Reset a few minutes before showing.** After any reset the app re-indexes PDFs (banner "Indexing PDFs:
  X / 301") for several minutes; it's usable during, but it competes for CPU and slowed the live Brennan
  build to ~28s. Reset early so it's idle when you present.
- BLANK build-up is multi-step: open `C:\keepance-demo-blank` → Clients → New client (name it) → CHECK
  the matching folder in "Folders in this client" → it indexes → build the client map → Ask.

## Git
- Work on `keepance-3.0` in `~/keepance`. Demo work committed locally; **do NOT push keepance-3.0**
  without confirming with Jameson (it carries another session's 3 strategy-doc commits +
  60729250 + today's demo commit). Never `git clean -fd` / `reset --hard` / `add -A` / `cargo fmt`
  in this tree. Leave any stash@{0} alone.
