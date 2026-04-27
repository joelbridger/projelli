# 02: Launch Week as Engine Fuel

_Last reviewed: 2026-04-27_
_Status: Channel playbooks already drafted in `docs/marketing/channels/`. This doc sequences and reframes them._

The hard launch is the single biggest beat of year one but it's not the strategy. The launch's job is to fuel the SEO + AI search engine in `01-seo-engine.md`. Treat the launch as a one-time fuel injection, not as the moment of truth.

This doc does three things:
1. Reframes what a "successful launch" means under the revenue-focused definition of winning
2. Sequences the launch across 5 days for maximum compounding effect
3. Defines the post-launch loop that converts launch attention into permanent assets

The actual channel-level execution (titles, taglines, body copy, FAQ replies) lives in `docs/marketing/channels/`. That work is already done. Don't rewrite it. Reuse.

---

## 1. What "winning the launch" actually means

The temptation is to define launch success as "Product of the Day on Product Hunt" or "front page of Hacker News for 4 hours." Those are vanity metrics. They feel great. They do not, on their own, get us to $10K MRR.

Here's what actually matters from the launch week, ranked by impact on year-one revenue:

| Rank | Outcome | Why it matters | How we measure |
|---|---|---|---|
| 1 | **30-50 paying customers in launch week** | Product validation, first revenue, first testimonials | LemonSqueezy dashboard |
| 2 | **15-25 high-quality backlinks captured** | Direct fuel for SEO engine, lasts forever | Manual log in `~/projelli/sign-ups/launch-backlinks.csv` |
| 3 | **300-800 email signups** | Owned audience for relaunches, sequence #2 emails, beta testers | Brevo + form-handler logs |
| 4 | **5-10 pieces of public testimonial / praise** | Used in vs-pages, homepage, future launches | Manual log + screenshots |
| 5 | **5,000-15,000 unique visitors over 7 days** | Brand-search compounding starts here | Plausible |
| 6 | **PH Product of the Day (top 3)** | Useful but not necessary | PH dashboard |
| 7 | **Show HN front page (top 5)** | Useful but not necessary | HN dashboard |

Outcomes 1-4 are what we actively work for. Outcomes 5-7 are downstream consequences of doing 1-4 well. If we hit 1-4 and miss 5-7, we still won. If we hit 5-7 and miss 1-4, we lost.

This framing has consequences. It means:
- We do not optimize launch posts for upvotes. We optimize for buyer-clicks and credible-discussion.
- We do not stunt for vanity. No fake testimonials, no upvote rings, no Twitter raids.
- We do harvest aggressively. Every comment, mention, and review gets logged the day it appears.

---

## 2. The launch sequence (5 days)

Launch week is not Tuesday at 9am Pacific. It's a 5-day sequenced rollout. Each day's channel feeds the next.

### Day 0: Sunday before (prep day, non-public)

- Final product smoke test on Mac, Windows, Linux installers
- Final website QA (every link, every CTA, every legal page)
- Press kit live and tested at projelli.com/press-kit/
- Email to the existing email list waitlist: "Launching Tuesday, here's what to expect"
- Founder's Pricing tier ($29 lifetime, first 100) live and tested
- Plausible conversion goals confirmed (Download click, GitHub click, Buy click)
- All draft posts pre-staged in `docs/marketing/channels/`
- Hunter confirmed (per `JAMESON_ACTION_PACK.md` item B)
- 6 screenshots committed to press-kit/assets/ (per item D)
- 30-second demo video uploaded and embedded (per item E)
- Personal-brand "I'm shipping tomorrow" tweet drafted (NOT posted; for Tuesday morning)

If any of these are missing on Sunday, we slip the launch. We do not launch with broken things. The reputational cost of a public launch with a 404 link or broken installer is multi-month.

### Day 1: Tuesday (Product Hunt + announcement)

Tuesday is chosen because it's the highest-engagement PH day, second-highest HN day, and gives us 4 working days for follow-through.

