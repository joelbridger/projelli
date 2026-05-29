# 04: Retention and Word-of-Mouth

_Last reviewed: 2026-04-27_
_Status: Plan. Email sequences exist (`docs/marketing/playbook/EMAIL_SEQUENCES.md`); this layers strategy on top._

With one-time pricing, "retention" doesn't mean "preventing cancellation." It means three different things, in this order of priority:

1. **Free → Pro → Lifetime upgrade economics.** Each tier upgrade is a second sale, and these are far cheaper to earn than first sales.
2. **Buyer → advocate conversion.** The founder who paid $49 last month and tells four people next month is worth $200+ to us in lifetime referrals.
3. **Refund prevention.** A refund is a lost sale plus a small reputation tax. Avoidable refunds (5-10% of all sales without intervention) are revenue we leave on the table.

This doc sequences the lifecycle to maximize all three.

---

## 1. The lifecycle map

| Stage | Trigger | Goal | Owner |
|---|---|---|---|
| **Pre-purchase** | Lands on projelli.com | Email signup OR direct buy | Engine 1 + 2 |
| **Day 0** | Purchase completes (LemonSqueezy webhook) | License activation, first launch | Welcome email + in-app |
| **Day 1-7** | First-week activation | Workspace created, first AI chat, first template run | Email sequence + product onboarding |
| **Day 8-30** | Power-user activation | 3+ workflows run, daily-active streak | Behavior-triggered emails |
| **Day 31-60** | Habit formation | Returns weekly without prompting | Product (not marketing) |
| **Day 60-90** | Advocacy window | Asks "have you heard of Projelli?" to a peer | Testimonial request, referral mechanic |
| **Month 3-12** | Tier upgrade window | Free → Pro, Pro → Lifetime | Upgrade emails, feature drops |
| **Month 12+** | Lapsed user reactivation | "I forgot about this" → returns | Annual email |

The first 30 days do 80% of the work. Get those right and the rest is downstream.

---

## 2. Day 0 onboarding (the first 30 minutes after purchase)

The single most important window in the entire lifecycle. The buyer is at peak excitement and peak doubt. If they hit friction in the first 30 minutes, they ask for a refund. If they reach the magic moment, they recommend Projelli to a peer within a week.

The magic moment for Projelli is specific: **the user types their first AI chat in Projelli and watches a Markdown file appear in their workspace folder in real time.** That single experience is what makes "chat-as-files" not abstract. We optimize the first 30 minutes around reaching that moment.

### What needs to be true at Day 0

| Item | Status | Notes |
|---|---|---|
| Welcome email arrives within 60 seconds | ✅ Wired (Brevo + LS webhook) | Verify deliverability monthly |
| Welcome email contains license key + 1-click activation | ✅ | Per `EMAIL_SEQUENCES.md` |
| App downloads work cross-platform | ✅ | Verified per launch checklist |
| First-run wizard guides API key setup | ✅ Wired (`FirstRunWizard.tsx` v1.6) | Per memory |
| First-run wizard offers a starting template choice | ✅ | One of the 15 templates |
| AI chat opens in 1 click after wizard | ✅ | Verified |
| First message produces a `.aichat` file visible in tree | ✅ | Verified |

### What we add to make Day 0 stronger

- **Welcome email body update** to include a 90-second screencast (`youtube.com/watch?v=...`) showing the magic moment from a fresh install. Reduces "I can't figure this out" refunds.
- **In-app first-run nudge** at minute 5: "Try a template: Pitch Deck takes 8 minutes and gives you a real artifact." (We already have the wizard; this is the post-wizard nudge.)
- **Day-1 email** ("How was your first session?") at +24 hours from purchase. Pre-staged in `EMAIL_SEQUENCES.md`. Open rate target: 50%+. Reply rate target: 5%+ (every reply is a feedback gold mine).

### Refund-prevention checklist

Per LemonSqueezy data on indie desktop apps, refunds cluster around five reasons. Each gets a Day-0 mitigation:

| Refund reason | Mitigation |
|---|---|
| "Couldn't get it to install" | Welcome email links to the cross-platform install guide; first-line support reply within 24 hr |
| "Didn't realize I needed an API key" | Wizard makes this explicit; pricing page makes this explicit; both already done |
| "Didn't work like I thought" | Day-1 email asks "what were you hoping for?": converts refund-considerers into product-feedback |
| "Bought the wrong tier" | Free upgrade-tier-up offer in welcome email (pay difference, no penalty) |
| "Charged twice / wrong amount" | LemonSqueezy handles; we never see this. But the support email template apologizes + refunds in 1 reply. |

**Refund SLA:** any refund request is honored within 24 hours, no questions asked, no friction. Combative refund handling is the fastest way to generate negative reviews. We absorb the loss.

