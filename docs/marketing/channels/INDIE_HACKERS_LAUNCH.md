# IndieHackers Launch Post — Projelli

> **Status:** Draft — ready for Jameson to review and post on launch day evening (after PH and Show HN have been live).
> **Submit time:** ~8 pm PT on launch day (peak IH evening traffic, when readers are checking the day's launches).
> **Account:** Jameson should post from his personal account. If he doesn't have one yet, create it 1-2 weeks before launch and post a single warm-up reply on someone else's thread to avoid the 0-karma flag.

---

## Why IndieHackers needs its own post (not a copy of HN/PH)

IndieHackers is a community for indie founders, by indie founders. The audience is:
- Solo or 2-3 person teams shipping small SaaS / desktop / micro-SaaS / info-products
- Specifically interested in revenue, traction, and "what worked"
- Allergic to growth-hacker hype, suspicious of VC-funded launches
- Hungry for real numbers — MRR, churn, conversion, hours per week
- Generous with feedback, brutal about authenticity gaps

The post that wins IH is **a transparent narrative with real numbers and a vulnerable angle**. Not a product announcement. A story about the build with the product as the artifact.

---

## Title

IH titles should be ~80 characters, narrative format, with a number if possible.

### Recommended

**`I shipped my paid SaaS product after 18 months of building — here's the launch numbers from day one`**

- Hits "shipped" (action word, builders care)
- Hits "18 months" (real timeline, signals depth)
- Hits "launch numbers" (the thing IH readers click for)
- Hits "day one" (urgency, recency)

### Alternates

1. `I left my dream design job in my evenings to build a local-first AI workspace — launching today`
2. `8 weeks from "an app exists" to "people pay money for it" — what worked, what didn't`
3. `Building Projelli on 5-10 hours a week with a full-time job: launch day numbers`
4. `My local-first AI workspace just hit Product Hunt — sharing the unfiltered metrics`

The recommended title leans on the duration (18 months) because IH respects long, patient builds more than 8-week sprints. The "5-10 hours a week" framing is also IH catnip.

---

## Category / tag

**Launch** (primary)
**Building** (secondary if multi-tag is allowed)

Don't post under "Marketing" or "Growth" — those are saturated and the audience is different.

---

## Body draft

> Hey IH,
>
> I'm Jameson. I'm a Senior Product Designer at a telehealth company. On weekends and evenings for the last 18 months I've been building a thing called Projelli, and I just launched it today on Product Hunt and Hacker News.
>
> This is the post where I tell you what it is, what the numbers look like, and what I learned. No fluff.
>
> ## What it is
>
> Projelli is a local-first AI workspace for indie founders. It's a desktop app where every chat with Claude / GPT / Gemini produces a real Markdown file in a folder on your hard drive. Not a proprietary database. Not someone else's cloud. Plain `.md` files in a folder you choose, with 15 founder workflow templates baked in (Pricing Strategy, Pitch Deck, GTM Plan, Customer Persona, MVP Scope, the rest).
>
> The differentiator vs Notion AI / Obsidian / ChatGPT: it's a desktop app, the files are yours, AI is the primary input method instead of a feature bolted on top, and the templates are designed for the documents indie founders actually write (not generic note-taking).
>
> Pricing is one-time, not subscription: $49 Pro, $99 Lifetime, $29 lifetime for the first 100 launch buyers. Sold via LemonSqueezy as merchant of record.
>
> ## The 18-month story (compressed)
>
> Month 1-12: built the product at maybe 5-8 hours a week. Started as a side experiment to see if I could turn ChatGPT conversations into a useful editor. Almost shelved it twice. Kept going because every time I used it I missed it when I went back to ChatGPT alone.
>
> Month 13-15: realized the product was substantially built (~25k lines of TypeScript across 64 components, full Tauri stack, three AI providers, audit log, version history, undo/redo, 12 founder templates) but ~5% commercialized. No payment, no license keys, no legal docs, no code signing, no support email, the GitHub repo on the wrong account, the website advertising templates that didn't exist.
>
> Month 16: had a hard conversation with Claude (the AI, not me — I have it set up as my de facto business operator for this project) and we built an 8-week launch plan. Audience: indie founders only, drop the hobby positioning. Pricing: one-time $49 / $99 / $29 launch tier. Channel: PH + HN + IH + Reddit + 6 newsletters. Tech: Tauri + GitHub Actions + Azure Trusted Signing + Apple Developer ID + LemonSqueezy.
>
> Month 17-18: executed the 8-week plan. Shipped it tonight.
>
> ## The launch day numbers (so far)
>
> *(These will be filled in after launch — leaving placeholders so I can come back and update.)*
>
> | Metric | Result |
> |---|---|
> | Product Hunt rank | __ |
> | Product Hunt upvotes | __ |
> | Show HN points | __ |
> | Show HN comments | __ |
> | Total website visitors (24 hr) | __ |
> | Email signups (24 hr) | __ |
> | Free downloads | __ |
> | Paying customers | __ |
> | Founder's Launch tier sales (the $29 tier) | __ |
> | Total revenue | __ |
>
> I'll update this thread tomorrow with the final 24-hour numbers. (And again next week with the 7-day numbers, because launch day is the smallest part of the story.)
>
> ## What worked
>
> 1. **The competitive matrix.** I wrote a side-by-side of Projelli vs Notion AI / Obsidian / ChatGPT / Reflect / Tana before launch day. I used it as comment ammunition on PH and HN — every time someone asked "how is this different from X" I had a paragraph ready. Saved hours of typing under pressure and the answers came out coherent instead of frantic.
> 2. **Honesty about what's not done.** Mac and Linux aren't fully there yet — Windows is the rock-solid platform, Mac just got cross-platform CI working. I led with that on every channel instead of hiding it. PH and HN both rewarded the honesty more than I expected.
> 3. **The Founder's Launch tier ($29 first 100).** Created urgency without feeling slimy because the price is real and the cap is real. Buyers got the lifetime tier at a discount AND the bragging rights of being early. About __% of day-one buyers picked this tier.
> 4. **Doing PH and HN on the same day.** The audiences are smaller-overlap than I thought, so they didn't cannibalize each other. Show HN drove __ visitors who weren't on PH, and vice versa.
> 5. **Pre-staging every reply.** I had 12 anticipated comments + reply templates ready before submitting. I still wrote new replies to comments I didn't anticipate, but the foundation meant I never froze up.
>
> ## What didn't work
>
> 1. **Email list growth was anemic.** I started capturing emails on the homepage about 4 weeks before launch. Got __ subscribers. Should have been 10x that. The lesson: building the email list is a 3-month effort, not a 4-week effort. Soft-launching to a small list is still better than a bigger cold launch — but not by much.
> 2. **The first PH comment about "isn't this just X" stung me harder than it should have.** I had to walk away from the thread for 5 minutes to not get defensive. Good reminder that no amount of preparation makes this fully painless.
> 3. **My X presence was nonexistent before launch day.** I'd been holding off on "build in public" because it felt cringy. The result: my launch day tweet got __ impressions and __ likes. Lesson: would have done way better if I'd been tweeting weekly for the 8 weeks of the launch ramp-up.
> 4. **The Pro / Lifetime split was about __/__** instead of the 60/40 I projected. Need to think about whether the tiering is actually doing what I want or if I should collapse Pro into a single "Founder Tier" and just have one paid SKU.
> 5. **I spent more on code signing than expected.** Apple Developer ($99) plus Azure Trusted Signing (~$120/yr) plus a small OV cert backup plan I ended up not using = ~$240/yr total. Worth it because SmartScreen + Gatekeeper warnings would have killed conversion, but it eats into year-1 margin if revenue is slow.
>
> ## What I'd tell anyone planning their own indie launch
>
> 1. **Start the email list 6 months before launch, not 4 weeks before.** This is the single biggest leverage point I missed.
> 2. **Pre-stage every reply you can imagine.** Comment threads are won by speed, and speed comes from preparation, not improvisation.
> 3. **Don't launch alone.** Have 5-10 people who know it's happening and will be in the comments asking real questions in the first hour.
> 4. **Be honest about what's not done.** It's the cheapest trust signal you have.
> 5. **Have a competitive analysis written down.** Not for your homepage — for your replies.
> 6. **Don't refresh the dashboards every 30 seconds.** Set a timer.
>
> ## What's next
>
> Week 2 (post-launch): the IndieHackers narrative post (this one), Reddit launches, and direct outreach to 6-10 newsletters that cover indie tools. Write the first 3 blog posts for the SEO compounding play.
>
> Week 3: dig into the conversion data, A/B the homepage hero, follow up with launch buyers for testimonials, plan v1.1 from real user requests instead of my own roadmap assumptions.
>
> Month 2: ship Linux. File the trademark. Maybe set up an affiliate program through LemonSqueezy.
>
> Month 3-12: the actual business — content engine, organic SEO, occasional second-launch moments around major versions.
>
> ## Asks
>
> Two things I'd love:
>
> 1. **Honest feedback from anyone who's shipped a paid local-first or BYOK product.** Specifically: did your one-time pricing model hold up over 12 months, or did you have to add a subscription? If you've been at this longer than I have, your answer probably saves me a year of mistakes.
> 2. **Roast the homepage at projelli.com.** Tell me where the messaging breaks. Tell me what you'd cut. The harder the better.
>
> Thanks for reading. If you're an indie hacker building anything in this category, my DMs are open and I'd love to compare notes. And if Projelli looks useful — there's a free tier, a 14-day refund, and the Founder's Launch $29 lifetime is live until I sell 100 of them.
>
> Jameson
> projelli.com

---

## When to post

**Submit at 7-9 pm PT on launch day** (10 pm-midnight ET). IH gets the most evening traffic from European indie hackers in the morning + US indie hackers winding down. The post will be near the top of "new" for several hours and pick up upvotes overnight.

Don't post in the morning — IH morning traffic is dominated by people scanning yesterday's threads for replies, not new posts.

---

## After-the-post follow-ups

| When | Action |
|---|---|
| **Day 1, 24-hour mark** | Reply to the original post with updated numbers in the table. IH rewards transparency updates. |
| **Day 7** | Post a NEW thread: "1 week in — here's what changed" with the 7-day numbers. Different post, links back to this one. |
| **Day 30** | "30 days post-launch — what I learned" with monthly numbers. This becomes the canonical IH post about the launch and gets shared in retrospectives later. |
| **Day 90** | Honest "first quarter" review — what's working, what's not, what I'd cut. |

The IndieHackers narrative is not a one-shot. It's a 4-post arc. The first post is the launch announcement; the next three build the relationship with the community.

---

## DMs to expect (and how to handle them)

After this post, expect 10-30 DMs from other indie hackers in the first week. They will fall into 3 buckets:

### Bucket 1: Other indie founders building similar things

**Reply with:** "Yes, would love to compare notes. What's your stack? What channel has been working for you?" This builds the network for the long game.

### Bucket 2: People asking for free Lifetime in exchange for "review"

**Reply with:** "I've already given out Lifetime to the beta tester group, and I'm holding the rest of the launch tier for actual buyers. If you want to try it, the free tier is real and you can decide from there." Politely firm. Don't give away inventory to strangers.

### Bucket 3: "Have you considered [feature]?" requests

**Reply with:** "Thanks — that's actually on my list / not on my list because [reason]. Mind if I add you to a list of people who'd want to be notified if I build it?" This builds a future-customer email list AND validates whether the request is real or one-off.

---

## Voice notes for Jameson editing this

- Cut anything that sounds like a marketing person wrote it
- Replace any abstract claim with a specific number or anecdote
- Don't soften the "what didn't work" section — that's the part IH readers actually read
- The "Asks" section at the end is the engagement hook. Keep both asks specific.
- Don't add a roadmap. IH gets bored by roadmap promises.
- The tone should sound like you're typing this on your couch at 11 pm with a beer, not like you're publishing a polished post-mortem. Slightly tired and slightly proud is the right voice.

---

*This post will likely get 3-8 hours of front-page IH visibility and result in ~30-100 new email signups + ~5-15 day-1 paying customers. The lasting value is the bookmark/share traffic over the following 30-90 days as it gets surfaced in "best launches of [month]" roundups.*
