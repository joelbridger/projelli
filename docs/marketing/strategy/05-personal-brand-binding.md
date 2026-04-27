# 05: Personal Brand Binding (the selective hybrid)

_Last reviewed: 2026-04-27_
_Status: Decided 2026-04-27 by the board (selective hybrid, option D)._

This doc resolves an explicit tension between two existing strategies:

- The **personal brand strategy** (`reference_personal_brand_strategy.md`): Jameson posts on LinkedIn / X with 95% non-project content (behavioral science, health-tech, building things) and only 5% direct project mention.
- The **launch playbook** (`docs/marketing/channels/`): build-in-public tweets, IH "8 weeks to first paying customer" post, founder bio in press kit, all of which require Jameson to publicly attach himself to Projelli.

**The decision: selective hybrid (option D).** Projelli has its own brand account that runs day-to-day marketing. Jameson's real-name accounts amplify 1-2 times per month within the 5% project-mention slot. Real name appears in the press kit and one launch beat but is not the marketing engine.

This document defines how that operates in practice.

---

## 1. Why the selective hybrid was chosen

Three other options were considered:

- **Fully fused** (option A): Jameson's real name and face are the marketing. Highest top-of-funnel, but compromises the 95% personal brand rule and creates Wheel Health adjacency risk if employer optics shift.
- **Pseudonym-led** (option B): All public-facing presence under `joelbridger`. Clean separation, but loses the credibility a real founder bio brings to a paid product.
- **Brand-account-led** (option C): Projelli has its own voice, no real name appears anywhere. Cleanest separation, lowest top-of-funnel.

The selective hybrid wins because:
- The brand account does the time-intensive work (daily replies, build-in-public threads, AMAs), keeping Jameson's hours low
- Jameson's real name appears in just enough places (press kit founder bio, the IH launch story, occasional amplification posts) that buyers can verify the founder is a real human
- The 95% non-project rule on Jameson's personal brand stays intact: Projelli is the 5% slot, not a takeover
- Wheel Health is protected: nothing on Jameson's personal accounts ever conflicts with employment, since Projelli is just one of several things he builds

---

## 2. Two voices, two roles

| Voice | Account | Frequency | Job |
|---|---|---|---|
| **Brand voice (Projelli)** | `@projelli` on X, `projelli` on IH, `projelli` press kit author, blog author = "the team behind Projelli" | Daily (X), weekly (blog), as-needed (IH/Reddit replies) | Marketing engine, daily community presence, replies to launch threads |
| **Jameson voice (real name)** | `@jamesondaines` on X, Jameson Daines on LinkedIn, Jameson Daines as press kit founder bio | 1-2 posts/month about Projelli, plus 1 launch story | Credibility binding, occasional amplification, the 5% slot |

These voices are distinct in tone. The brand voice is editorial and product-focused. The Jameson voice is observational, day-anchored, slightly wry, per `feedback_jameson_voice_profile.md`. Mixing them is the most common mistake and we will not make it.

### What the brand voice sounds like

Editorial, product-focused, first-person-singular ("I built Projelli because...") but not personally identifiable. Tone is direct, honest, technically literate. Reads like a small-team product blog, not a corporate one.

Example brand-voice tweet:
> Shipped MCP server support today. Projelli is now an MCP server you can connect to from Claude Desktop or any other MCP client. Local. BYOK. No telemetry. Demo: [link]

### What the Jameson voice sounds like

Per the voice profile, this is observational and personal. Real-life anchors. Specific time stamps. Self-deprecating openings. Avoids McKinsey nouns. Look at the Figma rewrite and the Heardify copy as the canonical examples.

Example Jameson-voice tweet (the 1-2x/month amplification):
> It's now late April and Projelli has been live for three weeks. The thing I didn't expect: most buyers find the BYOK setup harder than the rest of the product. So I rewrote the API key tutorial this weekend and added a one-click test button. Honestly, that's the biggest learning I've had since launch.

Both are first-person. The difference is anchoring (date, scene, internal observation) and tone (warmer, more textured).

---

## 3. The brand account playbook

### `@projelli` on X / Twitter

**Bio:** "Local-first AI workspace for indie founders. Your data, your machine, your API key. Sold once → projelli.com"

**Posting cadence:**
- 3-5 posts per week
- 1 thread per week (build-in-public, feature deep-dive, or competitor honest comparison)
- Reply to every mention within 4 hours during waking hours
- Quote-tweet positive buyer mentions with a thank-you (not always, just the resonant ones)

**Content types:**
- Build-in-public revenue numbers (week of launch only, then weekly for first 90 days, then monthly)
- Feature ships ("Just shipped X. Here's what it does.")
- Buyer testimonials with permission
- Honest competitor observations (never trash-talk; framed as "here's how Projelli is different")
- Mini case studies ("How [buyer] uses Projelli for their pitch deck workflow")
- Occasional industry takes (e.g., a new MCP capability) framed through Projelli's local-first lens

