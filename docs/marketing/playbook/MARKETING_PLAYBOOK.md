> **CHANNEL STRATEGY OUTDATED** — This playbook was written for Product Hunt / Hacker News / IndieHackers launch targeting indie founders. As of 2026-05-27, the ICP is attorneys, CPAs, and consultants. The new channels are bar association CLEs, AICPA/NAEA newsletters, and Umbrex/Lenny (consulting). This content needs rewriting before use.

# Marketing Playbook, Keepance Launch

> **Status:** Index of all marketing assets produced 2026-04-09.
> **Audience:** Future Claude sessions, Jameson reviewing during launch ramp.
> **Operating contract:** This playbook is the canonical inventory of marketing artifacts. Every other doc in `docs/features/` referenced here was produced in a single marathon session and should be treated as ready-to-use drafts that need final review (mostly for voice).

---

## What this playbook contains

8 documents and 4 web pages produced in parallel with the engineering work the other Claude session is doing on Windows + Mac code signing. They cover the full marketing surface area needed for launch:

| Asset | File | Purpose |
|---|---|---|
| **Competitive analysis matrix** | `docs/reference/COMPETITIVE_LANDSCAPE.md` | Side-by-side vs Notion/Obsidian/ChatGPT/etc. + per-competitor reply paragraphs for PH/HN comments |
| **Product Hunt launch package** | `docs/features/PRODUCT_HUNT_LAUNCH.md` | Title/tagline variants, founder maker comment, 12 pre-staged FAQ replies, hunter pitch DM, day-of timeline |
| **Show HN launch package** | `docs/features/SHOW_HN_LAUNCH.md` | HN-format title, technical/honest body, 15 pre-staged comment replies, submit timing strategy |
| **IndieHackers narrative post** | `docs/features/INDIE_HACKERS_LAUNCH.md` | "8 weeks to first paying customer" narrative format with vulnerability angle and real numbers |
| **Email sequences (10 emails)** | `docs/features/EMAIL_SEQUENCES.md` | Welcome, teaser, launch day, post-purchase, day-1, week-1, month-1, refund, re-engagement |
| **Newsletter outreach plan** | `docs/features/NEWSLETTER_OUTREACH.md` | 15+ newsletter targets, cold pitch template, follow-up template, tracking spreadsheet structure |
| **Press kit (live web page)** | `website/press-kit/index.html` | Logo files, screenshot slots, founder bio (3 lengths), fact sheet, brand colors, press contact |
| **Blog index + 3 posts** | `website/blog/` | Live blog directory with 3 publishable HTML posts: 8-week launch story, why local-first, picking templates |
| **Action pack for Jameson** | `docs/features/JAMESON_ACTION_PACK.md` | Pre-staged drafts and step-by-step instructions for the 8 things only Jameson can do (PH hunters, beta testers, screenshots, demo video, X posts, etc.) |

---

## Strategy in one diagram

```
                    ┌──────────────────────────────────┐
                    │   POSITIONING (decided 2026-04-08)│
                    │                                  │
                    │   "Local-first AI workspace      │
                    │    for indie founders. Every     │
                    │    chat becomes a real file."    │
                    └────────────────┬─────────────────┘
                                     │
                                     ▼
   ┌───────────────────────────────────────────────────────────┐
   │                COMPETITIVE LANDSCAPE                       │
   │   Reference for every "vs X" question. Used as ammo       │
   │   in PH/HN/IH comment threads.                            │
   └─────────────────────┬─────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
   ┌─────────┐      ┌─────────┐      ┌──────────┐
   │  PH     │      │  HN     │      │   IH     │
   │ launch  │      │ launch  │      │ launch   │
   │ package │      │ package │      │ package  │
   └────┬────┘      └────┬────┘      └────┬─────┘
        │                │                │
        └────────────────┼────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │  LAUNCH DAY (Tue/Wed)│
              │  PH 12:01am          │
              │  Show HN 9am         │
              │  IH 8pm              │
              └──────────┬───────────┘
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
       ▼                 ▼                 ▼
  ┌─────────┐      ┌──────────┐      ┌──────────┐
  │  Email  │      │ Newsletter│      │  Blog    │
  │sequences│      │  outreach │      │ posts    │
  │(10 msgs)│      │(15+ targets)│   │ (3 ready)│
  └─────────┘      └──────────┘      └──────────┘
       │                 │                 │
       └─────────────────┼─────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │  WEEKS 7-8           │
              │  Distribution + iter │
              └──────────────────────┘

```

---

## Critical path to launch day

These items, in order, are the critical path. Skip any of them and the launch ceiling drops noticeably.

### Pre-launch week (T-7 to T-1)

