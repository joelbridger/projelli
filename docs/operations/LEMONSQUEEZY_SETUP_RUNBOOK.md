# LemonSqueezy setup runbook (subscription model) — Jameson's hands

> **Pricing model ratified 2026-05-29: Professional is now an annual subscription.**
> Full reasoning in `docs/strategy/PRICING_RECOMMENDATION_2026-05-29.md`.
> Heads-up: unlike the old all-one-time plan, the subscription adds engineering work
> *after* your clicks (the license service has to handle subscription renewals/expiry,
> and the app has to handle a lapsed license). That part is mine; see "Engineering
> follow-up" at the bottom. Your part is still just the LemonSqueezy click-path.

## The model to build

| Tier | Create in LemonSqueezy as | Price |
|---|---|---|
| **Personal** | One-time product | **$49** |
| **Professional** | **Subscription** product, billed yearly | **$149 / year** |
| **Professional (Founding)** | Subscription variant, yearly, cap 100 per pack | **$99 / year** (locked on renewal) |
| **Practice** | One-time product | **$499** |
| *(optional, can fast-follow)* Professional one-time | One-time variant | $199 |
| *(optional, can fast-follow)* Practice 3+ seats | Subscription, yearly | $299 / year |
| *(optional)* Add-on pack (2nd/3rd pack) | One-time or yearly | $99 once / $79 yr |

**Launch-lean path (recommended):** create just the four bold rows (Personal, Professional
subscription, Professional Founding, Practice). Add the optional one-time/seat variants
later once the subscription plumbing is proven. Fewer moving parts to test on day one.

## Current state

- Live buy buttons on the homepage + three vertical pages are intentionally degraded to
  "Download free for 30 days" + "Reserve the founding price." Real URLs are saved next to
  them in `<!-- TODO restore when LemonSqueezy ... -->` comments.
- Old checkout URLs and the old store link 404. The new products were never created. This fixes that.
- License-validator (`licenses.keepance.com`) is live; needs the store API key + webhook secret (step 6).

## Step 1 — Store

1. Log in at app.lemonsqueezy.com. Store ID on file: **340394**.
2. Confirm it's published, and note the public `*.lemonsqueezy.com` slug. If it isn't `keepance`, just tell me what it is.

## Step 2 — Personal ($49, one-time)

Products → New Product → **Single payment**, digital. Name **Personal**, price **$49**.
Short description: "The full Advisor Prep Hero app. All core features, BYOK, local-first. No profession pack."

## Step 3 — Professional ($149/year, SUBSCRIPTION) ← the change

Products → New Product → **Subscription** → billing interval **Yearly** → price **$149**.
Name **Professional**. Short description: "Everything in Personal, plus one profession
practice pack (Legal, Tax, or Consulting), kept current, with priority support."

(This is the structural change from the old plan. Professional is a yearly subscription now,
not a one-time purchase.)

## Step 4 — Professional (Founding) ($99/year, first 100 per pack)

Add a **variant** of the Professional subscription (or a second subscription product):
yearly, **$99**, with a quantity/inventory cap of **100**. A variant is cleaner than a
discount code here, because LemonSqueezy subscriptions renew at the variant's price, so
founding members stay at $99/year for life automatically.

If you want founding limited per pack (100 Legal, 100 Tax, 100 Consulting), make three
capped variants, or run one cap of 100 to start and we split later. Tell me which.

## Step 5 — Practice ($499, one-time)

Single payment, **$499**. Name **Practice**. Short description: "All three packs, up to 5
seats, 24 months of updates, priority support with a named contact."

## Step 6 — Send me the checkout links + keys

For each product/variant: Share → copy the **checkout URL**
(`https://<store>.lemonsqueezy.com/checkout/buy/<uuid>`). Send me:
- Personal $49
- Professional $149/year
- Professional Founding $99/year
- Practice $499
- (any optional variants you created)

And from Settings → API (send privately, not in public chat): the **API key** and the
**webhook signing secret**.

## What I do after you send the URLs + keys

1. Wire the checkout URLs into the homepage + `/legal/`, `/tax/`, `/consulting/`; restore real Buy buttons; verify each resolves (200).
2. Update displayed prices + the page JSON-LD to $49 / $149-year / $499, add the "Most popular" badge on Professional and the founding-seats counter, and reframe the packs as "attorney/CPA-reviewed, kept current" (the positioning that makes Professional the obvious choice).
3. **Engineering follow-up (the subscription tail):**
   - License-validator: map each variant to tier + pack(s) + seats, AND handle the subscription lifecycle webhooks (`subscription_created`, `subscription_payment_success`, `subscription_expired`, `subscription_cancelled`) so it issues a time-limited license and renews/revokes it. Today it only understands one-time orders.
   - App `useLicense`: check license expiry and degrade gracefully when a subscription lapses (read-only / trial-style, with a renew prompt). Personal and Practice stay perpetual, so this only affects Professional.
4. Test-mode purchase end to end (buy → email → activate → renew/expire behaves) before going live, then redeploy.

> The one-time tiers (Personal, Practice) are no engineering change. The subscription tier
> is the new work. If you want the fastest possible "take money" date, we can even launch
> Professional as one-time $199 first and switch it to the $149/year subscription once the
> renewal plumbing is tested. Your call.
