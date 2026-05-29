# Launch Runbook: Checkout, Charter, and App Gating

**Why this exists:** These are the irreversible / money-and-auth steps that were deliberately NOT done unattended overnight on 2026-05-29. They touch real payments, license issuance, and a live deploy. Do them together, awake, with Jameson clicking the confirm buttons. Estimated time together: ~1 hour.

**Do not** run any of this solo or on a timer. A backup of the repo does not undo a botched live transaction, a mis-issued license key, or a down store.

---

## Pre-flight

- [ ] Confirm canonical pricing in `docs/reference/PRICING_AND_POSITIONING.md` is still what we want.
- [ ] Confirm working tree is clean and on a review branch (see git section).
- [ ] Have the LemonSqueezy dashboard open and logged in.

## Step 1 — LemonSqueezy products (Jameson drives the dashboard)

Existing variant IDs found in commented-out buy buttons:
- Professional ($129): `33cd497b-bffd-404c-910e-f8dd1f4453bd`
- Practice ($399): `9a5a7f48-0ffe-448a-a1af-889af99a0f47`

- [ ] Confirm those two variants exist, are priced correctly, and are set to a 30-day free trial where applicable.
- [ ] Create/confirm the **Personal $49** variant. Record its ID here: `__________`.
- [ ] Decide how the **$89 charter** is implemented. Two clean options:
  - **A (recommended):** a separate "Professional (Charter)" variant at $89, manually capped at 100 sales per pack via LemonSqueezy's quantity limit. Simplest, visible, auto-closes.
  - **B:** a discount code that expires after 100 redemptions. More fragile (per-pack cap is harder).
  - Record charter variant/code: `__________`.
- [ ] Confirm merchant-of-record tax settings, refund policy (14-day), and license-key generation are enabled.
- [ ] Test-purchase each product in LemonSqueezy **test mode**, confirm a license key is issued. Do NOT skip test mode.

## Step 2 — Restore buy buttons in the website

All buy buttons are currently commented-out TODOs. Once Step 1 verifies in test mode AND you're ready for real money:

- [ ] `website/legal/index.html`: lines ~540, ~692 (Professional), ~709 (Practice).
- [ ] `website/tax/index.html`: lines ~523, ~658 (Professional), ~678 (Practice).
- [ ] `website/consulting/index.html`: lines ~519, ~654 (Professional), ~671 (Practice).
- [ ] `website/index.html`: lines ~628 (Professional), ~645 (Practice). Add a Personal $49 buy button using the new variant ID.
- [ ] Swap the "Reserve the $89 founding price" links for real charter checkout once the charter variant exists.
- [ ] Keep the "30-day free trial / download" CTA as the primary for cold traffic; buy buttons are for warm/decided buyers.

## Step 3 — App license entitlement (lead dev drives, test-first)

Goal: gate **only** the profession pack behind Professional+. Personal gets the full app minus packs. Do NOT gate AI providers or core features.

- [ ] Locate the license/entitlement check in `src-tauri/` and `src/` (search: `license`, `entitlement`, `tier`, `lemonsqueezy`, `activate`).
- [ ] Write tests first: Personal key → app works, packs locked; Professional key → one pack unlocked; Practice key → all packs + 5 seats.
- [ ] Implement the gate to match the tests.
- [ ] Verify against the running app (see the `verify` / `run` skills), not just unit tests. Activate with a real test-mode key from Step 1.
- [ ] Confirm the "bring your own templates" path works for Personal (no pack, but user can create/import their own).

## Step 4 — Schema.org + final copy sync

- [ ] Confirm `website/index.html` Schema offers still list Personal 49 / Professional 129 / Practice 399.
- [ ] Confirm no FORBIDDEN strings reintroduced (grep list in the pricing spec, section 8).

## Step 5 — Deploy (Jameson runs it, or supervises)

- [ ] **Use the correct deploy script: `infra/deploy.sh`** (CLAUDE.md canonical). It rsyncs `website/` → `/var/www/keepance.com` and purges the Cloudflare cache. `website/` is where all real content lives, so this is right.
  - ⚠️ **DANGER, stale duplicate:** `infra/deploy-keepance.sh` points `WEBSITE_DIR` at `website-keepance/`, which contains only `index.html` + `logoideas.html`. If anyone runs `deploy-keepance.sh`, it will `rsync --delete` a near-empty directory over the live site and **wipe keepance.com**. Recommend deleting or neutering `deploy-keepance.sh` so it can't be run by mistake. Do NOT run it.
- [ ] Dry-run first: `infra/deploy.sh` supports `--dry-run` (previews rsync without touching disk). Run that and eyeball the file list before the real run.
- [ ] Real deploy (Jameson runs): `infra/deploy.sh`.
- [ ] After deploy: load keepance.com, /vs/chatgpt, /legal/, /tax/, /consulting/ and confirm pricing + buy buttons render correctly (remember Caddy catch-all can mask broken URLs, check page bodies, not just 200s).

## Rollback

- [ ] Website: re-deploy previous commit, or `git revert` the buy-button commit and re-deploy.
- [ ] LemonSqueezy: switch products back to draft / disable checkout.
- [ ] App gating: revert the entitlement commit; ship a patch build if a release already went out.
