# Campaign: Projelli Launch Blast

**Slug:** `2026-04-launch-blast`
**Created:** 2026-04-28 by Claude (CEO mode)
**Status:** ACTIVE, Phase 1 in progress
**Operating principle:** No fixed launch date. Phases advance when their criteria are green.
**Owner cadence:** Claude executes server-side; Jameson executes social/identity items

---

## 1. Why this campaign exists

v1.7.2 shipped this morning. The product is paid-ready: trial system live, telemetry pipeline live, conversion-rewrite landing page live, LemonSqueezy taking real cards, all 9 platform installers signed and downloadable. Marketing arsenal is ~80% packed (channel playbooks, email sequences, press kit, blog posts, screenshots, demo videos all in place).

What's missing is **the firing of it.** This campaign sequences every channel through readiness-gated phases culminating in a coordinated 5-day hard launch, with no calendar pressure forcing a premature ship.

## 2. Definition of winning for this campaign

Per `strategy/02-launch-fuel.md`, ranked by impact on year-one revenue:

| Rank | Outcome | Target |
|---|---|---|
| 1 | Paying customers in launch week | **30-50** |
| 2 | High-quality backlinks captured | **15-25** |
| 3 | Email signups | **300-800** |
| 4 | Public testimonial / praise | **5-10** |
| 5 | Unique visitors over launch week | **5,000-15,000** |
| 6 | PH Product of the Day (top 3) | downstream |
| 7 | Show HN front page (top 5) | downstream |

We optimize for outcomes 1-4 and treat 5-7 as downstream consequences. The Founder's Launch tier ($29 lifetime, first 100 buyers) hitting 100/100 inside the launch window is the visible scoreboard.

## 3. Audience and positioning (Option B, ratified 2026-04-28)

**ICP (acquisition):** Indie founders, building-in-public solopreneurs, solo developers shipping software products. This is where we focus distribution: HN, IndieHackers, r/SideProject, founder X, indie newsletters.

**Audience (product story):** Anyone who works with AI on their own projects, founders, side-project builders, solo consultants, researchers, technical writers, anyone who pays for ChatGPT Plus or Claude Pro and wants their conversations to live in files they own.

