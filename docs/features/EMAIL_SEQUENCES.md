# Email Sequences — Projelli

> **Status:** Draft. Ready to copy into Brevo as templates once Jameson reviews.
> **Voice:** First-person singular, contractions, no AI tells, founder-direct.
> **Sender:** `Jameson @ Projelli <noreply@projelli.com>` for transactional, `Jameson Daines <support@projelli.com>` for narrative.

---

## Sequence map

```
SIGNUP (homepage email form)
   │
   ├─ T+0  : Welcome email           → email-01-welcome.txt
   ├─ T+3d : Pre-launch teaser       → email-02-teaser.txt
   ├─ T+7d : Launch day announcement → email-03-launch.txt
   └─ T+10d: One-week follow-up      → email-04-week-one.txt

PURCHASE (LemonSqueezy webhook)
   │
   ├─ T+0  : License key + activation → email-05-purchase.txt
   ├─ T+1d : First-day check-in       → email-06-day-one.txt
   ├─ T+7d : One-week feedback ask    → email-07-feedback.txt
   └─ T+30d: One-month retention      → email-08-month-one.txt

REFUND REQUEST (manual or LemonSqueezy webhook)
   └─ T+0  : Refund confirmation + exit interview → email-09-refund.txt

DORMANT (no app activity for 30+ days)
   └─ T+30d: Re-engagement            → email-10-reengagement.txt
```

All emails are plain text. No HTML templates. No images. No tracking pixels. The tone of every one of these is "founder typing on his couch at 11 pm" — not "marketing team running a sequence."

---

## Email 01 — Welcome (sent T+0 after homepage signup)

**From:** Jameson Daines <support@projelli.com>
**Subject options (A/B test):**
- A) `Hi from Jameson — you're on the list`
- B) `Welcome to Projelli (and a quick honest update)`
- C) `You signed up for Projelli — here's what happens next`

**Body:**

```
Hi,

Thanks for signing up for Projelli updates. I'm Jameson, the
person who built it — not a "Projelli team," just me on
weekends and evenings around a full-time job at a health-tech
company.

A few honest things up front:

1. I will email you when there's something real to say. Not
   every week. Maybe once every 2-3 weeks. When I have a
   release, a launch update, or something I think you'd actually
   want to read about.

2. You can unsubscribe at any time with the link at the bottom.
   Nothing in this list is permanent.

3. If you want a peek before launch, you can already download
   the v1.0.0 Windows build at:
   https://github.com/projelli/projelli/releases/latest

   It's free, it's the real product, the only catch is the
   SmartScreen "unknown publisher" warning that the launch will
   fix with a code-signed build.

4. If you want to know what Projelli IS exactly:
   https://projelli.com

5. If you want to talk to me about it directly, just reply to
   this email. It comes to me, not a help desk.

The launch is coming up in the next few weeks. The first 100
buyers get the Lifetime tier for $29 instead of $99 — that's the
"Founder's Launch" tier. Being on this list means you'll know
the moment it goes live, before I post anywhere else.

Talk soon,
Jameson

--
Projelli — local-first AI workspace for indie founders
projelli.com · github.com/projelli/projelli

You're getting this because you signed up at projelli.com.
Unsubscribe: {{unsubscribe_url}}
```

---

## Email 02 — Pre-launch teaser (sent T+3 days after signup, OR T-3 days before launch — whichever is later)

**From:** Jameson Daines <support@projelli.com>
**Subject:** `T-3: launching Projelli on Tuesday`

**Body:**

```
Quick one.

Projelli launches publicly on Tuesday morning (US Pacific time).
Product Hunt + Show HN simultaneously.

Three things you should know:

1. **Founder's Launch tier is $29 lifetime, capped at 100 buyers.**
   Once 100 sell, the price goes to $99 forever. If you've been
   waiting for a reason to buy, this is the window.

2. **The full feature set unlocks at the Pro tier ($49 one-time)**
   if you don't want the lifetime updates. Both work.

3. **The free tier is real.** If you just want to try it without
   paying, the free download will still work after launch — no
   trial countdown, no upgrade nag.

What I'd actually love from you on launch day:

- If Projelli looks useful, an upvote on Product Hunt is helpful
  but please don't feel obligated.
- If you have feedback (good, bad, or "this isn't for me"), reply
  to this email and tell me. Honest feedback from people who
  signed up early is the most useful thing I get.
- If you know any other indie founders who'd want this, forward
  this email. That helps more than any marketing channel.

I'll send one more email on Tuesday morning when it's live.
After that, I'll go quiet for a couple of weeks unless something
big happens.

Thanks for being on the list before there was anything to be
on the list for.

Jameson

--
projelli.com
Unsubscribe: {{unsubscribe_url}}
```

