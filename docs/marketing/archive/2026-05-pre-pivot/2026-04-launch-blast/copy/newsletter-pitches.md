# Newsletter Cold-Pitch Packet, Day 4 of Launch Week

**Send when:** Friday morning of launch week (Day 4 in the 5-day sequence per `strategy/02-launch-fuel.md`)
**Time window:** 8-11 AM PT (most editors check email morning their time)
**Source:** `~/projelli/docs/marketing/channels/NEWSLETTER_OUTREACH.md` (canonical 15-outlet shortlist + tracking structure)
**Tracker CSV:** `~/projelli/sign-ups/newsletter-outreach.csv`

This packet provides ready-to-send personalized pitches for the **direct-email outlets** in Tier 1 + 3. The web-form / indirect outlets (BetaList, SaaSHub, IndieHackers, Refind, Hacker Newsletter) have separate submission paths covered in NEWSLETTER_OUTREACH.md.

---

## Pre-flight (do these before sending any pitch)

- [ ] Launch is LIVE on Product Hunt (PH listing live + maker comment posted; have URL)
- [ ] Show HN is LIVE (have URL); current points + comment count noted
- [ ] Tracker CSV exists at `~/projelli/sign-ups/newsletter-outreach.csv` with header row
- [ ] Press kit screenshots verified at `https://projelli.com/press-kit/`
- [ ] Demo video URL handy (YouTube unlisted)
- [ ] Numbers from launch: PH upvotes, HN points, signups, sales (even rough)

---

## Send order (over 48 hours, NOT all in one burst)

| Order | Outlet | Channel | Time slot |
|---|---|---|---|
| 1 | MakerNews (Sergio Mattei) | Email | Friday 08:00 PT |
| 2 | Console.dev (Jack Hanford) | Web form + email | Friday 09:00 PT |
| 3 | Local-First Newsletter | Email (find via localfirstweb.dev) | Friday 10:00 PT |
| 4 | The Ravel (Tauri community) | Email or community post | Friday 11:00 PT |
| 5 | BetaList | Web form submission | Friday 14:00 PT |
| 6 | SaaSHub | Web form submission | Friday 15:00 PT |
| 7 | Tools for Founders / FounderToFounder | Email | Saturday 09:00 PT |
| 8 | Ben's Bites / AI Tool Report / Rundown | Email (find contacts on their sites) | Saturday 10:00 PT |

Spaced ~1 hr apart. Don't blast simultaneously, editors compare notes informally and seeing 6 indie tool pitches in one inbox at the same minute looks bot-driven.

---

## 1. MakerNews, Sergio Mattei (highest priority, direct email)

**To:** sergio@maker.co
**Subject:** Indie launch: Projelli, local-first AI workspace (8 weeks of weekend work)

```
Hi Sergio,

I'm Jameson, solo developer at a health-tech company. Just launched
Projelli on Product Hunt this week, want to share with you because
the audience overlap with MakerNews looks really tight.

What it is: a local-first desktop AI workspace where every chat with
Claude / GPT / Gemini becomes a real Markdown file on your hard drive.
BYOK, one-time pricing ($49 Pro, $99 Lifetime, $29 first 100 buyers),
15 founder workflow templates baked in, source visible on GitHub.

Built solo on weekends and evenings around a full-time job, 18 months
of product work + 8 weeks of commercial polish (legal docs, code
signing, payments, marketing).

PH listing: [paste]
Show HN: [paste]
Live: https://projelli.com

The MakerNews audience is exactly who I built this for, solo people
shipping their own thing. If it fits a future issue, I'd be honored.
If not, no follow-up on my end.

Either way, thanks for what you do for the maker community.

Jameson
projelli.com
```

**Why Sergio:** MakerNews specifically covers products from solo makers. ~15K subscribers. Highest fit-to-audience ratio of any outlet on the list.

**Tracker entry after send:** `2026-XX-XX,MakerNews,Sergio Mattei,sergio@maker.co,maker-angle,,,,sent`

---

## 2. Console.dev, Jack Hanford

**To:** Jack via web form at https://console.dev/submit
**Subject (if email pitch instead):** Indie launch: Projelli, local-first AI workspace built on Tauri, source visible

**Web form text:**

```
Projelli is a local-first desktop AI workspace built on Tauri (Rust +
React). Every chat with Claude / GPT / Gemini becomes a real Markdown
file on disk. Source visible on GitHub, $49 one-time, BYOK for cloud
models + Ollama for fully-offline operation.

Built by a solo developer at a health-tech company, 18 months of
weekend work, just launched on Product Hunt and Show HN this week.

What sets it apart for Console readers: it's source-available (you
can read every line, audit the network behavior, verify nothing
exfiltrates), it's truly local-first (data on your machine, in plain
Markdown), and it ships an MCP server so you can connect it from
Claude Desktop / Cursor / Zed.

Live: https://projelli.com
GitHub: https://github.com/projelli/projelli
Press kit: https://projelli.com/press-kit/
PH: [paste]
Show HN: [paste]
```