- **00:01 PT**: PH listing goes live. Hunter publishes.
- **00:05 PT**: Founder maker comment posted (drafted in `channels/PRODUCT_HUNT_LAUNCH.md`)
- **08:00 PT**: Email blast to existing list ("It's live, here's where to find me today")
- **08:30 PT**: Personal X account post (selective hybrid mode: 1 personal post, real-name)
- **09:00 PT**: `@projelli` brand X account: live thread, 5-7 tweets walking through the product
- **All day**: Reply to every PH comment within 1 hour (brand voice) (`channels/PRODUCT_HUNT_LAUNCH.md` has 12 pre-staged FAQ replies)
- **All day**: Monitor for organic share/mention; reply with appreciation, no over-promotion
- **15:00 PT**: Mid-day update on X / brand account: "Up to X buyers, Y comments, here's what people are loving"
- **20:00 PT**: End-of-day update: numbers + thanks
- **All day**: Capture every backlink, mention, and quote into `launch-backlinks.csv`

**What we do NOT do on Day 1:**
- Show HN (not yet)
- Reddit (not yet)
- IndieHackers (not yet)
- Newsletter outreach (not yet)
- Cold DMs (not yet)

The reason for the staggered rollout is that PH traffic is often lower-quality than HN traffic, but PH gives us social proof. We use Day 1's PH traction as a credibility signal in Day 2's HN post.

### Day 2: Wednesday (Show HN)

- **08:00 PT**: Show HN submission. Title and body from `channels/SHOW_HN_LAUNCH.md`. Title rules are strict: no marketing language, no superlatives, no "I built". Format: "Show HN: Projelli: local-first AI workspace where chats become files (BYOK)".
- **First hour**: Founder reply to first organic comment within 30 minutes. Set the tone honest, technical, willing to acknowledge limitations. The first 5 comments on a Show HN post determine the trajectory of the next 24 hours.
- **All day**: Reply to every HN comment within 2 hours during waking hours
- **All day**: Capture backlinks
- **All day**: Brand X account amplifies HN thread (one share, no spamming)
- **20:00 PT**: Update on PH listing referencing HN feedback (e.g., "HN flagged Y issue, fixing now"). This keeps the PH listing live in feed.

**Critical:** Show HN can flag-spike negative if we come in over-promotional. The pre-staged title and body intentionally read as low-key and technical. Trust the playbook.

### Day 3: Thursday (IndieHackers + Reddit)

- **07:00 PT**: IndieHackers post: "8 weeks to first paying customer: my honest launch numbers" (`channels/INDIE_HACKERS_LAUNCH.md`). IH audience rewards revenue numbers, struggle stories, and specifics. We post the actual launch-day-1 numbers in the post.
- **09:00 PT**: Reddit r/SideProject post (`channels/REDDIT_SIDEPROJECT_POST.md`). Reddit needs a different tone again: visual, casual, screenshot-led.
- **12:00 PT**: Reddit r/Entrepreneur post (different angle, different draft: IH-style)
- **All day**: Reply to every comment within 2 hours
- **All day**: Capture backlinks

**Why Thursday for IH and Reddit:** These platforms reward "I just launched on PH" framing within the first 48 hours of the original launch. Day 3 is the sweet spot: PH momentum is still measurable, HN feedback is fresh, the story has texture.

### Day 4: Friday (Newsletter outreach)

- **08:00 PT**: Cold pitches to 15+ newsletters (`channels/NEWSLETTER_OUTREACH.md`). One pitch per newsletter, personalized, references their recent issue. Track in `~/projelli/sign-ups/newsletter-outreach.csv`.
- **All day**: Continue replying to PH/HN/IH/Reddit threads (engagement decays Friday but does not die)
- **All day**: Submit to directories (`channels/DIRECTORY_SUBMISSIONS.md`): AlternativeTo, SaaSHub, There's An AI For That, ToolFinder, Console.dev tools list. ~30 min per directory, 8-12 directories total.

