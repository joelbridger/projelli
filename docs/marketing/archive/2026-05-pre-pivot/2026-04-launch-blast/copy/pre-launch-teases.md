# Pre-Launch Tease Drafts (Phase 1 + Phase 2)

These drafts warm the audience BEFORE the Day-1 hard-launch beat. They're spread across the pre-launch ramp window (Phase 1 → Phase 2), not all at once.

**Key principle:** pre-launch teases are about anticipation, not selling. Don't include buy buttons or upvote asks. Just "here's what's coming."

---

## 1. r/SideProject pre-launch announcement (Phase 1, ~7-10 days before launch)

**Subreddit:** r/SideProject
**When to post:** End of Phase 1, when beta cohort is forming and PH hunter outreach has at least 1-2 yes responses
**Pre-requisites:** 5+ helpful comments in r/SideProject already (per anti-pattern #19)
**Submit URL:** https://www.reddit.com/r/SideProject/submit
**Format:** Text post + 1 screenshot

### Title

After 18 months of weekend work, my local-first AI workspace is about to ship publicly, looking for honest feedback before launch day

### Body

Quick heads-up post for anyone who works with AI on personal projects.

I've been building something called Projelli for about 18 months on weekends and evenings, alongside my day job at a health-tech company. It's a desktop AI workspace where every chat with Claude / GPT / Gemini becomes a real Markdown file in a folder on your hard drive. BYOK, local-first, 15 founder workflow templates baked in. Source visible on GitHub.

The product itself is done. The next 1-2 weeks I'm finishing the launch prep: beta tester feedback, recording the demo video, talking to a Product Hunt hunter, polishing the website copy.

What I'd love from this subreddit before launch day:

1. **Honest critique of the landing page.** Anything confusing? Anything that would stop you from downloading? Roast it: https://projelli.com
2. **Beta testers.** If you'd actually use a tool like this on a real project for a week, DM me. I'll send you a free Lifetime license in exchange for honest "here's what worked / here's what didn't" feedback. 10-15 spots.
3. **First impressions of the value prop.** "Local-first AI workspace, every chat becomes a file you own", does that read clearly to people who haven't seen the product?

Not asking for upvotes, not asking for shares. Just real feedback before I commit to launch day.

What it actually does (~30 seconds of context):
- Free 30-day trial, full feature
- BYOK for Claude / OpenAI / Gemini, plus Ollama for fully-offline
- Files written to ~/Documents/Projelli/, plain Markdown, open in any other editor
- 15 founder workflow templates: Pricing Strategy, Pitch Deck, Customer Persona, GTM Plan, etc.
- Wiki-links + backlinks like Obsidian
- MCP server so Claude Desktop / Cursor / Zed can read your workspace
- $49 Pro, $99 Lifetime, first 100 buyers get Lifetime for $29 (Founder's Launch tier)

Source: https://github.com/projelli/projelli
Demo + try it: https://projelli.com
Beta tester slot: DM me

Disclosure: I built it. Will reply to every comment for 24 hours after posting.

### Visual to attach

Use `~/projelli/website/press-kit/assets/homepage-1-hero.png` (or one of the workspace screenshots).

### Tracker entry after post

Log to `tracking.md` under Phase 2 progress: "r/SideProject pre-launch announcement posted [date], comment count [N], beta tester DM volume [N]"

---

## 2. Pre-launch email to launch-list subscribers (T-3 days before hard launch)

**To:** Brevo email-list contact list (list ID per `PROJELLI_BREVO_LIST_ID` if set)
**Send via:** Brevo dashboard or via API; Jameson sends, not Claude
**Subject:** Launching Tuesday: $29 Founder's Launch tier opens at 12:01 AM PT

### Body

```
Hey,

Quick heads-up that Projelli is launching publicly on Tuesday.

Here's what to know:

- Product Hunt listing goes live at 12:01 AM PT Tuesday. The Founder's
  Launch tier ($29 lifetime, normally $99) opens at the same moment.
  First 100 buyers get the founder price.

- Show HN goes up Wednesday morning.

- Honest first 24-hour traffic numbers will be posted on @projelliproject
  Tuesday evening.

You're on this email list because you signed up at projelli.com.
You'll get the launch link and the founder discount code as soon as
the PH listing is live, no delay.

A few honest notes about what's shipping:

1. The product is v1.7.2, 18 months of weekend work, plus 8 weeks
   of commercial polish (legal docs, code signing, payments).
2. It runs on Mac (signed + notarized), Windows (Azure-signed), and
   Linux (.deb, .rpm, .AppImage).
3. BYOK for Claude / GPT / Gemini, plus Ollama if you want fully-
   offline operation. No Projelli proxy server, ever.
4. 15 founder workflow templates baked in. Real ones, not "AI helps
   you brainstorm" generic prompts.

If you have any feedback on the homepage or the pitch before Tuesday,
just reply to this email. It comes straight to me.

Genuinely nervous about Tuesday. Thanks for following along.

Jameson
projelli.com
```

### Voice notes

- Voice profile compliant: time anchors ("Tuesday", "8 weeks"), self-deprecating ("genuinely nervous"), specific numbers, no em dashes, no AI tells, contractions throughout
- Length: ~250 words, scannable on mobile
- One link only (projelli.com signature)
- No urgency hooks beyond the natural Founder's Launch tier scarcity

### Send notes for Jameson

- Send Saturday morning if launching Tuesday (T-3 days)
- Send via Brevo dashboard → Campaign → New email campaign
- Recipient list: the launch-list contacts (filter `SIGNUP_SOURCE` if needed)
- Track open + click rates in Brevo (these are the leading indicator for launch-day conversion)
- Don't follow up if open rate is low; just trust the launch beat

---

## 3. @projelliproject T-1 Founder's Launch tease tweet

**Account:** @projelliproject (brand)
**When to post:** Monday evening before Tuesday launch (T-1 day, ~24 hours before PH listing goes live)
**Format:** Single tweet + visual (the Founder's Launch tier card)

### Tweet text

```
Tomorrow at 12:01 AM PT, Projelli goes live on Product Hunt.

Local-first AI workspace. Every chat becomes a Markdown file you own.
BYOK. Sold once.

The Founder's Launch tier opens at the same moment: $29 lifetime,
first 100 buyers, normally $99.

projelli.com
```

**Char count:** ~270 / 280
**Visual:** A simple "Founder's Launch" pricing card. Stage at `~/projelli/Assets/x-founders-launch-tease.png`. Should show:
- "FOUNDER'S LAUNCH" label
- "$29 lifetime"
- "First 100 buyers"
- "Normally $99"
- "Tuesday 12:01 AM PT"

### Followup tweet (Tuesday morning, if first one performs)

```
3 hours in. Founder's Launch counter at [X] of 100. Watching the
spots-remaining widget on projelli.com tick down in real time is
genuinely surreal.

If you've been on the email list, your link is in your inbox.
```

---

## 4. Jameson real-name pre-launch tease (X / LinkedIn, OPTIONAL, counts toward 1-2/month cap)

**Account:** Jameson's personal X (@jamesondaines or whichever) + LinkedIn
**When to post:** Same day as the @projelliproject tease (T-1)
**Format:** Single post per platform; per `strategy/05-personal-brand-binding.md`, this is one of the 1-2 monthly project-mention posts allowed
**Approval:** REQUIRED per `feedback_linkedin_approval.md`, Jameson reviews + posts manually

### X version

```
Tomorrow morning, after 18 months of weekends, Projelli goes live
publicly.

Local-first AI workspace. Every chat with Claude / GPT / Gemini
becomes a real Markdown file on your hard drive. Founder's Launch
tier opens at the same moment, $29 lifetime, first 100 buyers.

I'm genuinely nervous. projelli.com
```

**Char count:** ~285, trim "with Claude / GPT / Gemini" if over 280.

### LinkedIn version (longer, more reflective)

```
Tomorrow morning, Projelli goes live publicly.

It's been 18 months of weekend and evening work. The product was
95% done a year ago. The other 5%, legal docs, payment integration,
code signing, CI, marketing, turned out to be the hard part.

What it is: a local-first AI workspace built for indie founders,
useful for anyone who works with AI on real projects. Every chat
with Claude, OpenAI, or Gemini saves as a real Markdown file in a
folder you own. BYOK. Sold once.

Founder's Launch tier opens at the same moment as the public
listing, $29 lifetime for the first 100 buyers, normally $99.

I'm honestly nervous about how this one lands. The honest behind-
the-scenes story will go up on the blog after launch day.

projelli.com
```

**Voice profile checks:**
- [x] First-person singular
- [x] Specific time anchors ("18 months", "tomorrow morning", "year ago")
- [x] Verbal tics ("honestly", "honestly nervous")
- [x] No em dashes (text uses commas / periods only)
- [x] No banned vocab (no leverage / delve / seamless / transform)
- [x] Self-deprecating opening tone
- [x] One link only
- [x] One image suggested: pinned demo GIF or homepage screenshot

**Pre-flight checklist** (per `strategy/05-personal-brand-binding.md` § 4):
- [ ] Wheel Health firewall: zero internal references ✓
- [ ] Frequency check: this is post 1 of 2 max for the calendar month
- [ ] LinkedIn manual approval: Jameson reviews before posting
- [ ] Visual attached: yes (homepage screenshot or demo GIF)
- [ ] Project mention slot: this is the 5% project-mention slot of the personal brand strategy

---

## What NOT to do in pre-launch teases

Per `strategy/07-anti-patterns.md`:
- ❌ Don't hard-sell or include buy buttons in pre-launch posts (anti-pattern #5)
- ❌ Don't ask for upvotes / shares / "please RT" (anti-pattern #5)
- ❌ Don't promise specific revenue numbers ("aiming for $10K month 1!") that you can't control
- ❌ Don't trash competitors (anti-pattern #15)
- ❌ Don't promise features that aren't in the shipping product

What pre-launch teases SHOULD do:
- ✅ Anchor in a specific date / moment ("Tuesday", "tomorrow at 12:01 AM PT")
- ✅ Surface the scarcity lever (Founder's Launch 100-cap) honestly
- ✅ Acknowledge nervousness / vulnerability (the Jameson voice)
- ✅ Direct people to the email list / @projelliproject for launch-day notifications

---

## Order of operations

| Phase | Action | Owner |
|---|---|---|
| Phase 1 (~T-7 to T-10) | r/SideProject pre-launch announcement (post #1 above) | Jameson posts |
| Phase 2 mid (~T-3) | Brevo email blast to launch list (post #2 above) | Jameson sends via Brevo |
| Phase 3 setup (T-1, evening) | @projelliproject Founder's Launch tease tweet (post #3 above) | Jameson posts via @projelliproject |
| Phase 3 setup (T-1, evening) | OPTIONAL: Jameson real-name tease (post #4 above) | Jameson reviews + posts on personal accounts |

The cumulative effect: anyone who follows ANY of @projelliproject, the Reddit thread, the email list, or Jameson's personal feed knows the launch is coming and the Founder's Launch tier is real.