---

## Email 03 — Launch day (sent at 7 am PT on launch day)

**From:** Jameson Daines <support@projelli.com>
**Subject:** `It's live: Projelli is launching today (and the Founder's Launch is $29)`

**Body:**

```
Projelli is live.

After 18 months of building and 8 weeks of commercial polish,
the product is shipping today. Product Hunt and Show HN go up
in the next few hours.

Here's what you need to know:

→ **Live now:** https://projelli.com
→ **Free download:** the full app, no card required
→ **Founder's Launch tier:** $29 lifetime, first 100 buyers only
   https://projelli.com/#pricing

The Founder's Launch tier is the same as the regular Lifetime
tier ($99) — same features, same updates forever, same commercial
license — just $70 cheaper because you're betting on this thing
when it has zero reviews.

If you decide to buy at the Founder's Launch tier, you get:
- All 3 AI providers (Claude, OpenAI, Gemini)
- All 15 founder workflow templates
- Unlimited workspaces
- Multi-model comparison
- Whiteboard, audio, research citations
- Lifetime updates
- Commercial use license
- Priority support (which is just me, but I'll prioritize you)

Sold via LemonSqueezy. 14-day refund, no questions asked.

If you want to follow the launch:
- Product Hunt: https://www.producthunt.com/posts/projelli
- Show HN: (link will be in tomorrow's follow-up)
- The blog post about the build:
  https://projelli.com/blog/how-i-built-projelli-in-8-weeks

Today is the day I find out whether 18 months of weekend work
matters to anyone other than me. Wish me luck. And if Projelli
helps you ship something, that's the only metric I actually
care about.

Talk soon,
Jameson

--
projelli.com
Unsubscribe: {{unsubscribe_url}}
```

---

## Email 04 — One-week follow-up (sent T+7 days after launch)

**From:** Jameson Daines <support@projelli.com>
**Subject:** `Week 1 post-launch: what happened`

**Body:**

```
A week into the launch.

I promised I wouldn't email you constantly. This is the last
one for a while unless something big happens. I just want to
share where things landed.

The numbers (honest, no spin):

- Product Hunt rank: __ of the day
- Show HN: __ points, __ comments
- Total website visits: __
- Free downloads: __
- Paying customers: __
- Founder's Launch tier sales: __ of 100

If you bought during launch week — thank you. Genuinely. I
took screenshots of every notification.

If you didn't buy and you've been thinking about it: the
Founder's Launch tier is still live (__ of 100 left). After
those 100 sell, the Lifetime tier goes to $99 and the $29 price
disappears. No urgency tricks — that's just the math.

If you tried Projelli and it didn't click for you: I'd really
like to know why. Reply to this email and tell me what was
missing or what felt off. The most useful feedback I'm getting
this week is from people who DIDN'T buy — they tell me what's
broken about the pitch.

What's next:

- Linux build (the most-requested thing this week)
- Local LLM support via Ollama (the second most-requested)
- The first 3 blog posts on local-first AI for founders
- A v1.1 release with bug fixes from launch week

I'll email again when v1.1 ships, or when I have something
that you'd actually want to read about. Until then — thanks
for being here.

Jameson

--
projelli.com
Unsubscribe: {{unsubscribe_url}}
```

---

## Email 05 — Purchase confirmation + license key (sent at T+0 after LemonSqueezy webhook)

**From:** Projelli <noreply@projelli.com>
**Subject:** `Your Projelli license key (and how to use it)`

**Body:**

```
Thank you for buying Projelli.

Your license key is:

    {{license_key}}

To activate:

1. Open Projelli on your computer.
2. Go to Settings → License (top-right gear icon).
3. Paste your license key into the input field.
4. Click "Activate."

That's it. The app will validate the key with my server one
time, then store an activation token locally. After that,
Projelli works fully offline — no further server check-ins.

You can use this license key on up to 3 devices that you
personally own.

What you just bought:

→ Tier: {{tier_name}}
→ Price: ${{amount}}
→ Order ID: {{order_id}}
→ Receipt: {{receipt_url}}

Things you might need:

- Getting Started: https://projelli.com/docs/getting-started
- API Keys Guide:  https://projelli.com/docs/api-keys
- FAQ:             https://projelli.com/docs/faq
- 14-day refund:   reply to this email or use {{lemonsqueezy_portal_url}}

If anything goes wrong with activation, just reply to this
email and I'll fix it. The license validation service runs
on my home server — if it's ever down, the app falls back to
a 7-day offline grace period and you can keep working.

Welcome aboard. Now go build something.

Jameson
projelli.com

--
This is a transactional email about your Projelli purchase.
You'll only receive product-related messages from this address.
For occasional updates and tips, sign up at projelli.com.
```