**Why Friday for newsletters:** Most indie newsletters publish Tuesday, Wednesday, or Sunday. Pitching Friday gets us into the Sunday and Tuesday batches.

### Day 5: Weekend (harvest + breathe)

The launch week is over. We do not push more.

- **Saturday**: Compile the launch week numbers. Update `~/projelli/sign-ups/launch-week-summary.md` with:
  - Total revenue
  - Total signups
  - Top 5 backlinks (by domain authority)
  - 3-5 representative testimonials/quotes
  - 2-3 things that surprised us
  - 2-3 things that didn't work
- **Sunday**: Final round of replies on dormant threads (PH, HN, IH). Each reply mentions the launch week number ("we hit X buyers in 5 days, thanks") which keeps thread fresh and is good citation bait.

**Do NOT** announce a re-launch, a feature drop, or a new beat the same week. The product is launched. Let it breathe.

---

## 3. The post-launch loop (week 2 through month 6)

The launch is fuel. The loop is what makes the fuel matter.

### Week 2: Convert attention into assets

- Email blast to all new signups (~300-800 expected) using the welcome sequence from `playbook/EMAIL_SEQUENCES.md`
- Pull 5-10 best testimonials/quotes from launch threads. Get permission via DM where ambiguous. Add to homepage, press kit, and the email sequence.
- Identify the 10 highest-quality backlinks. Send a thank-you email or DM to each linker. Often this leads to a follow-up post or reference, which is more compounding link equity.
- Begin SEO content from `01-seo-engine.md` (the foundation push starts week 1 post-launch)

### Week 3-4: Convert signups into buyers

- Email sequence emails 2-5 (already drafted) to nudge free signups toward Pro/Lifetime
- Founder's Lifetime ($29) tier closes when 100 buyers reached. Announce closure publicly when it does (creates urgency for late stragglers and is itself a small spike)
- First v1.x post-launch update ("here's what I shipped in week 3 based on launch feedback") posted to brand X + IndieHackers

### Month 2: Bridge to the SEO engine

- Continue SEO content (week 5-8 from `01-seo-engine.md`)
- Monthly retrospective: what's converting? what's not?
- First case study from a launch buyer (testimonial + workflow walkthrough)

### Month 3: Second beat (only if the SEO engine is on track)

- Mini-relaunch on a feature: "Projelli now has X (added because launch buyers asked for it)". Goes to PH listing as an update, brand X thread, IH update. NOT a new PH listing.
- AlternativeTo / SaaSHub re-engagement: respond to reviews, update listings with new features
- Begin newsletter sponsorship outreach for month 4-5 placement (paid, gated on M3 revenue per the milestone framework)

### Month 4-6: The compounding period

- SEO engine starts producing measurable inbound traffic
- First paid newsletter sponsorship lands (see `03-partnership-spikes.md`)
- Continue monthly content cadence (1 new page + 1-2 refreshes)
- Begin to track which channels are producing actual buyers (not signups, buyers)

---

## 4. The launch fuel reuses we explicitly want

When the launch produces a backlink or a quote, our job is to make sure that backlink keeps paying off. This is the harvest mindset.

### High-value reuses

| Asset | Where we reuse it |
|---|---|
| Top-3 PH testimonials | Homepage social proof, press kit, vs-pages |
| Top-3 HN comments | The "what people are saying" section of the press kit; carefully, attributed, with permission |
| Newsletter mentions | Press kit "as seen in" logos; vs-pages "trusted by readers of" sections |
| AlternativeTo positive reviews | Linked from the AlternativeTo vs-pages we run |
| Twitter screenshots of buyer reactions | Email sequence #4 ("here's what 73 founders said in week 1"); brand X gallery |

Each of these reuses extends the half-life of launch fuel from 7 days to 12+ months.

### Reuses we explicitly avoid

