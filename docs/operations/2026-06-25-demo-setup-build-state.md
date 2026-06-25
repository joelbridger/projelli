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

### Email inbox — account created + realistic-population path PROVEN (population/connect remain)
- **Account created (by Jameson): `sarah.morgan.cfp@outlook.com`** (advisor persona "Sarah Morgan,
  CFP"). Logged into the always-on Chrome; creds saved in the Chrome password manager. (I could not
  auto-create one — Microsoft signup hits an Arkose "press and hold" puzzle built to block bots.)
- **Realistic-population mechanism proven**: I obtained a working **IMAP read/write token** for the
  account via the auth-code OAuth flow with the **Thunderbird public client** (device-code is blocked
  for personal MSAs as "first-party"; auth-code works). Full procedure is in the header of
  `scripts/demo/populate-inbox.py`.
- **`scripts/demo/populate-inbox.py`** has **15 realistic Northcrest client emails already written**
  (Brennan Roth-conversion question, Patel RSU concentration, Voss RMD/QCD, Ellison beneficiary,
  Nakamura 529, Caldwell "can I retire at 60", etc. — varied client senders, past dates, some unread)
  and IMAP-APPENDs them with proper From headers.
- **Blocker for population:** IMAP is OFF on the brand-new account, gated behind "verify your account"
  (Outlook web → Settings → Mail → Forwarding and IMAP). IMAP login currently fails with "User is
  authenticated but not connected". **Fix:** verify the account (recommended: add
  jamesondaines@outlook.com as a security email and read the code via the `outlook` CLI — no phone
  needed), toggle IMAP on, then run populate-inbox.py.
- The Android phone bridge was **unreachable** this session (`android-cdp status` = bridge unreachable),
  so OTP-by-phone wasn't available — hence the email-verification route above.

---

## REMAINING (priority order)

1. **Finish the email inbox** (the realistic path is proven — just execute it):
   a. Verify `sarah.morgan.cfp@outlook.com` (add jamesondaines@outlook.com as security email →
      read code via `outlook search "code"` / `outlook list` → enter it). Then enable IMAP in
      Outlook web settings (Forwarding and IMAP).
   b. Get a fresh IMAP token (procedure in `populate-inbox.py` header) and run the script → 15
      client emails land in the inbox.
   c. **Connect the inbox in Keepance on the bench**: Account window → Connections tab → "Connect
      Microsoft 365" (open via `window.dispatchEvent(new CustomEvent('keepance:open-account',{detail:{tab:'connections'}}))`).
      This opens an OAuth browser ON THE BENCH (cross-machine) — sign in as sarah there. Import
      auto-runs. (See the connector research below.)
   d. **Verify a cited-from-email Ask**: sidebar Search (`spine-nav-search`) → scope chip
      `scope-option-email` → `ask-composer-input` → e.g. "What did Thomas Brennan email me about
      his retirement accounts?" → expect a cited answer (citation chips `ask-citation-chip-N`;
      mail citations open via `keepance:open-email`).
   - If the realistic path stalls again, the reliable fallback is to SEND the 15 emails from
     jamesondaines@outlook.com via the `outlook send` CLI (single sender, clutters his Sent, but
     functional). Prefer the IMAP path for varied client senders.

2. **BLANK mode**: stage a small fresh workspace on the bench (e.g. `C:\keepance-demo-blank` with
   one small client folder of `.txt`/`.docx`) so the first-run build-up is fast. reset-blank.mjs
   already boots to first-run.

3. **Self-serve desktop shortcuts** on the bench (Loaded / Blank / Reset / Add-Brennan-files).
   Design note: the reset scripts currently run FROM the server via the tunnel. For a bench desktop
   button, either install node+playwright on the bench to run them against `127.0.0.1:9223`, or have
   the .bat SSH to the server to run them. Decide in that task.

4. **THEN the UI pass** — gather Jameson's UI changes/questions and implement.

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

## Git
- Work on `keepance-3.0` in `~/keepance`. Demo work committed locally; **do NOT push keepance-3.0**
  without confirming with Jameson (it carries another session's 3 strategy-doc commits +
  60729250 + today's demo commit). Never `git clean -fd` / `reset --hard` / `add -A` / `cargo fmt`
  in this tree. Leave any stash@{0} alone.
