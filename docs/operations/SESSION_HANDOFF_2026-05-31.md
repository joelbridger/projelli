# Session Handoff: 2026-05-30/31 (Windows release fix + LemonSqueezy products)

> **Read this first.** Supersedes `SESSION_HANDOFF_2026-05-29.md`. Covers the Windows
> code-signing fix (v2.1.1 shipped) and the LemonSqueezy product setup (#1 done).
> Live AI-memory mirror: `~/.claude/projects/-home-jameson/memory/project_keepance_v2_1_release.md`.

## TL;DR
- **v2.1.1 is LIVE** with a signed Windows installer AND Windows in-app auto-update (new this release). Mac and Linux unaffected.
- **All 4 LemonSqueezy products exist and are published**, with checkout URLs (below).
- **The revenue loop is NOT closed yet.** Remaining: license-server tier mapping (#2), site subscription pricing + wiring the checkout URLs (#3), plus two items on Jameson.

## What shipped this session

### 1. Windows release fixed, v2.1.1 published
- **Root cause:** the v2.1.0 Windows build failed Azure Trusted Signing with `403 Forbidden`. The Azure account (`microsoft@projelli.com`, the original pre-rebrand account; resources `projelli-signing` / `projelli-rg`) had its **free trial expire**, which paused the signing service. Jameson upgraded the subscription to **Pay-As-You-Go**, clearing the 403.
- **Also fixed Windows auto-update** (which had never worked): the updater signature was being generated on the *unsigned* installer, before Azure signing. `release.yml` now (a) regenerates the Tauri updater `.sig` over the FINAL Azure-signed installer via `tauri signer sign`, (b) uploads it, (c) runs a new `finalize-updater-manifest` job that merges a `windows-x86_64` entry into `latest.json`.
- **Verified:** the public `releases/latest/download/latest.json` serves **2.1.1** with `windows-x86_64` (valid 420-char signature, correct setup.exe URL); v2.1.1 is marked **Latest**.
- Workflow + version-bump change is commit `651ba9f` on master.
- *Minor, deferred (cosmetic):* the `.mcpb` asset is misnamed `keepance-.mcpb` (empty platform triple); the portable exe is `Keepance__x64-portable.exe` (missing version).

### 2. LemonSqueezy products created (#1 of the paid funnel): DONE
Store **#340394** (`projelli` slug). Note: this store also hosts **Guesslet Pro $19.99**, so anything consuming this store's webhooks must filter to Keepance products. All four published:

| Product | Price | Checkout URL |
|---|---|---|
| Personal | $49 one-time | https://projelli.lemonsqueezy.com/checkout/buy/4df43939-9d7f-4acb-b289-1ab63a65532c |
| Professional | $149 / year | https://projelli.lemonsqueezy.com/checkout/buy/78ee592e-8f8a-4ce4-9ea4-68a84032d21a |
| Professional (Founding) | $99 / year | https://projelli.lemonsqueezy.com/checkout/buy/788892fb-4191-4755-b4c3-914138ca8ec0 |
| Practice | $499 one-time | https://projelli.lemonsqueezy.com/checkout/buy/b4c6865f-a435-43c9-82b1-14d6b4f18059 |

## Next session: exact steps

### On Jameson (blocks #2 and go-live)
1. **Set the 100-seat inventory cap on the Professional (Founding) variant.** It is not settable in the create form; set it on the variant's Inventory setting. **Do this BEFORE the Founding URL goes live**, or unlimited buyers get $99/yr instead of $149.
2. **Provide the LemonSqueezy API key + webhook signing secret** (Settings, then API). Put them in the license-validator env on the server (NOT in chat): `~/services/license-validator/`.

### Claude #2: license-validator tier mapping
- `~/services/license-validator/server.ts`: `tierFromVariantName()` still returns the old `free | pro | lifetime`. Update to map by product/variant NAME:
  - Personal -> `personal`
  - Professional AND Professional (Founding) -> `professional`
  - Practice -> `practice`
- Add subscription-lifecycle webhooks (`subscription_created` / `subscription_payment_success` / `subscription_expired` / `subscription_cancelled`) so Professional issues a time-limited license that renews and revokes. Personal and Practice stay perpetual one-time.
- **Must ignore Guesslet Pro orders** (shared store).
- App `useLicense` already gates on `tier !== 'free'`; add expiry-based graceful degrade for a lapsed Professional subscription (read-only + renew prompt).

### Claude #3: site subscription pricing + checkout wiring (DEPLOY-GATED)
- Update displayed prices site-wide to **$49 / $149-year / $499** (the live site still shows the old one-time $129 etc.): homepage (`website-keepance/index.html` copied to `website/index.html`), `/legal/`, `/tax/`, `/consulting/`, `/vs/*`, Terms/EULA/FAQ, and JSON-LD.
- Restore the real Buy buttons from the `<!-- TODO restore -->` comments using the 4 URLs above; add the "Most popular" badge on Professional and the founding-seats note. **Do NOT wire the Founding URL live until the 100-cap is set.**
- Per the runbook: run a test-mode purchase end to end (buy, email, activate, renew/expire) BEFORE real go-live, then deploy. **The deploy needs Jameson's explicit go.**

## Operating notes
- **No autonomous deploy** of the app or the site. App releases and site go-live each need an explicit human go for that action.
- Azure signing is now on Pay-As-You-Go (about $10/mo) under `microsoft@projelli.com`; it keeps working going forward.
- Advisors (attorney / CPA / patent) and founder-bio verification are still open (PIVOT-05 / PIVOT-12; Jameson's hands).

## References
- Pricing model: `docs/strategy/PRICING_RECOMMENDATION_2026-05-29.md`. Product runbook: `docs/operations/LEMONSQUEEZY_SETUP_RUNBOOK.md`.
- AI-memory current-state file: `~/.claude/projects/-home-jameson/memory/project_keepance_v2_1_release.md`.