**Refund logging:** every refund gets a row in `~/projelli/sign-ups/refunds.csv` with: date, tier, reason category, verbatim reason. Reviewed monthly to identify systemic issues.

---

## 3. The Day 1-7 activation sequence

The buyer has the product. Now we need them to use it enough that the magic moment happens at least three times. Three uses in week 1 correlates strongly with returning in week 2.

### Email sequence

Already drafted in `playbook/EMAIL_SEQUENCES.md`. Quick map:

| Day | Email | Goal |
|---|---|---|
| Day 0 | Welcome + license key | Activate |
| Day 1 | "How was your first session?" | Feedback / refund-prevent |
| Day 3 | "Have you tried the [Template Name] template?" | Push to 2nd activation |
| Day 7 | "Quick tip: drag AI responses to your file tree" | Feature discovery |
| Day 14 | "How's it going?" | Re-engagement |
| Day 21 | "Have you tried [advanced feature]?" | Power-user nudge |
| Day 30 | "What would you tell a peer about Projelli?" | Testimonial / referral seed |

We do not stack more than 7 emails in 30 days. Indie buyers are sensitive to email volume. Each email in the sequence has an unsubscribe link with a one-click "stop emails but keep the product" option.

### In-app activation tracking

The product already has audit logging (`AuditService.ts`). We use it to identify activation patterns without sending data anywhere (audit log is local). Patterns we want to encourage:
- 3+ AI chats in week 1
- 1+ workflow template run
- 1+ wiki-link or backlink created
- App opened on 4+ days in week 2

Users hitting all four are "activated" and 4-7x more likely to recommend Projelli. We don't have telemetry to know who they are remotely, but the email sequence assumes the worst (no activation) and nudges accordingly.

---

## 4. The Free → Pro upgrade flow

Free tier gives: core editor, file tree, Markdown, wiki-links, version history, audit log, 1 AI provider (Claude only), 3 templates, 1 workspace.

Pro tier ($49) adds: all 3 AI providers, all 15 templates, unlimited workspaces, whiteboard, audio, research/citations, multi-model comparison, 1 year of updates.

The upgrade prompt mechanism:

| Trigger | Prompt | Where |
|---|---|---|
| User tries to add 2nd workspace | "Pro adds unlimited workspaces. Upgrade for $49 (one-time)." | In-app modal |
| User tries to use OpenAI or Gemini provider | "Pro adds all 3 providers." | In-app modal |
| User tries a 4th template | "Pro adds all 15 templates." | In-app modal |
| User opens whiteboard | "Pro adds whiteboard, audio, and research tools." | In-app modal |

Each prompt uses the exact same copy: "$49 one-time, Pro adds [feature]. No subscription, ever." The repetition trains the buyer that Pro is a one-time decision, not a recurring one.

Conversion target for Free → Pro: **3-7%** of free signups in the first 90 days. Industry baseline for paid-feature gating in indie tools is 1-5%; the one-time-pricing framing should help.

---

## 5. The Pro → Lifetime upgrade flow

This is the highest-margin upgrade we have. Pro buyers got the product; they're already validated. Selling them Lifetime ($50 incremental) is a much easier sale than the original Pro purchase.

### When we offer it

| Trigger | Offer | Price |
|---|---|---|
| Purchased Pro 60+ days ago AND used in last 14 days | "Lock in updates forever for $50 more" | $50 upgrade |
| Year 1 Pro nearing expiry (month 11+) | "Renew for free for life" | $50 upgrade |
| Major feature launch | "Pro buyers: lock this and all future features in for $50" | $50 upgrade |

LemonSqueezy supports tier upgrades natively. We don't need to build anything for this.

Conversion target for Pro → Lifetime: **15-25%** of Pro buyers within 12 months of purchase.

### Why this matters financially

If 100 Pro buyers ($49 each = $4,900) upgrade at 20% to Lifetime ($50 incremental = $1,000 extra), we earned $1,000 with zero acquisition cost. Compare that to acquiring 20 new Pro buyers, which at our funnel math (1% close rate from 2,000 visitors) costs Jameson hours and possibly newsletter dollars.

**Tier upgrades are the most profitable revenue we generate.** Year one goal: 30-60 Pro → Lifetime upgrades by month 12.

---

## 6. Word-of-mouth amplification

The single most important fact about indie tools: most paying customers tell at least one peer about a tool they love within 30 days. Most never get asked. Asking, at the right time, in the right way, multiplies organic spread by 3-5x.

### The 30-day testimonial request

At day 30, the email asks: "What would you tell a peer about Projelli?"

We give buyers two clear options:
- A **public review**: a 1-2 sentence quote we can use on the homepage / vs-pages, attributed by name + role + (optional) photo
- A **private note**: feedback to us, no public use, no follow-up

Indie buyers respond to this because:
- It's framed as collaboration, not a favor
- Both options are legitimate (no pressure for public)
- It comes after they've had the product long enough to know if they like it

