# Keepance Financial Model (rebuilt for subscription pricing) — 2026-06-17

> Replaces the stale model in `KEEPANCE_BUSINESS_PLAN.md`, which the 2026-06-17 evaluation correctly called fiction: it modeled the retired one-time $49/$99 pricing and a $10K-MRR target with no CAC/LTV. This rebuilds the unit economics around the live per-seat annual subscription and, honestly, frames the *decision* (and the kill-criterion) rather than forecasting revenue we have no data to forecast. Pricing source of truth: `src/config/pricing.ts`.

## 1. Unit economics — the one structural advantage: BYOK means ~zero COGS

Keepance never pays for inference (the user brings their own AI key and pays the provider directly). So variable cost per customer is essentially just the merchant-of-record fee, and gross margin is unusually high for software.

| Tier | List price | Variable COGS (LemonSqueezy MoR ~5% + ~$0.50) | Net/yr | Gross margin |
|---|---|---|---|---|
| **Solo** | $468/yr | ~$24 | ~$444 | ~95% |
| **Professional** | $948/yr | ~$48 | ~$900 | ~95% |
| **Firm** | $1,548/seat/yr (min 3 = $4,644) | ~$77/seat | ~$1,471/seat | ~95% |

Fixed costs are small and mostly already sunk: code-signing certs (Azure Trusted Signing + Apple Developer, low hundreds/yr), the license-validator + firm-relay hosting (pennies; they store no content and serve tiny payloads), and the domain/site. There is **no inference COGS, no per-seat cloud cost** — the cost the typical AI-SaaS carries. This is the model's bright spot: every dollar of revenue is ~95 cents of margin.

**LTV (gross-margin-adjusted, assuming a testable ~3-year average retention for a workflow-embedded professional tool):**
- Solo ≈ $444 × 3 ≈ **$1,330** · Professional ≈ **$2,700** · Firm (3 seats) ≈ **$13,200**.
- The founding cohort (30% off for life) trades ~30% of ARPU for loyalty + early proof; a founding Solo nets ~$310/yr. Worth it for the first ~100 seats / first 10 firms (the references are worth more than the margin right now).

## 2. CAC — the model is time-bound, not cash-bound

This market buys on peer trust, referrals, and live founder demos, not ads (per the GTM research). So:
- **Cash CAC ≈ near zero** for the first cohort: earned media (LawSites/Lawyerist), a conference (ABA TECHSHOW Startup Alley), bar-section CLEs, and founder-led demos. The spend is ~$0; the cost is **founder time**.
- **Founder-time is the binding constraint**, not money. The model that matters is "how many disciplined founder-hours per closed customer," and we won't know it until the first ~10 are hand-sold.
- **Defer paid lead-gen** (Capterra ~$500/mo minimum) until there's a proven demo→close motion and reviews to amplify. Paying for leads before the motion works is lighting cash on fire.

## 3. Scenarios (assumption-driven, not forecasts)

| Milestone | What it takes (one illustrative mix) | ~ARR | What it actually proves |
|---|---|---|---|
| **First 10 customers** | 10 hand-sold litigation solos/small-firms (Solo/Pro) | ~$5–9K | **Validation** — do litigators actually pay for local-first? (The real goal; revenue is incidental.) |
| **Lifestyle** | ~80 Professional, or ~130 Solo, or a blend + 2–3 small Firms | ~$60–90K | The hand-sold motion + referrals compound; sustainable as a solo operator business. |
| **Small company** | ~270 Professional, or the Firm motion at scale (a dozen 5-seat firms ≈ $93K alone) | ~$250K+ | Requires either the **Firm tier** (gated on the SOC 2 / DPA proof moat) or a few hundred solos via a repeatable channel. |

At ~95% margin, the revenue-to-take-home conversion is high, so the lifestyle threshold is reachable at modest customer counts. The small-company threshold is where the **trust moat (entity, DPA, SOC 2, references)** stops being optional — the Firm tier can't scale on "trust me."

## 4. Sensitivity — the levers that move the model (and the one that doesn't)

1. **Reach / distribution** — the #1 binding constraint (225 site visitors in 10 weeks). Nothing else matters until the ICP is in front of the product. Every scenario is gated here first.
2. **Demo → close rate** — the conversion event is a 10–20 min founder demo on the prospect's own matter. A 2x here halves the customer count for every milestone.
3. **Annual churn / retention** — at 95% margin, retention compounds hard into LTV; one extra year of average life adds ~$444 (Solo) to ~$1,471/seat (Firm) of nearly-pure margin.
4. **NOT price.** The price is fine and the margin is excellent; the constraint is upstream (reach + trust), not the number on the card. Discounting to win the first 10 (the founding rate) is about proof and loyalty, not price elasticity.

## 5. The kill-criterion (the model's real job)

Because conversion/churn/CAC are **assumptions, not data**, the model's job today is to frame the go/no-go, not to predict revenue. Per the evaluation: commit to a fixed window of disciplined hand-selling to the litigation ICP (Jameson sets the window). **If it yields no paying customers and no named design-partner testimonials, the thesis "litigators will pay for local-first" is probably wrong** → the live options are to pivot the wedge (CPA / IRC §7216 — the cleanest regulatory fit and where the only real pain signal came from) or accept Keepance as a solo/lifestyle product. Define the window and the bar explicitly; don't let "keep building" be the escape hatch.

## 6. Honest caveats

- **Pre-traction:** every conversion/churn/CAC number above is an assumption to TEST, not a forecast. Treat the scenarios as "what would have to be true," not projections.
- **Re-run with real data after the first ~10 customers** (the evaluation's Step 7): replace the assumed demo→close and retention with measured ones; only then is a forward MRR projection meaningful.
- **The margin advantage (BYOK ≈ zero COGS) is real and durable** — it's the one number here that isn't an assumption, and it's why this can work at solo/lifestyle scale even if it never reaches venture scale.

*Author: Keepance build session (Claude, Opus 4.8), 2026-06-17. This frames the decision; it is not a revenue forecast. Supersedes the financial section of `KEEPANCE_BUSINESS_PLAN.md` until that doc is updated.*