**Why Console.dev:** ~30K developers, covers developer tools. The Tauri + source-available + MCP angle is exactly what their readers vote up.

---

## 3. Local-First Newsletter (community-run, find via localfirstweb.dev)

**To:** look up current editor at localfirstweb.dev (they rotate)
**Subject:** Local-first AI workspace where every chat is a Markdown file on disk

```
Hi [name],

Saw your coverage of [recent local-first product they covered]. The
"data lives on your device, in a format you control" frame is exactly
what I built Projelli around, want to share in case it fits a future
issue.

Projelli is a local-first AI workspace. Every conversation with
Claude / GPT / Gemini drops a real Markdown file into a folder on
your hard drive (I default to ~/Documents/Projelli/). Plain Markdown
in plain folders. Open them in any other editor, sync via Dropbox /
Syncthing / iCloud, back them up however you want.

Passes the strict Ink & Switch test: authoritative copy on device,
open format, works offline (except the AI call itself), cloud is
optional (in fact: there's no cloud), readable without Projelli.

BYOK for cloud models. Ollama for fully-offline operation.

Source visible: https://github.com/projelli/projelli
Live: https://projelli.com
Just launched on PH + Show HN: [paste links]

If the fit is right, I'd love to be in a future issue. If not, no
follow-up.

Jameson
projelli.com
```

**Why Local-First Newsletter:** ~3-5K subscribers but every reader cares about local-first. Perfect topical fit.

---

## 4. The Ravel (Tauri community)

**To:** find editor or post in Tauri community channel
**Subject:** Indie Tauri 2 + React desktop app launched, AI workspace, source visible

```
Hi [name],

Posting because Projelli is a Tauri 2 + React + TypeScript desktop
app I just launched, ~12 MB binary, source visible, and the Tauri
community has been the single most useful resource through the build.

Projelli is a local-first AI workspace where every chat becomes a
Markdown file on disk. BYOK for cloud models, Ollama integration for
local. Tauri 2 + React 18 + Zustand + CodeMirror 6 + sql.js. Cross-
platform: signed Mac (notarized), Azure-signed Windows, Linux
.deb/.rpm/.AppImage, all built in one GitHub Actions matrix.

A few Tauri-specific things that took real effort:
- Auto-updater via the Tauri signer + Ed25519 keypair
- Mac notarization automation (when Apple's service is up)
- Plugin-fs scope handling for dotfile workspaces (the
  require_literal_leading_dot gotcha)
- An MCP server bundled as per-platform .mcpb sidecar

If the Tauri-built angle is interesting to The Ravel readers, would
love to be featured in a future issue. Source: github.com/projelli/projelli.

Jameson
projelli.com
```

**Why The Ravel:** ~5K Tauri developers, niche but tight-knit. Feature here brings developer credibility + word-of-mouth in the Tauri ecosystem.

---

## 5. BetaList (web form, not email)

**Submit at:** https://betalist.com/submit

**Form fields (paste these into the BetaList form):**