**What `@projelli` never posts:**
- Politics, religion, social commentary
- Internal complaints or frustration
- Day-job (Wheel Health) content of any kind
- Personal life of Jameson
- Hot takes on other founders or products by name
- Speculation about the AI industry (we ship code, we don't pundit)

### IndieHackers

The brand presence is `projelli` with the brand voice. Jameson posts the 8-week launch story under his real name (one beat), then the brand voice handles all subsequent updates.

### Reddit

Brand-account participation in r/SideProject, r/macapps, r/Entrepreneur is fine in moderation. Reddit punishes promotion. Rule: never post about Projelli without first having 5+ unrelated, helpful comments in the same subreddit. Track participation in `~/projelli/sign-ups/reddit-participation.csv` so this rule is auditable.

### LinkedIn

The brand has a LinkedIn page but minimal investment. Update once a month with major news. Most LinkedIn marketing for indie tools is unproductive. The Jameson personal account does the heavier lifting on LinkedIn (under the personal brand strategy, not Projelli's strategy).

---

## 4. Jameson's amplification (the 1-2 posts/month)

Jameson posts about Projelli **at most twice per month** on his real-name accounts, and only in specific high-impact moments.

### The four legitimate Projelli moments on Jameson's accounts

1. **Launch week (one post)**: A real-name post on launch day across X and LinkedIn announcing the product. Anchors credibility. Drafted in `JAMESON_ACTION_PACK.md`.
2. **A meaningful revenue milestone**: Hit $1K month, $5K month, 100 buyers. One post. Specific number, honest reflection, no humble-bragging.
3. **A learning post**: Something Projelli taught Jameson that's relevant to the personal brand's pillars (behavioral science, building things). Can mention Projelli once as the source of the learning, but the post is about the learning, not the product.
4. **A new feature that fits the personal brand pillar 5 ("What I'm Learning")**: A post about, e.g., what shipping a desktop app taught about distribution. Projelli is the example, not the subject.

### Pre-flight checklist for any Projelli post on Jameson's account

Before posting, the draft must pass all of these checks:

- [ ] Voice profile compliance (`feedback_jameson_voice_profile.md`): time anchor, verbal tic, varied sentence length, no rule-of-three list ending, no em dashes
- [ ] AI tells audit (`reference_ai_writing_tells.md`): zero forbidden words
- [ ] Marketing copy voice (`feedback_marketing_copy_voice.md`)
- [ ] No em dashes (`feedback_no_em_dashes.md`)
- [ ] Has at least one live link (`feedback_link_heavy_writing.md`)
- [ ] Has a relevant visual (`feedback_post_visuals.md`)
- [ ] LinkedIn manual approval rule (`feedback_linkedin_approval.md`): never auto-post
- [ ] Personal brand rule: this is one of the four legitimate moments above; if not, don't post it
- [ ] Wheel Health adjacency check: nothing in the post relates to Wheel internal work, data, process, or team
- [ ] Frequency check: is this post #1 or #2 of the calendar month? If it's #3, hold for next month

If any check fails, the post is reworked or held.

### Drafting flow

The brand X account drafts → posts.
Jameson's personal account drafts → Jameson reviews → posts (per `feedback_linkedin_approval.md`, all real-name posting is manual).

We never auto-post under Jameson's real name. Every real-name post is reviewed by Jameson, and Claude only drafts.

---

## 5. The press kit binding

The press kit at `projelli.com/press-kit/` already exists with three founder bio lengths. This is the only place Projelli's website surfaces Jameson's real identity. The reasoning:

- Press kits are read by journalists, podcast bookers, and serious buyers. Anonymous indie tools in this audience are slightly suspect.
- Real bio earns trust without needing to put Jameson's face on the homepage.
- Limits exposure: someone has to actively visit `/press-kit/` to see the bio. They don't get it pushed at them.

### What's in the press kit

Per `~/projelli/website/press-kit/index.html`:
- Founder bio (3 lengths: 1-line, 1-paragraph, 1-page)
- Photo (the Jameson bio is fine to include: it's a press kit, this is its job)
- Pre-written quotes (4)
- Brand colors, logos
- 6 product screenshots
- Demo video links

The bio explicitly mentions:
- Senior Product Designer at Wheel Health (this is public, no NDA conflict)
- Eight years in health-tech
- Why he built Projelli (the indie founder lens)

The bio explicitly does not mention:
- Wheel Health's products, customers, internal processes, or anything covered by employment NDA
- Any other employer history beyond high-level career arc
- Personal details (family, address, age beyond "30s")

### What never appears in the press kit

- Wheel Health proprietary information of any kind
- Direct quotes from Wheel Health colleagues or executives
- Implied endorsement by Wheel Health
- Anything that could be interpreted as Wheel Health resources contributing to Projelli (Projelli is built on Jameson's personal time, with personal hardware, with personal AI keys; the press kit makes this explicit if asked)

---

## 6. The Wheel Health firewall

Wheel Health has cleared Projelli per `project_projelli.md` decision #3. The clearance is conditional on Projelli not conflicting with employment terms. We respect that clearance with active discipline.

### Bright lines (never cross)

1. **Never reference Wheel internal work.** Not on the brand account. Not on Jameson's account. Not in podcasts. Not in the press kit. Not in customer support replies.
2. **Never use Wheel time, hardware, or accounts for Projelli.** This is operational, not just optical. Projelli runs on Jameson's personal server, personal accounts, personal hardware.
3. **Never imply Wheel uses Projelli.** Even if a colleague tries it, the brand never references this.
4. **Never trash-talk virtual healthcare or the health-tech category.** Projelli's positioning has nothing to do with health-tech, and we keep it that way.
5. **If Wheel asks Projelli to pause or change something, do it.** The day job is the dream job per `user_current_job.md`. Projelli is the side project.

### Soft lines (use judgment)

- A blog post about "how I shipped Projelli in 8 weeks alongside a full-time job" mentions Wheel by name (already in the launch story draft). This is fine: it's public information and frames the constraint honestly. We do not extend this into Wheel-themed content.
- A podcast appearance might ask "what do you do for your day job?" The honest answer ("Senior Product Designer at Wheel Health, doing virtual healthcare design") is fine. The follow-up "what's it like there?" gets deflected ("I love the work but I keep that part of my career separate from Projelli").

---

## 7. PII and operational privacy boundaries

Beyond Wheel-specific concerns, Projelli's marketing handles personal information with explicit care.

### What we collect

- **Email signups** (homepage form): just email + optional first name. Stored in Brevo + `~/projelli/sign-ups/email-list.csv`
- **Buyer details** (LemonSqueezy): name, email, country, payment method last-4. Stored in LS, never on Projelli infra.
- **Support emails**: whatever buyers write to support@. Stored in Outlook via CF Email Routing.

### What we don't collect

- Telemetry from the desktop app (zero. by design.)
- IP addresses beyond what Plausible's privacy-respecting analytics retains (no individual tracking)
- Any data about how buyers use the product after install

### What we never publish

- Buyer names or emails without explicit written permission per testimonial
- LemonSqueezy refund reasons that include personal context
- Support email contents

This isn't just operational hygiene. It's a marketing asset. "Projelli has zero telemetry and we never see your data" becomes a higher-trust claim when our actual public communications visibly respect that boundary.

---

## 8. The "team" question

Indie founders sometimes pretend their solo product is a team. We don't.

### What the brand voice can say

- "I built Projelli because...": first-person singular, honest
- "We ship updates every two weeks": "we" here meaning "the project" not implying multiple humans, used sparingly
- "Projelli is built by an indie developer": third-person product framing

### What the brand voice never says

- "Our team": there is no team
- "We're hiring": we're not
- "Talk to sales": there is no sales

The honesty here is itself a marketing asset. ICP-fit buyers respect the solo-builder framing.

---

## 9. Operating cadence for personal brand binding

| Cadence | Activity | Owner |
|---|---|---|
| Daily | Brand account replies, mentions monitoring | Brand account (Jameson 5-10 min/day max; can be batched) |
| Weekly | Brand account thread or blog post | Drafted by Claude, reviewed by Jameson, posted by brand |
| Monthly | 1 Jameson real-name Projelli post (counted) | Drafted by Claude, reviewed by Jameson, posted manually |
| Monthly | Personal brand strategy review (is the 5% slot being respected?) | Jameson + Claude monthly review |
| Quarterly | Press kit refresh (new screenshots, updated metrics, new testimonials) | Claude + Jameson 30-min review |
| Annually | Re-evaluate the selective hybrid: is the personal brand strategy still being served? | Jameson + Claude full review |

---

## 10. The kill switch

If Wheel Health ever signals discomfort with Projelli's public presence, the kill switch is:
- All Jameson real-name posts about Projelli pause immediately
- Brand account continues
- Press kit founder bio drops Wheel Health reference (still mentions "Senior Product Designer in healthcare", just not the company name)
- Resume only after Wheel reaffirms clearance

If Jameson's personal brand strategy ever needs to expand Projelli's slot beyond 5% (e.g., Projelli becomes the dominant story of his career), we revise this document, not the brand strategy. The brand strategy survives multiple jobs and decades; specific projects come and go.

---

## 11. References

- `feedback_jameson_voice_profile.md` (memory): the voice rules for any real-name post
- `reference_personal_brand_strategy.md` (memory): the 5-pillar / 95% non-project framework
- `feedback_linkedin_approval.md` (memory): manual approval rule for LinkedIn
- `feedback_marketing_copy_voice.md` (memory): marketing voice rules
- `feedback_no_em_dashes.md`, `feedback_link_heavy_writing.md`, `feedback_post_visuals.md` (memory): drafting checklist items
- `~/projelli/website/press-kit/index.html`: current press kit
- `~/projelli/docs/marketing/channels/BUILD_IN_PUBLIC_TWEETS.md`: pre-staged brand-voice tweets
- `~/projelli/docs/marketing/action-packs/JAMESON_ACTION_PACK.md`: items A and H (real-name posts)