---

## Email 06 — First-day check-in (sent T+1 day after purchase)

**From:** Jameson Daines <support@projelli.com>
**Subject:** `Day 1 with Projelli — quick question`

**Body:**

```
Hey,

Yesterday you bought Projelli. Thank you.

I'm sending this because the most useful thing I can do as a
solo founder is talk to actual buyers in their first week.
So: how's it going?

Three specific things I'd love a one-line answer to (just hit
reply, no need to write paragraphs):

1. Did you successfully install and activate it? If anything
   went wrong, what was it?

2. Have you run a workflow yet? If yes, which one? If no, what
   stopped you?

3. Is there one thing I could fix or add this week that would
   make Projelli more useful to you tomorrow?

If everything is great and you have nothing to say, just write
"all good" and I'll know to leave you alone. If you've already
hit a bug or have a feature request, this is the fastest way
to reach me — these emails come straight to my inbox.

Either way, glad to have you.

Jameson

--
projelli.com
P.S. The Getting Started doc at projelli.com/docs/getting-started
is the fastest way to your first generated document if you
haven't tried it yet.
```

---

## Email 07 — One-week feedback ask (sent T+7 days after purchase)

**From:** Jameson Daines <support@projelli.com>
**Subject:** `One week in — would you tell me if you're using Projelli?`

**Body:**

```
Hi,

You've had Projelli for a week. I'm not going to ask you to
do anything except answer one question, and only if you feel
like it:

**Are you actually using it?**

That's the question. Yes / no / sort of / not yet — any answer
is useful. Reply to this email with one word and I'll learn
something.

If yes: which workflow have you used most? I'm going to invest
in whichever templates buyers actually use, and I'd rather
hear it from you than guess.

If no: what's blocking you? Is it a bug, a missing feature, a
documentation gap, or did the friction of getting set up
outweigh the value? No wrong answer.

If sort of: I get it. Software fits into people's lives at
their own pace. No nag.

I'm asking because the second-month retention number is the
single biggest thing I need to figure out, and the only way
to figure it out is to ask. Whatever you write back goes into
my product notes — anonymized — to shape the next version.

Thanks for helping me build this.

Jameson

--
projelli.com
P.S. If you'd rather not be on this email list at all, the
unsubscribe link is at the bottom. No hard feelings.

Unsubscribe: {{unsubscribe_url}}
```

---

## Email 08 — One-month retention (sent T+30 days after purchase)

**From:** Jameson Daines <support@projelli.com>
**Subject:** `Month 1 with Projelli — and a small ask`

**Body:**

```
Hi,

You've had Projelli for a month. I want to do two things in
this email:

**1. Thank you, properly.**

You bought a piece of software from a solo developer with no
brand, no Series A, no proof beyond a Product Hunt listing.
That's a real bet on a stranger. I don't take it lightly. The
revenue from the first 100 buyers is what's making it possible
for me to keep shipping.

**2. Ask one favor.**

If Projelli has been useful to you in the last 30 days, the
single most helpful thing you can do for me is leave a public
note about it. It doesn't have to be a review — a tweet, a
LinkedIn post, an IndieHackers comment, a one-line note on
Product Hunt, an answer in a Reddit thread where someone asks
"what AI workspace do you use." Anything public.

Why public matters: every other potential buyer is currently
making a decision based on the same thing you saw on launch
day — a homepage and a hope. A few real people saying "yes,
this works for me" is what closes that loop.

If you want a template, here's one:

> "I've been using Projelli for a month — it's the local-first
>  AI workspace I'd been looking for. Every chat with Claude
>  becomes a real Markdown file on my hard drive, with 15 founder
>  templates baked in. Solo dev, one-time pricing, $49.
>  projelli.com"

Or write whatever you actually think. The honest version is
better than the polished version.

If Projelli HASN'T been useful to you in the last 30 days,
also let me know — I'd rather know now than miss the chance
to fix it. Just reply to this email.

Thank you again for being here in month one.

Jameson

--
projelli.com
Unsubscribe: {{unsubscribe_url}}
```

---

## Email 09 — Refund confirmation + exit interview (sent at T+0 after refund webhook)

**From:** Jameson Daines <support@projelli.com>
**Subject:** `Your Projelli refund — and one question if you have a minute`