- Fabricated quotes (obvious, but worth saying once)
- Quotes pulled out of context that change meaning
- Anonymous testimonials (always attributed to a real person with permission)
- Re-running the same launch announcement copy on different platforms (Reddit detects this; it gets flagged)
- Quoting AI-assistant output as if it were a human review (some founders do this; it's transparent and damaging)

---

## 5. Risk register for launch week

| Risk | Probability | Mitigation |
|---|---|---|
| Installer breaks on a fresh machine | Medium | Day 0 smoke test on all three OSes from a fresh VM |
| Tauri auto-updater fails on first update | Medium | Don't ship a v1.x update during launch week; first update lands week 3+ |
| HN post gets flagged as promotional | Medium | Title and body are pre-cleared per the playbook; do not deviate |
| PH spam reports / vote manipulation accusations | Low | Do not buy upvotes, do not coordinate (PH detects this) |
| Negative HN / Reddit thread snowballs | Medium | Engage early, honest, transparent; never argue or delete |
| Server-side outage (form-handler, license-validator down) | Low | UptimeRobot already wired (monitor 797); 5-min check; pager via push |
| Personal X account inadvertently breaks confidentiality | Low | Selective hybrid keeps real-name account at low project mention; pre-cleared posts only |
| Launch buyer requests refund within 24 hours | Inevitable | Refund cheerfully via LS no-questions; capture reason in `~/projelli/sign-ups/refunds.csv` |
| Cease-and-desist from a competitor | Very low | Trademark search cleared (USPTO + Google); USPTO filing in M3 window |
| Apple notarization breaks Mac install | Already known | Already documented; right-click-Open instructions in `getting-started.html` |

The single biggest risk is launching with a broken installer. Day 0 smoke tests are non-negotiable.

---

## 6. The decision framework: when to pull the trigger

The launch happens when ALL of the following are true:

- v1.6 (or current shipping version) installers verified working on fresh Mac, Windows, Linux machines
- Apple Developer signing live (✅ as of 2026-04-09 per memory)
- Azure Trusted Signing live (✅ as of 2026-04-09 per memory)
- LemonSqueezy live with all 3 products purchasable (✅ as of 2026-04-09)
- License validator service uptime monitor green for 14 consecutive days
- Demo video produced and embedded (Jameson action item E)
- 6 product screenshots committed (Jameson action item D)
- PH hunter confirmed (Jameson action item B)
- 10-20 beta testers have used the product for 2+ weeks and reported back (Jameson action item C)

If any of these are not true, the launch slips. We do not launch in a "almost ready" state. The asymmetric cost of launching broken is too high.

The realistic launch window given current state: **late May or early June 2026**, depending on Jameson action items B-E.

---

## 7. References

- `~/projelli/docs/marketing/channels/PRODUCT_HUNT_LAUNCH.md`: full PH playbook
- `~/projelli/docs/marketing/channels/SHOW_HN_LAUNCH.md`: Show HN playbook
- `~/projelli/docs/marketing/channels/INDIE_HACKERS_LAUNCH.md`: IH playbook
- `~/projelli/docs/marketing/channels/REDDIT_SIDEPROJECT_POST.md`: Reddit playbook
- `~/projelli/docs/marketing/channels/NEWSLETTER_OUTREACH.md`: newsletter pitches
- `~/projelli/docs/marketing/channels/DIRECTORY_SUBMISSIONS.md`: directory list
- `~/projelli/docs/marketing/channels/PH_HUNTERS.md`: hunter shortlist
- `~/projelli/docs/marketing/playbook/REPLY_BANK.md`: pre-staged comment replies
- `~/projelli/docs/marketing/playbook/EMAIL_SEQUENCES.md`: 10 lifecycle emails
- `~/projelli/docs/marketing/action-packs/JAMESON_ACTION_PACK.md`: Jameson-only items
- `01-seo-engine.md`: what the launch is fueling
- `04-retention-and-wom.md`: what to do with launch buyers post-launch