| Day | Task | Owner | Source doc |
|---|---|---|---|
| T-7 | DM 8-10 PH hunters with personalized pitches | Jameson | `JAMESON_ACTION_PACK.md` § B |
| T-7 | Take all 6 product screenshots | Jameson | `JAMESON_ACTION_PACK.md` § D |
| T-6 | Record 30-second demo video | Jameson | `JAMESON_ACTION_PACK.md` § E |
| T-5 | Send first build-in-public tweet | Jameson | `JAMESON_ACTION_PACK.md` § H |
| T-5 | DM 15-20 beta tester candidates | Jameson | `JAMESON_ACTION_PACK.md` § C |
| T-5 | Set up Plausible conversion goals | Jameson | `JAMESON_ACTION_PACK.md` § G |
| T-4 | Send second build-in-public tweet | Jameson | `JAMESON_ACTION_PACK.md` § H |
| T-3 | Send pre-launch teaser email to list | Claude (drafts), Jameson (sends) | `EMAIL_SEQUENCES.md` § Email 02 |
| T-3 | Send third build-in-public tweet (vulnerability angle) | Jameson | `JAMESON_ACTION_PACK.md` § H |
| T-2 | Confirm hunter timing | Both |, |
| T-2 | Final review of PH listing copy + maker comment | Jameson | `PRODUCT_HUNT_LAUNCH.md` |
| T-1 | Pin demo tweet on X profile | Jameson | `JAMESON_ACTION_PACK.md` § H |
| T-1 | Send Founder's Launch tease tweet | Jameson | `JAMESON_ACTION_PACK.md` § H |

### Launch day (T+0)

Follow the timeline in `PRODUCT_HUNT_LAUNCH.md` § Launch day timeline. The full 24-hour playbook is mapped hour by hour.

### Post-launch week (T+1 to T+7)

| Day | Task | Owner | Source doc |
|---|---|---|---|
| T+1 | Day-1 IH update post with first numbers | Jameson | `INDIE_HACKERS_LAUNCH.md` § Day 1 |
| T+1 | Day-one check-in emails to all paying customers | Automated | `EMAIL_SEQUENCES.md` § Email 06 |
| T+2 | Send first newsletter outreach pitches (Tier 1: BetaList, MakerNews, Console.dev) | Jameson | `NEWSLETTER_OUTREACH.md` |
| T+3 | Submit to AlternativeTo | Jameson |, (web form) |
| T+3 | Reddit post sequence: r/SideProject, r/Entrepreneur, r/SaaS, r/LocalLLaMA, r/ChatGPTPro (1 per day, customized) | Jameson |, |
| T+5 | Publish first blog post: "How I built Keepance in 8 weeks" | Both | `website/blog/how-i-built-keepance-in-8-weeks.html` |
| T+6 | Send week-1 retention email + week-1 IH update post | Both | `EMAIL_SEQUENCES.md` + `INDIE_HACKERS_LAUNCH.md` |
| T+7 | Post-launch debrief, fill in numbers in `PRODUCT_HUNT_LAUNCH.md` debrief table | Both | `PRODUCT_HUNT_LAUNCH.md` |
| T+7 | Publish second blog post: "Why local-first AI for founders" | Both | `website/blog/why-local-first-ai-for-founders.html` |
| T+10 | Publish third blog post: "Picking the 15 founder templates" | Both | `website/blog/picking-the-15-founder-templates.html` |

---

## How the documents fit together (read this if you're a future Claude session)

The 8 marketing docs are intentionally cross-referencing. Here's how to navigate them:

- **If someone asks "how is Keepance different from X?"** → Open `COMPETITIVE_LANDSCAPE.md`, find the relevant "vs X" paragraph, copy.
- **If something needs to go on Product Hunt** → Open `PRODUCT_HUNT_LAUNCH.md`, lift directly. The maker comment, gallery captions, and FAQ replies are launch-ready.
- **If something needs to go on Hacker News** → Open `SHOW_HN_LAUNCH.md`. DO NOT use the PH copy on HN, different audience, different rules.
- **If the IndieHackers narrative needs writing** → Open `INDIE_HACKERS_LAUNCH.md`. Lift the body, fill in the post-launch numbers, post.
- **If a buyer needs an email** → Open `EMAIL_SEQUENCES.md`, find the right email (post-purchase, day-1, week-1, refund, etc.), copy, send.
- **If a newsletter editor needs to be pitched** → Open `NEWSLETTER_OUTREACH.md`, use the cold pitch template, customize the personalization line, send.
- **If a journalist or blogger asks for assets** → Send them `https://keepance.com/press-kit/`. Everything they need is there.
- **If Jameson needs to know what to do next** → Open `JAMESON_ACTION_PACK.md`. The 8 actions are checklist-style with pre-staged drafts.

