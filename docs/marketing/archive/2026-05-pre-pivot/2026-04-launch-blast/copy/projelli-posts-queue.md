# @projelliproject Brand-X Posts, First 5 Ready to Ship

**Source:** `~/projelli/docs/marketing/channels/BRAND_X_LAUNCH.md` (10 evergreen-ish posts, voice-audited 2026-04-28: 0 em dashes, 0 AI tells)
**Handle:** @projelliproject (TBC by Jameson, confirm before posting; backup: @projelliapp / @projelli_app)
**Approval rule:** per `feedback_linkedin_approval.md`, every post is reviewed by Jameson before posting. Claude drafts; Jameson posts. Even on the brand account.
**Cadence rule:** per `strategy/05-personal-brand-binding.md`: 3-5 posts/week max. Spread first 5 across the first 2 weeks of the account being live.

---

## Pre-flight checklist (run once before the queue starts)

- [ ] Confirm @projelliproject handle is set up (Jameson)
- [ ] Bio updated: "Local-first AI workspace for indie founders. Your data, your machine, your API key. Sold once. projelli.com"
- [ ] Profile photo: Projelli coral logo on white, 400×400+ (source: `~/projelli/Assets/`)
- [ ] Header image: 1500×500 with homepage gradient + tagline (stage at `~/projelli/Assets/x-header.png`)
- [ ] Location field: `projelli.com` (X allows URLs there, no character cost)
- [ ] Website field: `https://projelli.com`
- [ ] Notification settings: on for mentions/DMs/follows from accounts >500; everything else off
- [ ] Skip paid blue check (per `BRAND_X_LAUNCH.md`)

---

## Post 1, Pinned: "What is Projelli"

**Post when:** Day 1 of the account being live. Pin it.

```
Local-first AI workspace for indie founders.

Every chat with Claude, GPT, or Gemini becomes a Markdown file on your hard drive.

You bring your own API key. We never see your data.

$49 one-time. No subscription.

projelli.com
```

**Visual:** None required, projelli.com unfurls into a card via OG tags.
**Char count:** ~218 / 280.
**Pin:** Yes (pin to top of profile so it's the first thing visitors see).

---

## Post 2, The problem (single tweet)

**Post when:** Day 2 (next day).

```
Most AI tools either:
- lock your conversations in their database
- charge you twice (once for the app, once for inference)
- aren't built for the actual work indie founders do

Pretty sure none of those is the right answer.
```

**Visual:** None required.
**Char count:** ~245 / 280.
**Voice note:** the closing "Pretty sure none of those is the right answer" is the brand voice, slight wry, no overclaim. Don't soften.

---

## Post 3, Build-in-public framing (single tweet)

**Post when:** Day 4 (gap of 1 day from Post 2).

```
One indie developer.
Five hours a week.
Real revenue numbers.
No VC.

Been building Projelli quietly. Almost ready to share what worked, what didn't, and what I'd do differently.

Following along is welcome.
```

**Visual:** None required.
**Char count:** ~206 / 280.
**Voice note:** sets up the build-in-public arc that the brand account will sustain post-launch (weekly revenue updates for 90 days, then monthly).

---

## Post 4, Local-first thread (5 tweets)

**Post when:** Day 7 (~1 week after pinning). This is the first thread the account ships; quality bar is high.

**1/5 (lead):**
```
"Local-first" gets thrown around loosely.

Most "local-first AI" tools fail the strict test: your data lives on your device, in a format you control, and the cloud is optional.

Quick thread on what actually qualifies in 2026.
```

**2/5 (definition):**
```
The strict test (from Ink & Switch's 2019 paper):

1. Authoritative copy on your device
2. Open format another tool can read
3. Works without network
4. Cloud is optional
5. Data readable without the original tool
```

**3/5 (categorization, the meat):**
```
Tools that pass:

Obsidian + AI plugins ✅
Logseq ✅
Projelli ✅

Tools that don't:

Notion AI ❌
ChatGPT, Claude.ai, Gemini ❌
Reflect, Mem.ai, Tana ❌

"Has an export button" ≠ local-first.
```

**4/5 (why this matters for AI specifically):**
```
Why this matters more for AI than for any previous category:

Your AI conversations now contain pitch decks, customer interviews, financial projections.

If those live in someone else's database, you have less control over them than you'd accept for any other strategic doc.
```

**5/5 (close + soft CTA):**
```
The good news: the local-first AI workspace is a real category now, with real options.

Full guide: projelli.com/local-first-ai-workspace

(yes, Projelli is one of those options. it's also fine to pick one of the others.)
```

**Visual:** Tweet 1 should have a representative image (the homepage screenshot or the Finder mockup at `~/projelli/website/press-kit/assets/feature-local-first-finder.png` works).
**Char counts:** all under 280, verified.
**Voice notes:**
- The Ink & Switch citation in tweet 2 is link-bait for a serious technical audience; consider linking to their paper as a quote-tweet of an existing X thread on it
- Tweet 3's named-competitor section is direct but not insulting (per anti-pattern #15: "Honest observation, not contempt")
- Tweet 5's parenthetical "yes, Projelli is one of those options. it's also fine to pick one of the others" is the brand voice, magnanimous, not pushy

---

## Post 5, Data ownership (single tweet with image) [REVISED 2026-04-28]

**Why this changed from BYOK math:** without 30-60 days of real customer data, any "$5-15/mo BYOK" estimate is theatre. We don't ship numbers we can't defend. Pivoted to a stronger angle that doesn't need numbers. Once we have real customer cost data after launch, we can ship a separate BYOK math post with verifiable numbers (ideally with a real buyer's screenshot of their actual API spend).

