# Advisor Prep Hero Pricing Recommendation (2026-05-29)

> **DECIDED 2026-05-29 (Jameson):** Go with the subscription model (the research's pick,
> written below as "Alternative"). Professional becomes a **$149/year subscription**;
> Personal and Practice stay one-time. The positioning tactics from the "primary"
> recommendation are retained: price the advisor review, anchor on Practice, founding
> urgency. Nothing in LemonSqueezy / the site / the license validator is changed yet.
> Implementation is gated on LemonSqueezy product setup (see the runbook) plus a
> license-validator + app subscription-handling change (the engineering tail below).

## Ratified model

| Tier | Price | Includes |
|---|---|---|
| **Personal** | $49 one-time | Full app, BYOK, local-first, general templates. No pack, no priority support. |
| **Professional** | **$149/year** (optional $199 one-time, can fast-follow) | Personal + one profession pack + updates while subscribed + priority support. Founding: $99/year first 100/pack, locked. Default / "Most popular." |
| **Practice** | $499 one-time (optional $299/year for 3+ seats) | All 3 packs + up to 5 seats + 24mo updates + named support. |
| Add-on pack | $79/year or $99 one-time | 2nd/3rd pack for Professional. |

Tier names kept as Personal/Professional/Practice (the research called the entry tier
"Essentials"; I kept Personal to avoid re-churning the just-shipped v2.1 licensing code).

**Engineering tail this decision creates:** the license-validator must move from one-time
orders to subscription lifecycle (issue time-limited licenses, renew on payment, revoke on
lapse), and the app's `useLicense` must handle expiry plus a graceful lapsed state. Personal
and Practice (one-time) stay perpetual. This is real work beyond the LemonSqueezy clicks.

## The problem we are solving

Current tiers (one-time): Personal $49 (full app, no pack), Professional $129
(full app + one profession pack), Practice $399 (full app + all packs + 5 seats).
Charter: $89 Professional for the first 100 buyers per pack.

Personal already includes the **entire application**: editor, every AI provider,
BYOK, local-first storage. Professional adds **only a template pack** for +$80. The
thing we charge the extra $80 for is the one thing a capable professional believes
they can rebuild themselves in an afternoon. So the middle tier (the one we most
want to sell) has no real fence protecting it, and a price-sensitive solo rationally
buys Personal and hand-rolls templates. The tiering does not make Professional the
obvious default.

## Recommendation (primary): keep "buy once," fix the fence and the anchor

I recommend we **protect the perpetual, buy-once model**. "Buy once, own forever,
your data on your machine" is a brand pillar, not just a price. It is in the hero,
the JSON-LD, and the whole emotional pitch to privacy-minded professionals who are
tired of being on someone's recurring billing. A subscription pivot (see Alternative)
solves recurring revenue but spends that pillar. We can fix cannibalization without
touching it.

### Proposed tiers (one-time / perpetual)

| Tier | Price (was) | What it includes | The fence |
|---|---|---|---|
| **Personal** | **$49** (same) | Full app, BYOK, all providers, local-first, general-purpose templates (notes, briefs, drafting). | No profession pack. No priority support. Positioned plainly as "for general use." |
| **Professional** | **$149** (was $129) | Personal + ONE profession pack (Legal / Tax / Consulting) + 1 year of pack updates + priority email support. | The pack is an **attorney/CPA-reviewed, maintained toolkit**, not "templates." That review is the moat. |
| **Practice** | **$499** (was $399) | All three packs + up to 5 seats + 24 months of updates + priority support with a named contact. | Seats + all-packs + longer support window. |

- **Charter / founding:** Professional at **$99** for the first 100 buyers per pack
  (was $89 against a $129 base). Against the new $149 base this is a stronger founding
  discount and a sharper urgency hook ("47 of 100 Legal founding seats left").
- **Second pack add-on:** existing Professional owners can buy another pack for **$79**.
- **Optional currency updates (the recurring-revenue lever that preserves buy-once):**
  your license is perpetual and your packs work forever. Optionally, **$39/year per
  pack** keeps that pack current as case law, IRS rules, and model capabilities change.
  This is the Scrivener model (perpetual license + paid updates), which professional
  buyers know and respect. For Legal and Tax this is honest: the law actually changes,
  so "keep my toolkit current" is real value, not a tax on ownership.

### Why this kills the cannibalization

1. **The gap becomes a category difference, not a convenience.** Personal is a general
   AI workspace. Professional is "an attorney-reviewed legal toolkit, kept current,
   with support." A solo can no longer shrug and say "I'll just write my own" because
   the value is the *verification and maintenance by a practicing professional*, which
   they cannot self-produce. The advisor review we are already doing for the packs is
   the thing that defeats DIY. We should price and market the review, not the files.
