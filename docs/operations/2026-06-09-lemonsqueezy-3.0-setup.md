# LemonSqueezy setup for Advisor Prep Hero 3.0 - Jameson's hands (NOT executed)

> **This is a checklist, not a change.** Nothing here has been done. The live
> LemonSqueezy store and the live v2.5 buy buttons are untouched. This document
> is the exact set of products, variants, prices, and the founding coupon to
> create in LemonSqueezy when Advisor Prep Hero 3.0 launches.
>
> **Source of truth for every number:** the ratified recommendation in
> `docs/strategy/2026-06-09-keepance-3.0-pricing.md` and the canonical app config
> `src/config/pricing.ts`. If a price here disagrees with those, they win.
>
> **Heads-up (engineering tail):** unlike the old mostly-one-time plan, ALL
> three 3.0 tiers are subscriptions. The license validator must handle the
> subscription lifecycle (create / renew / expire / cancel) for every tier, and
> the desktop app must degrade gracefully when a subscription lapses (data stays,
> AI + updates turn off). That work is mine, summarized at the bottom. Your part
> is the LemonSqueezy click-path.

## The model to build

Advisor Prep Hero 3.0 is **per-seat annual subscription** with a month-to-month option at
roughly a 25-30% premium. Three tiers. The wire/license tier CODE is in
parentheses (the backend + app already speak these codes - the LemonSqueezy
variant maps to the code, the human sees the display name).

| Display tier (wire code) | Create in LemonSqueezy as | Annual price (per seat) | Month-to-month (per seat) |
|---|---|---|---|
| **Solo** (`personal`) | Subscription, billing interval **Yearly** | **$468 / year** ($39/mo) | a Monthly variant at **$49 / month** |
| **Professional** (`professional`) | Subscription, billing interval **Yearly** | **$948 / year** ($79/mo) | a Monthly variant at **$99 / month** |
| **Firm** (`practice`) | Subscription, billing interval **Yearly**, **min 3 seats** | **$1,548 / seat / year** ($129/seat/mo) | a Monthly variant at **$159 / seat / month** |

**Founding rate (all tiers):** ~30% off the annual rate, **locked for the life of
the subscription**. Apply it with a single coupon `FOUNDING` (details in the
"Founding coupon" section), capped to the first cohort:

| Display tier | Founding annual (per seat) | Founding monthly equivalent |
|---|---|---|
| Solo | **$324 / year** | $27/mo |
| Professional | **$660 / year** | $55/mo |
| Firm | **$1,080 / seat / year** | $90/seat/mo |

> The first cohort is, per the recommendation, roughly the first 100 Solo +
> Professional seats and the first 10 firms. See "Founding coupon" for how to cap.

**Launch-lean path (recommended):** create the three **annual** subscription
products first (Solo, Professional, Firm) plus the one `FOUNDING` coupon, prove
the subscription plumbing end to end, then add the three Monthly variants. Fewer
moving parts to test on day one.

## Step 1 - Store

1. Log in at app.lemonsqueezy.com. Store ID on file: **340394** (public slug
   `projelli` per the live checkout URLs; the live v2.5 buttons stay on the
   existing store). Confirm it's published.
2. **Do not delete or edit the existing v2.5 products** (Personal $49, Professional
   $149/yr, Practice $499/yr). They keep serving existing/grandfathered buyers and
   the live site until 3.0 cuts over. The 3.0 products below are NEW, created
   alongside them.

## Step 2 - Solo ($468/year subscription) - wire code `personal`

Products → New Product → **Subscription** → billing interval **Yearly** → price
**$468**. Name **Advisor Prep Hero Solo**.
Short description: "The complete confidential workspace for a single attorney:
the Word-native editor, AI redlining, confidential matter-scoped cited recall,
privilege controls, local or your own AI key. Per seat, billed annually."

(Optional, fast-follow) Add a **Monthly** variant: interval Monthly, **$49**.

## Step 3 - Professional ($948/year subscription) - wire code `professional`

Products → New Product → **Subscription** → billing interval **Yearly** → price
**$948**. Name **Advisor Prep Hero Professional**. Mark as the featured / most-popular product.
Short description: "Everything in Solo, plus the litigation associate (deposition
contradiction-finder, timelines, discovery triage, privilege-log drafter), version
history, all practice packs, and priority support. Per seat, billed annually."

(Optional, fast-follow) Add a **Monthly** variant: interval Monthly, **$99**.

## Step 4 - Firm ($1,548/seat/year subscription, min 3 seats) - wire code `practice`