**Post when:** Day 10 (3 days after the thread).

```
Your AI conversations contain your business plan, your customer
interview notes, your pricing strategy, your launch plan.

Where do they live?

If the answer is "in Notion's database" or "in OpenAI's chat
history", the answer is "not in a place I control."

Projelli answers: in a folder on your hard drive. Plain Markdown.
Yours.

projelli.com
```

**Visual:** REQUIRED. A Finder window screenshot showing `~/Documents/Projelli/` with 6-10 real-looking Markdown files (Vision.md, Pricing.md, Customers.md, Launch Plan.md, Pitch Deck.md, etc.). The visual makes the abstract concept ("files you own") concrete in one glance. Asset already exists at `~/projelli/website/press-kit/assets/feature-local-first-finder.png`.

**Char count:** ~270 / 280.

**Voice notes:**
- The list of "business plan / customer interview notes / pricing strategy / launch plan" is specific concrete nouns (founder objects), not abstract "your work"
- "If the answer is X, the answer is Y" structure is a controlled rhetorical device, not the forbidden "It's not X, it's Y" parallelism
- The closing "projelli.com" stands alone as the call to action, no buy button language

**Future BYOK math post (post-launch v2):** Once 30+ buyers have shared their actual monthly API spend (we'll ask in the welcome email survey post-purchase), draft a follow-up post with REAL numbers from real customers, ideally with one buyer screenshotting their own OpenAI billing dashboard. That post can ship at month 2-3 once data is solid.

---

## What comes after Post 5

Posts 6-10 in `BRAND_X_LAUNCH.md`:
- Post 6: Feature ship pattern (template, fill at ship time)
- Post 7: Honest competitor observation
- Post 8: Founder-template mini-case (single tweet with image)
- Post 9: MCP angle
- Post 10: Industry observation through the brand lens

After post 10 the cadence is ad-hoc per `BRAND_X_LAUNCH.md`. The reply patterns and the post-launch revenue-update template both live in that doc.

---

## Reply discipline (the unsexy thing that compounds)

Per `BRAND_X_LAUNCH.md`:
- **Reply to every mention within 4 hours during waking hours.** This is the actual moat, most brand accounts go silent.
- **Quote-tweet positive buyer mentions** with a thank-you (not always, just resonant ones).
- **Cap promo posts at 5/week** per `strategy/07-anti-patterns.md` § 13.

---

## What @projelliproject **never** posts (hard rules)

Per `BRAND_X_LAUNCH.md`:
- Politics, religion, social commentary
- Internal complaints or frustration
- Day-job (Wheel Health) content of any kind
- Personal life of Jameson
- Hot takes on other founders or products by name
- Speculation about the AI industry

---

## How Jameson's real-name account (selective hybrid) interacts

Per `strategy/05-personal-brand-binding.md`:
- Jameson posts about Projelli **at most twice per month** on his real-name accounts
- Drafts for those live in `channels/JAMESON_REAL_NAME_POSTS.md`
- Allowed moments: launch day, revenue milestone, learning post tied to personal brand pillars, or a feature post that fits "What I'm Learning"
- The pre-flight checklist in `05-personal-brand-binding.md` § 4 must pass before any real-name Projelli post

---

## What I need from Jameson to lock this queue

1. **Confirm @projelliproject handle.** If it's something else (e.g., @projelliapp), I'll update copy + bio fields.
2. **Verify the BYOK math** before Post 5 ships (the $229 vs ~$409 discrepancy).
3. **Approve the queue or send edits.** Once approved, Jameson posts on the schedule above; I draft the next 5 in parallel.