---

## What's still missing from the marketing surface area

Even after this playbook, there are things that aren't here yet. Most of them depend on having actual launch data first.

### Things to write AFTER the launch

| What | Why we wait | When to write |
|---|---|---|
| **Launch retrospective post** | Need real numbers | Day 7-10 post-launch |
| **30-day post-launch update post** | Need a month of data | Day 30 post-launch |
| **First customer testimonials** | Need first customers | Day 14 post-launch |
| **Case study: how Founder X uses Keepance** | Need at least one customer who's willing | Month 2 |
| **Blog post: lessons from the first 100 customers** | Need 100 customers | When it happens |

### Things that need decisions before they can be written

| What | Decision needed | Decision-maker |
|---|---|---|
| **Affiliate program copy** | Yes/no on standing up an affiliate program in LemonSqueezy | Jameson |
| **Public roadmap** | Yes/no on publishing a roadmap (incompatible with "build what users actually ask for") | Jameson |
| **v1.1 launch announcement** | When v1.1 ships | Both |
| **"Keepance Lite" open-source funnel** | Per Decision #15: explicitly NOT in v1, possibly never | Future |

### Things that need different channels

| What | Channel | Status |
|---|---|---|
| **YouTube tutorial videos** | YouTube channel | Not in v1 launch, too much production time |
| **Podcast appearances** | Indie hackers / startup podcasts | Reactive, not proactive, wait for invites |
| **Twitter Spaces / X spaces** | X | Reactive, only if a high-trust founder hosts and invites |
| **In-person events / meetups** | Local indie hacker meetups | Out of scope for launch |

---

## Voice rules for everything in this playbook

Every marketing artifact in this playbook was written under these rules. If you're editing or extending them, keep the rules:

1. **First-person singular always.** Never "we" for a solo product.
2. **Contractions everywhere.** "I'm" not "I am".
3. **Specific concrete nouns.** "$5 in free credits" not "generous starter credits."
4. **Real numbers.** Made-up percentages are obvious.
5. **Uneven sentence length.** Short. Then medium. Then a longer one with a parenthetical that breaks the rhythm.
6. **No "leverage", "delve", "seamless", "cutting-edge", "harness", "transform your", "empower", "elevate", "unlock", "unleash"**, and the rest of the AI-tells list in `~/.claude/projects/-home-jameson/memory/reference_ai_writing_tells.md`.
7. **No italicized fragments at the end of sentences.** This is the #1 Claude tell.
8. **No "It's not X, it's Y" parallelism.** Cut, don't substitute.
9. **No rule-of-three on every sentence.** Break the symmetry.
10. **Occasional informal constructions and sentence fragments are good.** Real humans aren't polished.

When in doubt: read the homepage at keepance.com, which was audited 2026-04-08 and is the canonical voice reference for the brand.

---

## Update cadence

| Doc | Update when |
|---|---|
| `COMPETITIVE_LANDSCAPE.md` | Every 90 days |
| `PRODUCT_HUNT_LAUNCH.md` | After launch (fill in debrief), then archive |
| `SHOW_HN_LAUNCH.md` | After launch (fill in metrics), then archive |
| `INDIE_HACKERS_LAUNCH.md` | After launch + at day 30 + at day 90 |
| `EMAIL_SEQUENCES.md` | When voice drifts or new sequence needed |
| `NEWSLETTER_OUTREACH.md` | Update tracking spreadsheet weekly during launch month |
| `JAMESON_ACTION_PACK.md` | Mark items done as Jameson completes them |
| Press kit | Whenever screenshots / numbers / press coverage update |
| Blog posts | Once per quarter, ideally |

---

## Where to put new marketing docs

Future marketing docs go in `docs/features/` if they're internal-only (drafts, plans, playbooks) or `website/` if they're publishable (blog posts, press pages, landing pages for specific campaigns).

**Don't** put marketing docs in `docs/reference/`, that's for evergreen reference material like the competitive landscape and architecture decisions.

**Don't** put marketing docs in `docs/operations/`, that's for runbooks and operational procedures.

---

## Production credit

All 8 documents in this playbook were drafted in a single Claude session on 2026-04-09 by the second Claude instance running in parallel on the marketing branch. The first Claude instance was simultaneously iterating on Windows + Mac code signing for the v1.0.2 release on master.

The branch `marketing/launch-assets` contains all of these files. Once reviewed and merged, the marketing surface area for the launch is ~60% complete (up from ~15% before this session). The remaining 40% requires Jameson's hands and is documented in `JAMESON_ACTION_PACK.md`.