**Body:**

```
Hi,

Your refund for Projelli has been processed. The full amount
should hit your card within 3-7 business days, depending on
your bank.

Order: {{order_id}}
Refunded: ${{amount}}

No questions asked, as promised. Your license key is now
deactivated and will stop working the next time the app
checks in.

If you're willing to spend 60 seconds telling me WHY you
refunded, it would genuinely help me fix whatever drove the
refund. This is the most useful feedback I can possibly get
as a solo developer, and it's the data I can't generate any
other way.

You can pick from a list — just reply with the number, no
explanation needed:

  1. Bug or technical problem
  2. Wasn't what I expected
  3. Found a better alternative
  4. Too expensive for what I got
  5. Just changed my mind
  6. Other (one line is fine)

I won't follow up. I won't pitch you on coming back. I just
want to know which bucket so I can fix the right problem.

Whatever the reason, thanks for trying it. Refunds aren't
failure — they're the system working as designed.

Jameson

--
projelli.com
```

---

## Email 10 — Re-engagement (sent T+30 days after last app activity, only to paying customers)

**From:** Jameson Daines <support@projelli.com>
**Subject:** `Did Projelli stop working for you?`

**Body:**

```
Hi,

The Projelli license validation service hasn't seen your app
check in for the last 30 days. That probably means one of
three things:

1. You're using Projelli offline and it's working fine. (No
   action needed — the app validates once and then runs
   indefinitely without further checks. Ignore this email.)

2. You hit a bug or technical issue and the app stopped
   working. If that's you, reply to this email and tell me
   what happened. I'll fix it or refund you, your choice.

3. Projelli didn't fit into your workflow and you stopped
   using it. If that's you, no judgment. But if there was
   one specific thing missing or one moment of friction
   that made you bounce, I'd really like to know. Reply
   with one line and I'll add it to my product notes.

I'm sending this once. If you don't reply, I won't bug you
again. I just don't want to lose touch with someone who
bought my software and fell out of using it without me ever
finding out why.

Thanks for being a launch buyer.

Jameson

--
projelli.com
Unsubscribe: {{unsubscribe_url}}
P.S. If you forgot your license key or need to reactivate
on a new device, just reply and I'll send it.
```

---

## Implementation notes for Claude (the code side)

| Email | Trigger | Sender | Mechanism |
|---|---|---|---|
| 01 Welcome | New row in `~/projelli/sign-ups/projelli-launch-email-list-*.jsonl` | Brevo via form-handler | Wire from form-handler service after JSONL append |
| 02 Teaser | T+3 days OR T-3 launch | Brevo scheduled | Manual one-time send via Brevo dashboard |
| 03 Launch | Launch day, 7am PT | Brevo scheduled | Manual one-time send via Brevo dashboard |
| 04 Week-1 follow-up | T+7 days after launch | Brevo scheduled | Manual one-time send via Brevo dashboard |
| 05 Purchase | LemonSqueezy `order_created` webhook | license-validator service | Build into existing webhook handler at `~/services/license-validator/` |
| 06 Day-one check-in | T+1 day after purchase | license-validator + cron | Add a delayed-job table to the license-validator SQLite DB |
| 07 Week-1 feedback | T+7 days after purchase | license-validator + cron | Same delayed-job table |
| 08 Month-1 retention | T+30 days after purchase | license-validator + cron | Same delayed-job table |
| 09 Refund | LemonSqueezy `order_refunded` webhook | license-validator service | Add to existing webhook handler |
| 10 Re-engagement | T+30 days no activity check-in | license-validator + cron | Daily cron job that scans last-checkin timestamps |

The minimum implementation for launch is just emails 01, 03, 05, and 09. The rest can be added in week 2.

---

## A/B testing notes

I'm not A/B testing the email body copy at this volume — the list is too small for statistical significance. The only A/B I'd run is the **subject line** of email 01 (welcome), because that's the only one with a meaningful click-through rate to optimize.

Once the list crosses ~500 active subscribers, it's worth testing:
- Email 03 launch subject line: "It's live" vs "Projelli is shipping today" vs "T-0"
- Email 08 retention CTA: "Leave a public note" vs "Tweet about it" vs "Tell one founder friend"

Until then, the highest-leverage optimization is the email VOICE — making sure each one sounds like Jameson and not like a marketing automation. Re-read every email out loud before saving.

---

*All 10 emails written 2026-04-09. Edit for voice. Don't add visual flourishes — these are intentionally plaintext to feel personal and avoid spam filters.*