2. **The price gap becomes rational.** $149 one-time reads as "the cheapest
   profession-specific legal AI tool in existence" next to Clio at ~$99+/user/month
   and CoCounsel at an estimated $150-300/user/month. It stops reading as "$80 for
   some templates."
3. **The anchor works.** Practice at $499 makes Professional at $149 the obvious,
   safe middle choice (center-stage effect). Add a "Most popular" badge on Professional
   and lead the pricing page with it.

## Alternative: subscription on Professional (best for recurring revenue, costs the brand)

The research's primary pick was to make Professional a **$149/year subscription**
(with a $199 one-time option), Practice $499 one-time or $299/year for 3+ seats, and
Essentials $49 one-time at the bottom. This is the strongest answer to the durability
problem (no recurring revenue from one-time sales; nothing funds ongoing pack and
API-compatibility work). Professional buyers are demonstrably fine with subscriptions
(TaxDome runs $800-1,000/user/year).

I am listing it as the alternative, not the primary, because it **contradicts the
"buy once, own forever" promise we just shipped in v2.1's marketing** and reintroduces
the recurring-billing dependency that our privacy-first buyers are actively running
from. If the board decides recurring revenue is the priority, this is the move, but it
is a positioning change, not just a price change, and the site and JSON-LD would need
to stop saying "buy once." My optional-$39/year-currency lever in the primary
recommendation captures much of the recurring upside without spending the pillar.

## Market facts behind this (sourced)

- **What our buyers already spend.** Clio Essentials runs ~$99-138/user/month; TaxDome
  is $800-1,000/user/year per seat; a solo attorney's whole software budget is usually
  under $3,000/year (ABA 2024 Solo & Small Firm TechReport). Against that, $149 one-time
  is a rounding error, and fully tax-deductible the year they buy it.
- **The category gap is real.** Legal AI tools (Spellbook, CoCounsel, Gavel) are almost
  all enterprise, quote-based, demo-gated, and priced for 5+ attorney firms. A solo can
  barely buy them. Advisor Prep Hero is genuinely the only locally-running, private, legal-aware
  AI workspace a solo can buy in two clicks. That is worth more than $129.
- **Perpetual works for professionals.** Scrivener has sold a $49 one-time license with
  paid major upgrades for years and writers love it. Obsidian made its commercial
  license *optional* in Feb 2025 because gating a local-first tool is hard to enforce
  anyway; their revenue is optional add-ons. The lesson: on a local-first tool, lean on
  goodwill + optional paid currency, not hard gates.
- **Early-adopter timing.** Only ~19% of solo/small-firm attorneys were using AI as of
  the 2024 Legal Trends Report. The ones who seek out Advisor Prep Hero now are the high-value,
  tech-forward early adopters, exactly the buyer who pays for the good tier.
- **BYOK context.** Our buyers already pay $20/month for Claude Pro or ChatGPT Plus.
  The Advisor Prep Hero purchase sits on top as "make the key I already pay for do
  profession-specific work." It is not competing with that $20; it is leveraging it.

## What ratifying a change would require (so the cost is visible)

1. Board decision: primary (keep buy-once, re-tier to $49/$149/$499 + optional updates)
   vs alternative (subscription on Professional).
2. LemonSqueezy: create/adjust the products + the $99 founding variant (and, if we add
   it, the $39/year currency subscription and the $79 add-on).
3. Site copy + the homepage/vertical JSON-LD price fields + the pricing strip.
4. License validator: map the new LemonSqueezy variant IDs to tier + packs + seats.
5. KEEPANCE_BUSINESS_PLAN.md: record the decision and clear the stale revenue table.

## My one-line call

Keep buy-once. Go **$49 / $149 / $499**, market the packs as **attorney/CPA-reviewed,
maintained toolkits** (price the review, not the files), and add the **optional
$39/year currency update** for recurring revenue without breaking the promise. Revisit
the subscription model only if the board decides recurring revenue outranks the
"own forever" pillar.

---

*Research basis: competitor pricing (Clio, MyCase, PracticePanther, TaxDome, Drake,
Spellbook, CoCounsel, Obsidian, Scrivener, ChatGPT/Claude/Cursor), one-time-vs-
subscription economics, ABA 2024 Solo & Small Firm TechReport, Intuit/Thomson Reuters
tax-firm tech budgets, MBO Partners independent-workforce data, and good-better-best /
decoy-effect pricing literature. Full sourced report retained from the 2026-05-29
research pass; key URLs available on request.*