**The split is deliberate:** founder-targeted *channels* (efficient, where we can actually reach people in 5-10 hr/wk), universal *product story* (doesn't actively exclude any buyer who finds us). Per board ratification 2026-04-28.

## 4. Phased execution (readiness-gated, no calendar dates)

### Phase 1, Engine ignition (NOW)

**Work in flight:**
- Homepage Option B implementation: universal hero/section copy, 2-3 non-founder use case proof slots, em-dash cleanup pass
- Press kit voice audit
- Soft pre-launch tweets from @projelliproject (the brand account; per `BRAND_X_LAUNCH.md` first 5 posts)
- PH hunter shortlist + DM drafts → Jameson sends 5-10
- Self-hunt backup playbook prepared (parallel path; ratified 2026-04-28)
- Beta tester DM drafts (warm + cold) + 20 license keys generated → Jameson sends 15-20 contacts
- Newsletter tier-1 cold pitches go out (BetaList, MakerNews, Console.dev)
- Directory submissions where forms allow (AlternativeTo, SaaSHub, There's An AI For That, ToolFinder)
- Soft-launch announce on r/SideProject (pre-launch tease format)
- Spots-remaining auto-decrement webhook wired
- Plausible event triggers verified (depends on Jameson Action G)

**Phase 1 → Phase 2 advance criteria (ALL must be green):**
- [ ] Homepage Option B deployed and verified live
- [ ] Press kit voice-audited
- [ ] Spots auto-decrement webhook live and tested
- [ ] @projelliproject X account active with 3+ posts published
- [ ] 5+ beta tester DMs sent by Jameson, 3+ accepted
- [ ] 5+ PH hunter DMs sent by Jameson (whether responses or not)
- [ ] Plausible conversion goals live (Jameson Action G)
- [ ] Tier-1 newsletter cold pitches sent

### Phase 2, Credibility accumulation

**Work in flight:**
- Beta cohort actively using product (target: 5-10 reaching meaningful usage)
- Build-in-public posts continue from @projelliproject; Jameson amplifies 1 from real-name account per the selective hybrid
- Blog post #1 published: `how-i-built-projelli-in-8-weeks.html`
- Demo video uploaded to YouTube (unlisted), embed updated
- Final QA pass on all installers (fresh-machine smoke test)
- Final review of PH listing copy + maker comment
- Hunter timing confirmed OR self-hunt path locked
- Pre-launch email to launch-list subscribers (T-3)
- Founder's Launch tease tweet (T-1)
- Reddit post drafts finalized for all 5 target subreddits

**Phase 2 → Phase 3 advance criteria (ALL must be green):**
- [ ] Beta cohort: 5+ users running product for 7+ days, 3+ giving substantive feedback
- [ ] PH path locked: hunter confirmed with date OR self-hunt strategy ready to execute
- [ ] License validator: 14 consecutive days green on UptimeRobot monitor 797
- [ ] All installers smoke-tested on fresh VMs (Mac aarch64, Mac Intel, Win, Linux .deb/.rpm/.AppImage)
- [ ] Demo video on YouTube and embedded in homepage hero
- [ ] PH listing finalized with hunter (or self-hunt), maker comment ready
- [ ] At least one blog post live + 1 in pipeline
- [ ] Email sequence drafts ready in Brevo for launch-day blast
- [ ] Reply bank reviewed and current

### Phase 3, Hard launch (5-day sequence)

When Phase 2 is green, the launch triggers on the **next available Tuesday**. Per `strategy/02-launch-fuel.md` § 2:

| Day | Channel | Owner |
|---|---|---|
| **Day 0 (Sun before)** | Final smoke tests, all assets staged, "launching Tuesday" email to list | Claude + Jameson |
| **Day 1 (Tue)** | PH 00:01 PT, brand X thread, email blast 08:00, real-name amplification 08:30 | Jameson + Claude |
| **Day 2 (Wed)** | Show HN 08:00 PT | Jameson |
| **Day 3 (Thu)** | IndieHackers 07:00, Reddit r/SideProject 09:00, r/Entrepreneur 12:00 | Jameson |
| **Day 4 (Fri)** | Newsletter blast 08:00, directory submissions burst | Both |
| **Day 5-6 (Sat-Sun)** | Harvest, retro, dormant-thread replies | Claude |

**Phase 3 → Phase 4 advance criteria:**
- [ ] All 5 launch-day channels published
- [ ] Daily harvest log updated through Day 5
- [ ] Retro template populated through Day 7

### Phase 4, Conversion (post-launch ~3 weeks)

- Welcome email sequence to all signups (drafted in `playbook/EMAIL_SEQUENCES.md`)
- Top-10 backlink thank-you outreach
- Email sequence emails 2-5 fire (free → Pro / Lifetime nudges)
- Founder's Lifetime tier closure announce when 100 hits
- Blog posts #2 and #3 publish
- Begin SEO content from `strategy/01-seo-engine.md`
- v1.x post-launch update ships within window
- Quote-tweets and amplification of organic mentions

**Phase 4 → Phase 5 advance criteria:**
- [ ] Welcome sequence delivering for 14+ days
- [ ] Backlink harvest complete
- [ ] First 1-2 SEO cornerstone pages published

### Phase 5, Engine 1 takes over

Per `strategy/01-seo-engine.md`. Compounding traffic. Newsletter sponsorships gated on M3 ($500+ MRR sustained 30 days). The campaign formally closes when Phase 4 is complete; ongoing work moves to monthly cadence per `strategy/06-measurement-cadence.md`.

## 5. Decisions (RESOLVED 2026-04-28)

| # | Question | Answer | Operational meaning |
|---|---|---|---|
| 1 | Hard launch date | **No fixed date.** Readiness-gated. | Phase 3 triggers on the next Tuesday after Phase 2 advance criteria all turn green. Removes calendar pressure from premature ship. |
| 2 | Build-in-public stance | **PARTIAL**, selective hybrid | @projelliproject (brand account, already set up by Jameson) carries daily marketing voice. Jameson's personal handles amplify Projelli content occasionally, at most 1-2 posts per month per platform, in the 5% project-mention slot of his personal brand strategy. Per `strategy/05-personal-brand-binding.md`. |
| 3 | PH hunter sourcing | **Both paths in parallel.** | Primary: I prep personalized hunter shortlist + DMs, Jameson sends 5-10. Backup: complete self-hunt readiness package so we can ship without a hunter. See `copy/ph-hunter-outreach.md` and `copy/ph-self-hunt-playbook.md`. |

## 6. What Claude does (autonomous)

| Track | Items |
|---|---|
| **Surface** | Homepage Option B implementation, em-dash cleanup, non-founder use case proof slots, press kit voice audit, blog post final voice review |
| **Plumbing** | Spots-remaining auto-decrement webhook, Plausible event trigger code (deploys live once Jameson sets up dashboard goals), license key generation for beta testers, daily telemetry digest verification, fresh-VM installer smoke tests where possible |
| **Drafts** | All Reddit posts (5 subreddits, 5 angles), all newsletter cold pitches (15+), PH hunter DMs (personalized per-target), self-hunt playbook, beta tester DMs (warm + cold variants), launch-day email blast, post-launch retro template, brand-voice posts for @projelliproject |
| **Channels (server-side submissions)** | Directory submissions where the form allows non-interactive submission (AlternativeTo, SaaSHub, etc.) |
| **Tracking** | Campaign tracking spreadsheet, daily harvest log structure, post-launch retrospective template |

## 7. What Jameson does (Action Pack)

Most items are pre-drafted. Jameson edits + sends. See `action-packs/JAMESON_ACTION_PACK.md` for full pre-staged drafts. Critical-path items for THIS campaign:

| Code | Action | Time | Phase |
|---|---|---|---|
| **G** | Set up 3 Plausible conversion goals (browser only) | 5 min | Phase 1 |
| **B** | DM 5-10 PH hunters | 1 hr | Phase 1 |
| **C** | DM 15-20 beta testers (warm + cold) | 2 hr | Phase 1 |
| **H** | Cadence of @projelliproject posts (drafted, Jameson posts) | 5 min/post | Phase 1+2 |
| **F** | Confirm @projelliproject handle (already done per board); share handle with Claude for copy | 1 min | Phase 1 |
| - | Real-name amplification post on launch day (1 post per month per platform max) | 10 min | Phase 3 |
| - | Submit Show HN, IH, Reddit, AlternativeTo personally on launch days | 2 hr total | Phase 3 |
| - | Reply to PH/HN/IH/Reddit comments within 1-2 hr during launch | 4-6 hr | Phase 3 |
| - | Approve any social drafts before they go live (per `feedback_linkedin_approval.md`) | ongoing | always |

**Total Jameson time investment:** ~10-12 active hours through Phase 1+2 + ~12-15 hours in launch week.

## 8. Risks (and what we do about them)

| Risk | Mitigation |
|---|---|
| Founder's Launch counter shows 100/100 on launch day | Hard launch must produce ≥10 sales day-1; manual seeding via beta-tester upgrade path if necessary |
| Show HN flagged as promotional | Use pre-cleared title/body from `channels/SHOW_HN_LAUNCH.md` verbatim; first 5 comments determine trajectory |
| PH hunter falls through last-minute | Self-hunt playbook is the fallback. Both paths prepared in parallel from Phase 1. |
| Mac unnotarized scares users | FAQ entry already in `getting-started.html`; address proactively in launch comments |
| License validator service goes down during launch | UptimeRobot monitor 797 active; pager via push; fallback offline JWT validation already built |
| Negative HN/Reddit thread snowballs | Reply early, honest, no defensiveness; never delete or edit |
| Wheel Health visibility concern surfaces | Selective hybrid model + kill switch in `strategy/05-personal-brand-binding.md` § 10 |
| Launch ships before product is ready (calendar pressure) | We removed dates. Readiness gates are the only trigger. |

## 9. Success measurement

- **Daily during launch week:** harvest log updated each evening with revenue, signups, backlinks, top quotes
- **Day 7 post-launch:** complete `retro.md` (this folder) with numbers vs targets, what worked, what didn't, lessons
- **Day 30:** campaign closure post / IH update
- **Quarterly:** this campaign feeds into the M3 review per `strategy/06-measurement-cadence.md`

## 10. Files in this folder

- `README.md` (this file), campaign goal, audience, phased execution, decisions
- `plan.md`, concrete day-by-day execution plan with owners and dependencies
- `tracking.md`, running log of channels touched, dates, results, links (filled during execution)
- `retro.md`, post-campaign retrospective (filled at Day 7 post-launch)
- `copy/ph-hunter-outreach.md`, PH hunter shortlist + personalized DM drafts (primary path)
- `copy/ph-self-hunt-playbook.md`, Self-hunt backup strategy (fallback path)
- `copy/`, additional written copy variants
- `assets/`, campaign-specific assets (production assets stay in `website/press-kit/assets/`)
- `research/`, any research / analysis specific to this campaign

## 11. Voice + approval rules

Every public-facing draft adheres to:
- `feedback_jameson_voice_profile.md`, Jameson's authentic voice (real-name posts)
- `feedback_marketing_copy_voice.md`, anti-AI-tells audit (everything)
- `feedback_no_em_dashes.md`, **NEVER** use em dashes; replace with commas or rewrite
- `feedback_link_heavy_writing.md`, every reference gets a live link
- `feedback_post_visuals.md`, every social post gets a visual

Per `feedback_linkedin_approval.md`: Claude never auto-posts to social. Always drafts; Jameson reviews and posts. This is non-negotiable for real-name posts. For @projelliproject brand posts, drafts go through the same approval channel, but the standard is "ratified by Jameson, posted by Jameson", never auto-posted by Claude.

## 12. References (the docs this campaign implements)

- `strategy/00-master-strategy.md`, the strategic spine
- `strategy/02-launch-fuel.md`, the launch sequence this campaign executes
- `strategy/04-retention-and-wom.md`, what happens to launch buyers after Day 5
- `strategy/05-personal-brand-binding.md`, the selective hybrid (PARTIAL stance)
- `strategy/07-anti-patterns.md`, re-read before any tactical change
- `strategy/08-market-sizing-and-growth-paths.md`, TAM analysis + wide-market scenario + probability assessment (added 2026-04-29 in response to "is the market big enough?")
- `strategy/09-non-paid-exposure-channels.md`, full distribution menu by ROI tier, the honest "tech reviews" answer (added 2026-04-29 in response to "best non-paid ways")
- `playbook/MARKETING_PLAYBOOK.md`, channel asset inventory
- `playbook/EMAIL_SEQUENCES.md`, 10 lifecycle emails
- `channels/PRODUCT_HUNT_LAUNCH.md`, `SHOW_HN_LAUNCH.md`, `INDIE_HACKERS_LAUNCH.md`, `REDDIT_SIDEPROJECT_POST.md`, `NEWSLETTER_OUTREACH.md`, `DIRECTORY_SUBMISSIONS.md`, `BUILD_IN_PUBLIC_TWEETS.md`, `BRAND_X_LAUNCH.md`, `JAMESON_REAL_NAME_POSTS.md`, `PH_HUNTERS.md`
- `action-packs/JAMESON_ACTION_PACK.md`, Jameson-only items