Products → New Product → **Subscription** → billing interval **Yearly** → price
**$1,548**. Name **Advisor Prep Hero Firm**.
Set the **minimum quantity to 3** (LemonSqueezy: enable per-seat / quantity on
the variant and set a minimum of 3). Firm is sold by the seat with a 3-seat floor.
Short description: "Everything in Professional, plus shared matters and
collaboration, an admin console with SSO and ethical walls, the assured
zero-retention option, and the assurance package (DPA, trust center, SOC 2
readiness). Per seat, billed annually, minimum 3 seats."

(Optional, fast-follow) Add a **Monthly** variant: interval Monthly, **$159**, min 3.

## Step 5 - Founding coupon (`FOUNDING`)

Create ONE coupon, applied at checkout, that takes ~30% off and **renews at the
discounted price** (so founding members stay at the founding rate for life -
LemonSqueezy "forever" / recurring discount, not first-payment-only).

- **Code:** `FOUNDING`
- **Type:** percentage, **30% off**
- **Duration:** **forever** (recurring), so renewals stay discounted
- **Applies to:** the three annual subscription products (Solo, Professional, Firm)
- **Redemption cap (the cohort limit):** set **Max redemptions = 100** to start
  (covers the first ~100 Solo + Professional seats). For Firm's "first 10 firms,"
  either (a) use the same coupon and stop honoring it after 10 firm orders, or
  (b) create a separate `FOUNDINGFIRM` coupon capped at 10 redemptions. Tell me
  which; (b) is cleaner for tracking.

> Why a recurring-discount coupon and not a separate cheaper variant: a coupon
> with "forever" duration keeps founders at the discounted renewal automatically,
> and the redemption cap enforces the cohort size without maintaining duplicate
> products. If LemonSqueezy can't make the discount recurring on your plan, fall
> back to **capped founding variants** (Solo $324/yr, Professional $660/yr, Firm
> $1,080/seat/yr) with inventory caps, the same pattern the v2.5 runbook used.

## Step 6 - Send me the checkout links + keys

For each product/variant: Share → copy the **checkout URL**
(`https://<store>.lemonsqueezy.com/checkout/buy/<uuid>`). Send me:
- Solo annual $468 (+ Monthly $49 if created)
- Professional annual $948 (+ Monthly $99 if created)
- Firm annual $1,548/seat (+ Monthly $159 if created)
- The `FOUNDING` coupon code (and `FOUNDINGFIRM` if you make it)

And from Settings → API (send privately, not in public chat): the **API key** and
the **webhook signing secret** for the 3.0 webhook mapping.

## Migration / grandfather notes (important)

1. **Do not migrate or downgrade existing buyers.** Everyone who bought the old
   one-time Personal/Professional/Practice keeps exactly what they paid for. The
   v2.5 products stay live and keep validating against the current license rules.
   This is a good-faith grandfather, stated on the pricing page and in-app
   (`GRANDFATHER_POLICY` in `src/config/pricing.ts`).
2. **3.0 is a new product line, not an edit of the old one.** New LemonSqueezy
   products, new checkout URLs. No existing order is touched, refunded, or
   re-billed.
3. **Wire-code reconciliation:** the LemonSqueezy variant must map to the stable
   license tier code, NOT the display name, when the validator provisions a
   license. Solo → `personal`, Professional → `professional`, Firm → `practice`.
   The display names are app/site presentation only.
4. **Cutover, not teardown:** when 3.0 ships, point the NEW site pricing
   (`website/3.0/pricing.html`, once promoted) at the new checkout URLs. Leave the
   old products purchasable only if you want a one-time legacy path; otherwise
   unpublish them after cutover (existing licenses keep validating regardless,
   since validation is independent of the product being purchasable).

## Engineering follow-up (mine, the subscription tail)

These are required before 3.0 can take real money on subscriptions; tracked
separately from this checklist:

- **License validator (`licenses.keepance.com`):** map each 3.0 variant → tier
  code + seats; handle `subscription_created`, `subscription_payment_success`,
  `subscription_updated`, `subscription_expired`, `subscription_cancelled`;
  issue time-limited licenses; renew/revoke on the lifecycle events. Today it
  mostly understands one-time orders.
- **Firm seats:** Firm provisions an org with `seat_limit` = purchased quantity
  via the firm backend (`backend/`, `POST /admin/org`), then the admin invites
  seats. The quantity on the LemonSqueezy subscription must drive `seat_limit`.
- **App `useLicense`:** check expiry and degrade gracefully when ANY subscription
  lapses (all three tiers are subscriptions now). Data stays fully readable; AI
  features + updates turn off; show a renew prompt. The data-ownership guarantee
  copy already lives in `src/config/pricing.ts` and the license settings UI.
- **Founding lock:** ensure a founding subscription renews at the discounted
  price (coupon "forever" duration handles this on the LemonSqueezy side; the
  validator just honors whatever LemonSqueezy bills).
