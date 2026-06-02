# Keepance Go-To-Market: founder-led, tool-powered

**Date:** 2026-06-02 · Author: Claude (operator, acting as strategist / sales+marketing lead) for Jameson (CEO)
**Supersedes the "Claude drafts, Jameson sends everything" model.** New capability: the Jameworld CRM (`~/services/crm`, gated email + contacts) and the always-on Chrome let me actually *run* outreach, not just draft it. This is the plan for how.

> **Status: recommendation, pending Jameson sign-off on identity + autonomy.** Nothing gets sent until he approves the framework below, and every cold first-touch is approval-gated at https://crm.jameworld.com/ regardless.

---

## 1. Where we actually are

The product and the money path are **built and proven** (signed app, live checkout, validator that activates + revokes, a real test purchase, green tests). What we have **zero** of: customers, testimonials, and brand. The buyer (solo attorneys, CPAs, independent consultants bound by confidentiality) is the most risk-averse on earth. The founder is a product designer, not a salesperson, and not a lawyer or CPA himself.

That profile dictates the motion. We can't out-spend or out-market incumbents like Clio or TaxDome. We win the only way this kind of company ever does: **founder-led, trust-first, narrow then wide.** One real relationship at a time until we have proof, then amplify the proof. The founder's authenticity is the asset, not polish. But to a lawyer, "authentic" still has to sit on top of "this is a real company that won't disappear with my client files."