Response rate target: **8-15%** of buyers respond, of whom **half opt for public review**. That's 4-7 testimonials per 100 buyers, and we need ~30 strong testimonials over year one.

### Where testimonials get used

| Asset | Testimonial type |
|---|---|
| Homepage social proof row | 4-6 highest-credential, varied ICP |
| Pricing page | 2-3 specifically about ROI / "worth it" |
| vs-page footers | 1-2 each, specifically about the comparison |
| Press kit "what users say" | 6-10 |
| Email sequence email #5 | 2-3 buyer quotes |
| Newsletter sponsorship creative | 1 short pull quote |

Track in `~/projelli/sign-ups/testimonials.csv` with: name, role, company (or "indie founder"), quote, date received, public-permission, photo URL.

### The referral mechanic (Q3 launch)

Per `03-partnership-spikes.md`, we launch a structured affiliate / referral program in Q3 (month 7-8). 15% lifetime commission, hand-approved affiliates.

Before then, we encourage informal referrals through:
- A simple "share this with a founder friend" link in email #6 with no commission attached
- Founder-first language in the welcome email ("If a founder you know would benefit, send them projelli.com/?ref=[buyer-firstname]")
- Public LinkedIn / X recognition for buyers who post about Projelli (we always engage, never spam)

The structured program in Q3 amplifies what's already a small organic flow.

---

## 7. The lapsed user re-engagement flow

Some buyers will install Projelli, use it for 2 weeks, and stop. Not because they're unhappy, but because their attention moved elsewhere. We want to recover them.

### The "what's new" annual email

Once per year, we send every buyer a single "year in review" email:
- Top 5 features added in the past year
- 1-2 buyer testimonials
- 1 link back to the product
- 1 unsubscribe option

This is a low-frequency, high-relevance email. Open rates for this kind of message run 35-50% in the indie tools space. Conversion-back-to-active-use rates are typically 5-10%.

Schedule: First lapsed-user email goes out around month 12 to year-1 buyers.

### The major feature re-engagement

When we ship a v2.0-equivalent feature, every buyer gets a one-time email about it. Same rules: low frequency, high relevance, easy unsubscribe.

We will not send "we shipped a UI tweak" emails. The bar for buyer-list emails is "this would have changed your decision to buy." Anything below that bar goes on the brand X / blog and lets buyers find it themselves.

---

## 8. The "this product earned my recommendation" moment

The strategic insight here: **buyers don't recommend Projelli because they used it once. They recommend it because the product solved a specific, named problem for them.**

For indie founders, the named problems are:
- "I needed to write a pitch deck and Projelli's template + AI got me to a working draft in 90 minutes"
- "I have a folder full of customer interviews from Projelli that I can search and quote whenever I write a sales page"
- "I stopped paying for Notion AI and got better results from Claude through Projelli with my own key"
- "I run my whole weekly review through the Projelli template now"

We want to learn which of these stories resonates most for actual buyers and double down. The day-30 email asks specifically: "Which workflow saved you the most time?" Tracking this in `~/projelli/sign-ups/recommendation-stories.csv` lets us:
- Refine vs-pages around the most common stories
- Pick which use-case page to write next
- Pull the strongest stories as case studies (one quarterly case study post)

The story-collection mechanism is the most valuable retention work we can do. Each story becomes a marketing asset that converts the next buyer.

---

## 9. KPIs for retention and word-of-mouth

| Metric | Year 1 target | How measured |
|---|---|---|
| Refund rate | <8% of paid sales | LemonSqueezy dashboard |
| Day-1 email open rate | 50%+ | Brevo |
| Day-1 email reply rate | 5%+ | Brevo + manual log |
| Free → Pro conversion | 3-7% within 90 days | LS + email cohort tracking |
| Pro → Lifetime conversion | 15-25% within 12 months | LS dashboard |
| Testimonial response rate | 8-15% of paid buyers | Manual log |
| Activations (3+ AI chats in week 1) | 60%+ of paid buyers | Inferred from refund rate + email reply rate |
| Net Promoter Score | 40+ (asked at day 30) | Day-30 email |
| Affiliate-driven revenue (Q3+) | 5-10% of monthly revenue by month 12 | LS affiliate dashboard |

Reviewed monthly per `06-measurement-cadence.md`.

---

## 10. References

- `~/projelli/docs/marketing/playbook/EMAIL_SEQUENCES.md`: the 10 lifecycle emails (already drafted)
- `~/projelli/docs/marketing/playbook/REPLY_BANK.md`: comment / DM reply templates
- `~/projelli/PROJELLI_BUSINESS_PLAN.md`: pricing rationale (the 16 CEO decisions)
- `00-master-strategy.md`: why retention math matters under the revenue-focused thesis
- `03-partnership-spikes.md`: the affiliate program details
- `06-measurement-cadence.md`: review cadence
