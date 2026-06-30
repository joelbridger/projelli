# LemonSqueezy 3.0: products created live + the one blocker

**Date:** 2026-06-10
**Status (updated 2026-06-10):** The 3 subscription products are CREATED, LIVE, and verified. The test-mode validator API key blocker is **RESOLVED** (a live key was created, verified against live orders, and swapped into the validator). The webhook was already live. Solo + Professional **subscribe links are wired into the website pricing cards and deployed**. Remaining: the founding coupon products (so the FOUNDING code applies to the 3.0 tiers), Firm multi-seat, and a real test purchase. See the UPDATE section at the bottom.

## What was done (live, verified)

Created in the live Advisor Prep Hero store (LemonSqueezy id `340394`, slug `projelli`, checkout host `projelli.lemonsqueezy.com`) as published subscriptions, each yearly with "Generate license keys" ON (activation limit 5):

| Product | Price | Wire code (validator) | Checkout URL |
|---|---|---|---|
| **Advisor Prep Hero Solo** | $468.00/year | `personal` | https://projelli.lemonsqueezy.com/checkout/buy/f919f658-c063-4f9e-ba86-80e1e6fa79de |
| **Advisor Prep Hero Professional** | $948.00/year | `professional` | https://projelli.lemonsqueezy.com/checkout/buy/638f8163-4381-4388-a02d-a1ccd3cf8c1b |
| **Advisor Prep Hero Firm** | $1,548.00/year | `practice` | https://projelli.lemonsqueezy.com/checkout/buy/7a87840c-214f-4b1e-879e-a851db197e7c |

Prices were confirmed on the public storefront (what the customer sees). The `license-validator` already maps these names to the wire codes (`tiers.ts`: Solo->personal, Firm->practice; Professional already matched) and already classifies subscription lifecycle webhooks. Existing legacy products (Personal/Professional/Practice one-time, Guesslet Pro) were left untouched.

## CRITICAL blocker found: the validator uses a TEST-MODE LemonSqueezy API key

`LEMONSQUEEZY_API_KEY` in `/etc/license-validator.env` is a **test-mode** key. Proof: the LS API with that key returns only `test_mode: true` products and only test orders ($31.16 test orders), and does NOT see the real live order ($52.65, the live "Personal" sale visible in the dashboard).

Consequence: when a real customer buys a 3.0 subscription, LemonSqueezy issues a **live** license key, but the validator (test key) cannot validate it, so activation fails. This also means the existing live product's licensing was likely never validating real purchases. This is a pre-existing issue, surfaced now.

### The fix (needs Jameson: it regenerates the live licensing credential)
1. In LemonSqueezy → Settings → API, create a **live** API key (ensure the account/store is in **Live** mode, not Test, when creating it).
2. Verify it is live: `curl -s "https://api.lemonsqueezy.com/v1/orders" -H "Authorization: Bearer <KEY>" -H "Accept: application/vnd.api+json"` should show the real $52.65 order with `test_mode: false`.
3. Back up the old value, set `LEMONSQUEEZY_API_KEY=<live key>` in `/etc/license-validator.env`, then `sudo systemctl restart license-validator`.
4. Confirm the webhook (LS → Settings → Webhooks) points to `https://licenses.keepance.com/webhook`, is enabled for **live** events (order_created, subscription_*), and uses the `LEMONSQUEEZY_WEBHOOK_SECRET` already in the env file.

Either Jameson does this, or grants explicit go for me to regenerate + swap the credential (it is reversible; the old key is kept as backup, and step 2 verifies the new key before the swap).

## Remaining after the key fix
- **Wire the 3 checkout URLs into the website pricing CTAs** (`website/` pricing section) + redeploy. Held until the key fix so we never take an unvalidatable payment.
- **Founding coupons** (not yet created; the LS API is test-mode so they must be made in the dashboard, or via a live API key): `FOUNDING` 30% recurring, cap 100, for Solo + Professional; `FOUNDINGFIRM` 30% recurring, cap 10, for Firm (the separate-coupon option, per the recommendation).
- **Firm per-seat / minimum 3 seats:** the base form has no quantity control; per-seat quantity (min 3) is a variant-level setting, and the LS subscription quantity must drive the firm backend org `seat_limit` (`POST /admin/org`). Until then Firm is purchasable as a single $1,548 seat. Solo + Professional are single-seat and fully functional once the key is fixed.
- **Final real test purchase** (Jameson's real-money gate): buy Solo with a real card, confirm the license activates Advisor Prep Hero end to end.

## UPDATE 2026-06-10: validator live key swapped + subscribe links wired

Jameson said "swap it yourself," so:
- **Live API key created + verified + installed.** Created `keepance-validator-live` in LemonSqueezy (Live mode), verified it sees the real live orders ($52.65 refunded + $21.48 paid, `test_mode:false`) that the old test key could not, backed up `/etc/license-validator.env` to `.bak-<epoch>`, swapped `LEMONSQUEEZY_API_KEY` to the live key (perms preserved root:jameson 640), restarted `license-validator` (active, `/healthz` ok). Real purchases now validate. The old test key (`keepance-validator-2`) is still in the LS account, unused now (can be deleted later).
- **Webhook confirmed live.** `licenses.projelli.com/webhook` (served by the same validator via Caddy alias) has 9 events and a successful (green) delivery of the live order on 1 Jun, so revocation/renewal already works.
- **Website subscribe links wired + deployed.** Solo + Professional pricing cards now link directly to their checkout (the in-app subscribe flow opens `keepance.com/#pricing`, so those cards are the conversion landing point). Trial stays the primary CTA. Deployed to keepance.com.

### Still remaining
- **Founding coupon products.** The existing `FOUNDING` coupon is restricted to the OLD "Professional" product. I switched its amount to 30% in the editor but the LS product-restriction picker would not open via automation, so I cancelled (left it untouched). The website founding note now says "email support@keepance.com to lock it in" (honest, manual for the founding cohort). To make it self-serve: edit FOUNDING → Percentage 30% → set Products to Advisor Prep Hero Solo + Professional (+ Firm) → ensure "applies forever" → redemption limit 100. ~2 minutes in the dashboard.
- **Firm multi-seat.** Firm is a single-seat $1,548 product; per-seat quantity (min 3) is variant-level, and the quantity must drive the firm backend org `seat_limit`. Firm card stays "Talk to us" until then.
- **Real test purchase (Jameson, real money):** buy Solo with a real card, confirm the license activates Advisor Prep Hero end to end. This is the only remaining proof.

## Reference
Spec: `docs/operations/2026-06-09-lemonsqueezy-3.0-setup.md`. Pricing: `docs/strategy/2026-06-09-keepance-3.0-pricing.md`.