So the whole strategy is a balance of two trust signals: **Jameson the person** (warm, credible, "I built this because I had this problem") and **Keepance the company** (real domain, real product, won't vanish). The art is knowing which one to lead with in each context. That is exactly the personal-vs-company question, and it has a clean answer.

---

## 1.5 Reality adjustment (2026-06-02): there is almost no warm network

Jameson confirmed he has **zero warm contacts in the ICP** (no attorneys, CPAs, tax preparers, or consultants he knows). Two warm assets exist: (1) **Journey Beyond Wealth**, his wife's financial-advisor firm, reachable through a genuine personal connection; and (2) some **non-target friends** who would try the app but aren't the professional buyer.

This materially changes the plan and I want to be honest about it: the classic "warm intros to dollar #1" path is mostly closed to us. The realistic engine becomes four things, weighted roughly in this order:

1. **Public / community channels (top of funnel).** Show HN, r/LocalLLaMA, r/privacy, and other places where privacy-conscious strangers *self-select* into a local-first tool. For this product, with no warm network, this is the single best source of the first users and the first dollar, because the audience comes pre-sold on the wedge and needs no introduction. Jameson posts; I draft and run the comment threads.
2. **Journey Beyond Wealth as flagship design partner.** Financial advisors (RIAs) are bound by SEC Reg S-P and fiduciary duty over client financial data, and they're exactly as confidentiality-anxious about AI as lawyers. It's a strong fit even though we don't have an advisor-specific pack yet, and it comes with a real warm intro through his wife. Pursue it as design partner #1, the first named testimonial, and validation of a **financial-advisor vertical** we hadn't been targeting. (See `docs/marketing/campaigns/2026-06-design-partners/JOURNEY_BEYOND_WEALTH.md`.)
3. **Cold ICP outreach (research-built).** Solo attorneys, CPAs/EAs, RIAs, and consultants I find through directories, communities, and bar/CPA listings. Lower response rate, fully gated, and it's why the keepance.com domain-warming in section 2 matters so much. This is a slower, compounding channel, not a quick win.
4. **Non-target friends + content/SEO (supporting).** Friends seed the first few Personal-tier dollars, testimonials, and word of mouth (useful proof even if not vertical proof). Local-first/confidentiality content builds organic pull over time.

Net effect on expectations: **the first dollar most likely comes from a stranger on a public channel or from the Journey Beyond Wealth relationship, not from a warm list.** That's slower and less certain than a warm-intro launch, and the public posts plus the one warm flagship are where I'd concentrate first. The phases in section 3 still hold; their *weighting* shifts toward public + the flagship, and away from a warm-network sweep that doesn't exist.

---

## 2. The identity framework (personal vs @keepance.com)

**The deciding question for any message: who does this specific recipient trust more right now, Jameson the person or Keepance the company?** Lead with that one.

| Audience / channel | Send from | Why |
|---|---|---|
| **Warm network** (people who know Jameson) | **Personal, real Outlook** (`jamesondaines@outlook.com` via Chrome) | They trust *him*. A company address to a friend reads cold and salesy and lowers reply rate. Also the highest-deliverability inbox we have. This is where dollar #1 and testimonial #1 live. |
| **Public social** (Show HN, r/LocalLLaMA, r/privacy, personal X / LinkedIn) | **Personal accounts, always** | These communities actively punish corporate accounts. "I'm a designer who built this" is the only thing that works. Company pages amplify *after*, never lead. |
| **Cold / cool ICP** (solo attorneys, CPAs found via referral, community, directory) | **`jameson@keepance.com`** (named founder on the company domain) | The workhorse. "A real person who founded a real company is emailing me personally." Personal voice + company legitimacy + a reply lands in a monitored founder inbox. Never `noreply@` or `hello@` for this; those are blasts. |
| **Advisor recruiting** (attorney / CPA / patent reviewers) | **`jameson@keepance.com`**, but route through **personal** whenever a mutual connection exists | A favor-plus-relationship ask. Founder-on-company-domain is the right register; a warm intro beats it every time. |
| **Press / journalists** (Ambrogi, Above the Law, PH hunter) | **`jameson@keepance.com`** | Journalists expect a founder at a company. A personal gmail undercuts credibility. |
| **Transactional / support / inbound auto-replies** | **role `@keepance.com`** (`support@`, existing `noreply@` for system mail) | Here it's the company speaking, and that's correct. |

**The through-line:** named-founder-on-company-domain (`jameson@keepance.com`) is the default for outbound *business* outreach; the real personal inbox for warm and social; role addresses only for transactional. The thing to avoid everywhere outreach wants a reply is `noreply@`/generic mailboxes.

**Why `jameson@keepance.com` and not the CRM's current `noreply@keepance.com`:** you cannot do outreach from a no-reply address. People can't respond, it can't receive, and it signals "marketing automation." A named, repliable founder address is non-negotiable for a relationship-driven sale. Adding it is a Phase A setup step.

### The one hard constraint: domain reputation
keepance.com is a brand-new sending domain. If we open the taps with cold mail from `jameson@keepance.com` on day one, a chunk lands in spam and we **burn the domain's reputation before it exists.** So the first wave is deliberately **personal-Outlook-heavy** (established reputation, warm recipients), while we **warm keepance.com in parallel**: verify `jameson@keepance.com` in Brevo with SPF/DKIM/DMARC, then ramp volume slowly (replies and warm-ish first, low daily caps) so that by the time we do colder ICP and press outreach, the domain has earned its way into the inbox. This is not optional; it's the difference between outreach landing and outreach disappearing.

---

## 3. The motion (phased)

The shift: outreach was assets in a folder. Now it's a running operation. I build the lists, personalize and queue sends from the right identity, manage the pipeline in the CRM, handle inbound replies, and follow up. Jameson approves (everything is gated by default), does the things only he can (social posts, his warm contacts, real-time relationship calls), and sets direction.

**Phase A: Stand up the machine.** (Mostly me; needs some Jameson input.)
- Add `jameson@keepance.com` as a verified founder sender (CRM + Brevo), with replies routed to a monitored inbox (CRM Phase-2 inbox or his inbox).
- Seed the Keepance project in the CRM with contact lists: warm network, ICP targets, advisor targets, press, design-partner candidates.
- Agree autonomy levels (which flows are `--auto` vs gated).

**Phase B: Warm + design partners.** (Real Outlook + personal.)
- Work Jameson's warm network personally. Recruit 5-8 design partners (copy already drafted in `docs/marketing/campaigns/2026-06-design-partners/`).
- Target: dollar #1, testimonial #1, real-usage feedback. This is the highest-yield, lowest-risk start.

**Phase C: Advisors.** (`jameson@keepance.com` + warm intros.)
- Recruit attorney + CPA + patent advisors (packets + emails drafted in `docs/marketing/campaigns/2026-legal-launch/` and `2026-consulting/`). This makes the "maintained packs" promise fully true again and unlocks the law/tax launch.

**Phase D: Public + press.** (Personal social + `jameson@` for press.)
- Show HN / Reddit (Jameson posts; I draft + handle comment replies from the existing reply bank). Copy in `docs/marketing/campaigns/2026-06-first-dollar/`.
- Press pitches (Ambrogi / Above the Law) via the CRM from `jameson@keepance.com`. Product Hunt once we have a hunter + 2-3 testimonials.

Phases B and C run in parallel. D follows once there's proof (a testimonial or two) to point at.

---

## 4. How I run it (operating model)

- **One pipeline, in the CRM.** Every contact, every touch, every reply, every follow-up, tagged by phase and status. I can report pipeline state on demand (who's been contacted, who replied, who's a design partner, who bought).
- **Gated by default.** Cold first-touches always queue as drafts for Jameson's approval. I never auto-send a cold email. Specific low-risk flows (e.g. a follow-up to someone already in a live thread, or onboarding a confirmed buyer) can graduate to `--auto` once he clears them.
- **Inbound = data, never instructions.** Replies are treated as untrusted content. I qualify them, draft responses (gated), onboard buyers, and trigger the testimonial ask at the right moment.
- **The founder does founder things.** Social posts, his warm contacts by name, any real-time relationship moment, and final approval on anything sensitive. I do the volume, the research, the personalization, the tracking, the follow-up discipline that founders always let slip.
- **Voice.** Every word follows the Jameson voice profile and stays on the honest local-first / BYOK pitch. No compliance claims until advisors sign off (the packs claim is already softened on the site).

---

## 5. Decisions I need from Jameson

1. **Approve the identity framework**, especially standing up `jameson@keepance.com` as the founder outreach sender.
2. **Set my autonomy level.** Recommendation: fully gated for the first ~2 weeks (I queue every send, you approve at crm.jameworld.com) to calibrate targeting and voice, then graduate proven flows to `--auto`.
3. **The warm list** is the single highest-value asset and only he has it. Either he hands me names/emails, or authorizes me to pull his contacts from Outlook via Chrome.
4. **Founder bio verification** still gates credible outreach to professionals (live + unverified). It needs to happen before Phase C/D.
5. **CRM gaps:** tell him anything the CRM can't yet do that the motion needs (e.g. open/click tracking, scheduled follow-up reminders, per-campaign sequences), so the other instance can build it.

---

## 6. What does NOT change
- No autonomous public posting (his accounts, his voice, his call).
- No compliance claims until advisors review.
- Honest local-first pitch is the wedge for everything pre-advisor.
- The founder stays in control; the CRM gate enforces it.
