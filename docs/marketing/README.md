# Keepance Marketing

This folder is the canonical home for **all ongoing marketing work** for Keepance — campaigns, channel-specific playbooks, action packs, copy, and operational marketing materials. Created 2026-04-22 during the docs reorganization that consolidated marketing files previously scattered across `docs/features/` and `docs/launch/`.

> **Channel pivot — 2026-05-27:** As of the ICP pivot on 2026-05-27, the primary marketing channels are **bar associations (legal)**: ABA TECHSHOW, Lawyerist, Above the Law, IPWatchdog; **AICPA/NAEA (tax)**; and **Umbrex/Lenny (consulting)**. PH/HN/IH are not primary channels for the current ICP. Channel playbooks in `channels/` are retained as reference but are not the active distribution strategy.

> **Distribution model — MARKETING-LED ONLY (stated 2026-06-06):** Jameson has **no personal network** to draw on. No warm intros, no "people you know," no founder-network plays. Every tactic must work cold: editorial pitches, community posts, cold outreach, SEO, ads, directories. **Jameson's name goes on everything** (bylines, posts, outreach signatures) and outreach is **sent from his personal email** (jamesondaines@outlook.com via the logged-in Outlook, autonomous + audit-logged). Reviewer recruiting is therefore cold outreach to strangers, not network asks. Any playbook content that assumes a network is stale — rewrite it for cold, marketing-led execution.

---

## Where things go

```
docs/marketing/
├── README.md          ← you are here
├── strategy/          The 12-month strategic plan. Read FIRST before any tactical work.
├── playbook/          Reusable how-to docs that apply across channels and campaigns
├── channels/          Per-platform launch + ongoing materials (PH, HN, IH, Reddit, etc.)
├── action-packs/      To-do bundles scoped to a specific person or audience
└── campaigns/         One folder per discrete marketing campaign (NEW work goes here)
```

### `strategy/` — ARCHIVED
The original strategy/ folder (SEO engine, launch fuel, partnership spikes) was built for the indie-founder ICP and has been archived to `archive/2026-05-pre-pivot/strategy/`. A new professional-ICP strategy will be written for attorneys/CPAs/consultants under a new `strategy/` folder once the advisor review is complete.

### `playbook/`
Generic how-to docs that apply across channels and campaigns. The shared toolbox. Current contents:

| File | What it is |
|---|---|
| `MARKETING_PLAYBOOK.md` | Master entry point tying all marketing artifacts together. Critical-path timeline for pre-launch / launch day / post-launch. |
| `EMAIL_SEQUENCES.md` | 10 plain-text emails: signup → purchase → retention → refund → re-engagement |
| `REPLY_BANK.md` | Pre-staged comment replies for community discussion |

### `channels/`
Per-platform materials. Each file targets one specific channel or platform. Current contents:

| File | Channel |
|---|---|
| `PRODUCT_HUNT_LAUNCH.md` | Product Hunt — title/tagline variants, gallery captions, founder maker comment, FAQ replies, hunter outreach DM, 24h launch day timeline |
| `PH_HUNTERS.md` | Product Hunt hunter shortlist + outreach |
| `SHOW_HN_LAUNCH.md` | Hacker News — HN-format title rules, technical body, comment replies |
| `INDIE_HACKERS_LAUNCH.md` | IndieHackers — narrative format, 4-post arc (day 1, 7, 30, 90) |
| `NEWSLETTER_OUTREACH.md` | 15+ newsletter targets (BetaList, MakerNews, Console.dev, etc.) with cold pitch template |
| `REDDIT_SIDEPROJECT_POST.md` | r/SideProject + r/Entrepreneur post drafts |
| `DIRECTORY_SUBMISSIONS.md` | AlternativeTo, SaaSHub, indie-tool directories |
| `BUILD_IN_PUBLIC_TWEETS.md` | X/Twitter starter tweets and ongoing build-in-public format |

### `action-packs/`
To-do bundles scoped to a specific person or audience — the things only that person can do. Current contents:

| File | Audience |
|---|---|
| `JAMESON_ACTION_PACK.md` | The 8 things only Jameson can personally do (PH hunters, beta testers, screenshots, demo video, X account, Plausible goals, etc.) |
| `BETA_TESTER_CANDIDATES.md` | Beta tester recruitment list and outreach templates |

### `campaigns/`
**One folder per discrete marketing campaign.** This is where new work lands when starting a marketing push. Empty as of the reorg — populate this in a new session.

Suggested per-campaign structure:
```
campaigns/2026-05-relaunch/      ← example, name = YYYY-MM-<slug>
├── README.md                    Campaign goal, audience, success criteria, timeline
├── plan.md                      Week-by-week execution plan
├── copy/                        All written copy variants
├── assets/                      Asset list (images live in ~/keepance/Assets/ or website/press-kit/assets/)
├── tracking.md                  Channels touched, dates, results, links
└── retro.md                     Post-campaign retrospective (what worked, what didn't)
```

---

## Where marketing-relevant stuff lives elsewhere on disk

- **Strategy** (positioning, market analysis, competitive deep-dive): `~/keepance/docs/strategy/market-assessment-2026-04/` — read first when planning a campaign
- **Reference** (product features, competitive landscape, vision): `~/keepance/docs/reference/` — pull facts from here, don't restate
- **Live website** (blog posts, press kit, /vs pages, templates gallery): `~/keepance/website/` → deploys to `/var/www/keepance.com/`. New blog posts go in `website/blog/`.
- **Raw assets / screenshots** (images NOT yet in production):
  - `~/keepance/Assets/` — raw working images (gitignored, local only). Includes Keepance logo SVG, install screenshots, error screenshots.
  - `~/keepance/screenshots/` — ad-hoc Windows screenshots (gitignored, local only)
- **Production press-kit assets** (images already published on the website): `~/keepance/website/press-kit/assets/`
- **Sign-up data** (email lists, beta requests, bug reports): `~/keepance/sign-ups/` (gitignored)
  - `email-lists/` — campaign-collected email signups (.jsonl)
  - `bug-reports/` — incoming bug reports (.jsonl)
- **Voice rules**: see `~/.claude/projects/-home-jameson/memory/feedback_jameson_voice_profile.md` and `feedback_marketing_copy_voice.md` — bound to every public-facing draft

---

## Voice and quality bar

Every public-facing draft must adhere to the rules in:
- `feedback_jameson_voice_profile.md` (memory) — Jameson's authentic voice mined from his real writing
- `feedback_marketing_copy_voice.md` (memory) — anti-AI-tells audit
- `reference_ai_writing_tells.md` (memory) — comprehensive criteria for spotting LLM-generated copy
- `feedback_no_em_dashes.md` (memory) — NEVER use em dashes
- `feedback_link_heavy_writing.md` (memory) — every reference gets a live link
- `feedback_post_visuals.md` (memory) — every social post gets a visual

The voice-check linter at `~/services/approval-ui/scripts/voice-check.ts` enforces some of this on essay drafts.

---

## Approval workflow

Per `feedback_linkedin_approval.md` memory: never auto-post or auto-publish to social. Always draft for Jameson to review and post himself. The approval UI at `social.jameworld.com/approve` handles draft review for the broader content workflow.

---

## When to start a new campaign folder

Create `campaigns/YYYY-MM-<slug>/` when ANY of these is true:
1. You're running a coordinated push across 2+ channels
2. You're tied to a specific external event (product version launch, holiday, news cycle)
3. You're testing a hypothesis (e.g., "developers respond better to X positioning than Y")
4. The work spans more than a single day's writing

For one-off social posts, use the existing channels/ files. New campaigns are for things with a goal, a timeline, and a retrospective.

---

## Related

- Financial repository (tax/legal/business): `~/financial/` — read `08-recommendations/minimum-viable-launch.md` for the milestone-gated revenue thresholds that gate marketing-spend decisions
- Personal branding strategy (Jameson's umbrella content strategy): see `project_personal_brand_strategy.md` memory
- Postiz social media manager: `social.jameworld.com` — see `reference_postiz_social_media.md` memory