| Field | Value |
|---|---|
| Product name | Projelli |
| Tagline | A local-first AI workspace where every chat becomes a real Markdown file you own |
| URL | https://projelli.com |
| Logo | upload from `~/projelli/website/press-kit/assets/og-linkedin-card.png` (or the dedicated logo PNG) |
| Description | Projelli is a local-first AI workspace built for indie founders, useful for anyone who works with AI on real projects. Every conversation with Claude, GPT, or Gemini produces a real Markdown file in a folder on your hard drive (not someone else's cloud). Bring your own API key, pay once ($49 Pro, $99 Lifetime, $29 first 100 buyers), 15 founder workflow templates baked in. Source visible on GitHub. Built solo on weekends and evenings. |
| Maker | Jameson Daines |
| Twitter | [@projelliproject or @jamesondaines, confirm with Jameson] |
| Categories | Productivity, AI, Developer Tools |

**Premium tier ($79):** if budget allows, pay for the Featured slot. Guarantees inclusion in their daily newsletter.

---

## 6. SaaSHub (web form)

**Submit at:** https://www.saashub.com/submit-product

**Form fields:**

| Field | Value |
|---|---|
| Name | Projelli |
| Website | https://projelli.com |
| Tagline | Local-first AI workspace, your data on your machine, $49 once |
| Categories | AI Tools, Productivity, Note-Taking, Markdown Editors |
| Alternative to | Notion AI, Mem.ai, Reflect, Tana |
| Pricing model | One-time |
| Free trial | Yes (30 days) |
| Logo | from press kit |
| Screenshots | upload 3-4 from `~/projelli/website/press-kit/assets/` |

**Why SaaSHub:** ~40K newsletter subscribers. The "Alternative to" field is the high-value one, lets buyers find Projelli when comparison-shopping for ChatGPT / Notion AI alternatives.

---

## 7. Tools for Founders / FounderToFounder

**To:** find direct contact via their sites
**Subject:** Indie founder tool launch: $49 one-time, BYOK, 15 founder workflow templates

```
Hi [name],

Just launched Projelli on Product Hunt this week, sharing because the
"built for indie founders" framing matches your audience precisely.

Projelli is a local-first AI workspace. Every chat becomes a real
Markdown file on your hard drive. 15 founder workflow templates
(Pricing Strategy, Pitch Deck, Customer Persona, GTM Plan, Investor
Update, Board Meeting Prep, etc.). BYOK for Claude / GPT / Gemini.
Source visible. One-time pricing ($49 Pro, $99 Lifetime, $29 for
first 100 buyers).

The Founder's Launch tier ($29 lifetime, capped at 100) is the
hook, if your readers are the kind who buy when something rare
opens, this is one.

Live: https://projelli.com
PH: [paste]

If it fits, I'd love to be featured. If not, no follow-up.

Jameson
projelli.com
```

---

## 8. Ben's Bites / AI Tool Report / Rundown AI

**To:** check each site for current submission email
**Subject:** Local-first AI workspace launched, BYOK, your data never leaves your machine

```
Hi [name],

Quick pitch: I just launched Projelli, an AI workspace that doesn't
send your conversations anywhere except to the AI provider you choose.

The angle that fits Ben's Bites / Rundown / AI Tool Report readers:
in a category where every "AI tool" is a wrapper around someone
else's API with markup, BYOK + local files + one-time pricing is
genuinely different. Your $20/mo ChatGPT Plus becomes ~$5-15/mo
direct to OpenAI, your data lives in `~/Documents/Projelli/`
instead of someone's database, you pay $49 once instead of $240/year.

Bonus: it ships with persistent memory (RAG over your workspace), an
MCP server (works in Claude Desktop / Cursor / Zed), side-by-side AI
editing, and Ollama support for fully-offline operation.

Live: https://projelli.com
PH: [paste]
Show HN: [paste]

If it fits, I'd love to be featured.

Jameson
projelli.com
```

---

## Tracker CSV starter

Save at `~/projelli/sign-ups/newsletter-outreach.csv`:

```csv
date_sent,outlet,contact_name,contact_email,pitch_variant,response_date,response_type,featured_url,notes
,MakerNews,Sergio Mattei,sergio@maker.co,maker-angle,,,,
,Console.dev,Jack Hanford,(via web form),tauri-source-available,,,,
,Local-First Newsletter,(rotating editor),(find at localfirstweb.dev),local-first-strict-test,,,,
,The Ravel,(Tauri community),(find current editor),tauri-stack-deep,,,,
,BetaList,N/A,(web form),standard,,,,Premium $79 tier?
,SaaSHub,N/A,(web form),standard,,,,Alternative-to: Notion AI / Mem.ai
,Tools for Founders,(find contact),(via site),founder-launch-tier,,,,
,Ben's Bites,(find contact),(via site),byok-cost-angle,,,,
```

Fill in `date_sent` as you send each. Add follow-up rows for responses.

---

## What to do if a newsletter says yes

Per `NEWSLETTER_OUTREACH.md` § Post-feature follow-up:

1. **Within 24 hours:** Reply with thanks (one sentence) + screenshot of homepage analytics showing the spike
2. **Add the feature to the press kit** under "Coverage" with URL + date
3. **Share the feature on @projelliproject + LinkedIn** with the editor's handle tagged
4. **Add to launch retro** in `tracking.md` (this campaign folder)
5. **30 days later:** brief follow-up with impact numbers (builds long-term relationship for future launches)

---

## What success looks like

| Metric | Floor | Target | Stretch |
|---|---|---|---|
| Newsletters pitched | 6 | 12 | 20 |
| Responses received | 2 | 5 | 8 |
| Featured | 1 | 3 | 5 |
| Click-through traffic | 200 | 800 | 3,000 |
| Sales attributable | 1 | 5 | 15 |

A single feature in BetaList, MakerNews, or Console.dev is the realistic launch-month target.
