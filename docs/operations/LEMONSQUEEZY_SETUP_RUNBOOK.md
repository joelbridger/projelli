# LemonSqueezy setup runbook (Jameson's hands, ~20 min)

Checkout is the one launch-blocker only you can do: it's your account and your money. Everything around it is ready. This is the exact click-path. Do it when you're ready to take payment; I wire the URLs in after.

## Current state

- The live buy buttons on the homepage and the three vertical pages are intentionally degraded to "Download free for 30 days" + "Reserve the founding price" (the charter email list). The real checkout URLs are saved next to them in HTML comments (`<!-- TODO restore when LemonSqueezy ... -->`).
- The old checkout URLs (`33cd497b…`, `9a5a7f48…`) and the store at `keepance.lemonsqueezy.com` return 404. The new Personal/Professional/Practice products were never created. That's what this fixes.
- The license-validator service (`licenses.keepance.com`) is live and wired for activation; it needs the store's API key + webhook secret in `/etc/license-validator.env` (step 5).

## Step 1 — Find or create the store

1. Log in at app.lemonsqueezy.com. Store ID on file is **340394**.
2. Confirm the store is **published** (not in test mode for the public link) and note its **public URL** (Settings → Stores → the `*.lemonsqueezy.com` slug). If the slug isn't `keepance`, that's fine, just tell me what it is.

## Step 2 — Create three products (all one-time)

For each: Products → New Product → Single payment (one-time), digital, no license-key gen needed here (the app validates via our own service). Name and price exactly:

| Product | Price | Description (short) |
|---|---|---|
| **Personal** | $49 | The full Keepance app. All core features, BYOK, local-first. No profession pack. |
| **Professional** | $129 | Everything in Personal plus one profession practice pack (Legal, Tax, or Consulting). |
| **Practice** | $399 | Everything in Professional, up to 5 seats, all three packs. |

## Step 3 — Charter (founding) pricing for Professional

Founding-practitioner price is **$89** for the first 100 buyers of each pack. Two clean ways:
- **Simplest:** a discount code (e.g. `FOUNDING`) for $40 off Professional, usage limit 100. Share the checkout link with the code pre-applied.
- **Or** a separate "Professional (Founding)" variant at $89 with an inventory cap of 100.
Pick whichever you prefer; tell me which and I'll word the site to match.

## Step 4 — Grab the checkout links and send them to me

For each product: Share → copy the **checkout URL** (looks like `https://<store>.lemonsqueezy.com/checkout/buy/<uuid>`). Send me all four:
- Personal $49
- Professional $129
- Professional $89 founding (or the discount link)
- Practice $399

I'll drop them into the `TODO restore` placeholders on the homepage + `/legal/`, `/tax/`, `/consulting/`, flip the buttons back to real "Buy" CTAs, verify each returns 200, and redeploy.

## Step 5 — License validation wiring (send me, don't paste in chat publicly)

From Settings → API: the **API key** and the **webhook signing secret**. I'll confirm they're in `/etc/license-validator.env` and that the webhook points at `https://licenses.keepance.com/webhook`. Then a test-mode purchase end-to-end: buy → email → activate in-app → restart → still activated.

## What I do after you send the URLs + keys

1. Wire the four checkout URLs into all four pages, restore real Buy buttons.
2. Verify every checkout link resolves (200).
3. Confirm license activation works end to end in LemonSqueezy test mode.
4. Redeploy. Then the only launch-blocker left is the v2.1 build (rebranded app with the draft packs) and advisor sign-off on the legal/tax templates.
