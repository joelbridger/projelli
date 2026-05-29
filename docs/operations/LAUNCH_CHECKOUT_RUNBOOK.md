# Launch Runbook: Checkout, Charter, App Gating, Deploy

**Why this exists:** These are the irreversible / money-and-auth steps that should be done WITH Jameson present, not unattended. They touch real payments, license issuance, and a live deploy. Estimated time together: ~1 hour.

**Do not** run any of this solo or on a timer. A repo backup does not undo a botched live transaction, a mis-issued license key, or a down store.

---

## Pre-flight
- [ ] Confirm no other agent/session is editing this repo (parallel sessions caused merge churn on 2026-05-29). Close them.
- [ ] Confirm canonical pricing in `docs/reference/PRICING_AND_POSITIONING.md` is still correct.
- [ ] Confirm working tree is clean and changes are merged to master.
- [ ] LemonSqueezy dashboard open and logged in.

## Step 1 — LemonSqueezy products (Jameson drives the dashboard, Claude guides each field)

Existing variant IDs found in commented-out buy buttons:
- Professional ($129): `33cd497b-bffd-404c-910e-f8dd1f4453bd`
- Practice ($399): `9a5a7f48-0ffe-448a-a1af-889af99a0f47`

- [ ] Confirm those two variants exist and are priced correctly.
- [ ] Create/confirm the **Personal $49** variant. Record its ID: `__________`.
- [ ] Decide how the **$89 charter** is implemented:
  - **A (recommended):** a separate "Professional (Charter)" variant at $89, capped at 100 sales per pack via LemonSqueezy quantity limit. Auto-closes, visible.
  - **B:** a discount code expiring after 100 redemptions (harder to cap per-pack).
  - Record charter variant/code: `__________`.
- [ ] Confirm merchant-of-record tax settings, 14-day refund policy, and license-key generation are enabled.
- [ ] **Test-purchase each product in LemonSqueezy TEST MODE**; confirm a license key is issued. Do NOT skip test mode.

## Step 2 — Restore buy buttons in the website (Claude does the edits)

All buy buttons are currently commented-out TODOs. Once Step 1 verifies in test mode AND you're ready for real money:
- [ ] `website/legal/index.html` (Professional + Practice buttons)
- [ ] `website/tax/index.html` (Professional + Practice)
- [ ] `website/consulting/index.html` (Professional + Practice)
- [ ] `website/index.html` (Professional + Practice; add Personal $49 button using new variant ID)
- [ ] Swap "Reserve the $89 founding price" links for real charter checkout once the charter variant exists.
- [ ] Keep "Download free for 30 days" as the primary CTA for cold traffic; buy buttons are for warm/decided buyers.

## Step 3 — App license entitlement (Claude leads, test-first; Jameson watches/tests)

Goal: gate **only** the profession pack behind Professional+. Personal gets the full app minus packs. Do NOT gate AI providers or core features.
- [ ] Locate the license/entitlement check in `src-tauri/` and `src/` (search: `license`, `entitlement`, `tier`, `lemonsqueezy`, `activate`).
- [ ] Write tests first: Personal key -> app works, packs locked; Professional key -> one pack unlocked; Practice key -> all packs + 5 seats.
- [ ] Implement the gate to match the tests.
- [ ] Verify against the running app (use the `verify` / `run` skills), not just unit tests. Activate with a real test-mode key from Step 1.
- [ ] Confirm the "bring your own templates" path works for Personal (no pack, but user can create/import their own).

## Step 4 — Schema.org + final copy sync (Claude)
- [ ] Confirm `website/index.html` Schema offers still list Personal 49 / Professional 129 / Practice 399.
- [ ] Grep for FORBIDDEN strings (pricing spec section 8); zero results expected.

## Step 5 — Deploy (Jameson runs it, or gives a one-word "go" and Claude runs it)
- [ ] **Correct script: `infra/deploy.sh`** (CLAUDE.md canonical). Rsyncs `website/` -> `/var/www/keepance.com` and purges Cloudflare cache. This is right.
  - ⚠️ `infra/deploy-keepance.sh` is a stale duplicate pointing at the near-empty `website-keepance/`. It was disabled on master 2026-05-29. Do NOT re-enable or run it; it would wipe the live site.
- [ ] Dry-run first: `infra/deploy.sh --dry-run` (preview rsync without touching disk). Eyeball the file list.
- [ ] Real deploy: `infra/deploy.sh`.
- [ ] After deploy: load keepance.com, /vs/chatgpt, /legal/, /tax/, /consulting/ and confirm pricing + buy buttons render. Caddy catch-all can mask broken URLs, so check page BODIES, not just 200 status.

## Rollback
- [ ] Website: `git revert` the relevant commit and re-deploy, or re-deploy the previous commit.
- [ ] LemonSqueezy: switch products back to draft / disable checkout.
- [ ] App gating: revert the entitlement commit; ship a patch build if a release already went out.
