# 🌅 Wake-Up Brief, 2026-04-29 morning

**Read this first when you open the project today.** Single-page summary of everything that shipped overnight, what's queued, what needs your decisions, and what to do in priority order.

---

## TL;DR (90 seconds)

Phase 1 of the launch-blast campaign is **mostly complete on the autonomous side.** Site is voice-clean, Option B positioning is live everywhere, channel playbooks are pre-staged for launch week, infra is verified end-to-end. **8 of 8 Phase 1 advance criteria are within reach**, the remaining 5 unblock the moment you complete your action items.

**Current state of Phase 1 → Phase 2 advance criteria:**

| Criterion | Status | Owner |
|---|---|---|
| Homepage Option B deployed and verified live | ✅ | done |
| Press kit voice-audited | ✅ | done |
| Spots auto-decrement webhook live and tested | ✅ | done (cron firing every 5 min, 0 sales so far) |
| @projelliproject X account active with 3+ posts published | ⏳ | YOU, confirm handle, then post from queue |
| 5+ beta tester DMs sent, 3+ accepted | ⏳ | YOU, gated on Q1 below |
| 5+ PH hunter DMs sent | ⏳ | YOU, DMs ready to send |
| Plausible conversion goals live | ⏳ | YOU, 5 min in browser |
| Tier-1 newsletter cold pitches sent | ⏳ | YOU, packet ready |

**You can move us into Phase 2 in about 2-3 hours of focused work today.**

---

## 3 board questions I need answered (one-line each)

These are the only things that genuinely block my next moves. Pick them off in order.

### Q1. Beta tester give-away tier: Lifetime ($99) or Pro ($49)?

I'll create a 100%-off LemonSqueezy discount code scoped to whichever variant you pick, capped at 25 uses, 30-day expiry. Affects $1.2K (Pro) or $2.5K (Lifetime) in face-value give-aways.

**My recommendation:** Lifetime ($99). Beta testers are giving you 1-2 weeks of work + a launch-day comment in exchange. The Lifetime tier signals real appreciation. Doesn't affect Founder's Launch counter (different variant: 1506881 vs 1506887).

**Reply with one word:** `Lifetime` or `Pro`.

### Q2. @projelliproject X handle confirmation

You said it's "already set up." What's the actual handle?

- `@projelliproject` (per existing docs)
- `@projelliapp` (backup option in BRAND_X_LAUNCH.md)
- `@projelli_app`
- Something else

Once confirmed, I lock the handle into the brand-X copy queue and update the bio fields.

### Q3. BYOK math fact-check (gates @projelliproject Post 5)

Your @projelliproject queue Post 5 is the "BYOK math" tweet. Current draft says **~$229 over 3 years** for $49 Projelli + BYOK. My recalculation at midpoint $10/mo BYOK + $49 = **~$409 over 3 years**.

Tell me what your actual BYOK monthly cost runs (or what you'd be honest about in the post), and I'll lock the math + ship the visual.

---

## Top 5 actions for you today, in order

Each is a "GO", drafts are already prepared.

### 1. Plausible conversion goals (5 minutes, browser only)

Open `https://analytics.jamesondaines.com` → projelli.com → Site Settings → Goals → Add Goal. Add three goals (Custom Events):

| Goal name | Event name |
|---|---|
| Download click | `Download click` |
| GitHub click | `GitHub click` |
| Buy click | `Buy click` |

The homepage JS already fires these events (verified live). The moment you create the goals, conversion data starts populating. **5 minutes of browser work unlocks the entire launch-week measurement system.**

### 2. PH hunter DMs (1 hour)

Send DMs to the 5 HIGH-priority hunters in `~/projelli/docs/marketing/channels/PH_HUNTERS.md` (Chris Messina, KP, Flo Merian, Kevin William David, Ben Lang).

**Before each send:**
- Re-verify the hunter's most recent hunt (the personalization line references a specific past hunt, must be <60 days old)
- Replace any "v1.5 adds..." phrasing with "Projelli ships..." (per the 2026-04-28 update note at the top of the doc)
- Send 30 minutes apart (not batch-fire)

If 5 HIGH go silent in 48 hours, work the 5 MED tier. Self-hunt prep is in `copy/ph-hunter-strategy.md` if no one says yes within 10 days.

### 3. Confirm @projelliproject handle + post the first 3 brand-X posts (15 minutes)

Once you tell me the handle, I'll update the queue. Until then, you can post from `copy/projelli-posts-queue.md`:

- **Post 1 (pinned):** "Local-first AI workspace for indie founders…", pin this one
- **Post 2 (next day):** "Most AI tools either…"
- **Post 3 (day 4):** "One indie developer. Five hours a week…"

Each post is voice-clean, ~250 chars, ready to paste.

### 4. Beta tester DMs (gated on Q1, 2 hours when unblocked)

Once you confirm Lifetime or Pro for beta keys (Q1 above), I generate the discount code via LS API + give you the redemption URL. Then you send DMs from `~/projelli/docs/marketing/action-packs/JAMESON_ACTION_PACK.md` § C to:
- 2-5 Wheel colleagues NOT in your reporting chain
- 3-5 friends running side projects
- 2-3 former Samsung/AstraZeneca/Tesla colleagues
- 2-3 indie hacker / founder Twitter mutuals
- 5-10 cold DMs to indie hackers in your wider network

Target: 15-20 DMs sent, expect 8-12 to engage, 5-8 to reach meaningful usage.

### 5. Pre-launch soft tease (Phase 1 ending)

Per `copy/pre-launch-teases.md`:
- Post the r/SideProject pre-launch announcement (need 5+ helpful comments in r/SideProject from your account first per anti-pattern #19)
- Schedule the pre-launch email for T-3 (Saturday morning if launching Tuesday)
- Schedule the @projelliproject Founder's Launch tease tweet for T-1

---

## What shipped overnight (full list)

**Live changes on projelli.com:**
- Homepage Option B (universal hero + supporting copy with founder wedge)
- Press kit Option B (intro + one-paragraph descriptions)
- Em-dash sweep across homepage, press kit, all 11 blog posts, /vs/ pages, /tour, /docs, /roadmap (~285 user-facing instances removed)
- Blog "leverage" violations fixed (3 across 2 posts)
- /docs/faq + getting-started em dashes fixed
- /vs/cursor-for-writing meta description em dashes fixed
- /tour/ em dash fixed
- /roadmap/ em dashes fixed (4 user-facing, kept the percentage-column UI placeholders)
- COMPETITIVE_LANDSCAPE.md em dashes fixed (~20)
- Bulk em-dash sweep across SHOW_HN_LAUNCH, INDIE_HACKERS_LAUNCH, PRODUCT_HUNT_LAUNCH, NEWSLETTER_OUTREACH, REDDIT_SIDEPROJECT_POST, EMAIL_SEQUENCES, JAMESON_ACTION_PACK, MARKETING_PLAYBOOK, DIRECTORY_SUBMISSIONS, PH_HUNTERS (~250 instances)

**Live infrastructure changes:**
- Spots-remaining auto-decrement (Bun script + 5-min cron, polling LemonSqueezy Orders API)
- form-handler welcome email rewritten with Option B framing + voice-clean
- form-handler email-list success message updated (no longer references "v1.1 ships")
- form-handler service restarted to pick up changes
- deploy.sh patched to handle global API key vs Bearer token (Cloudflare cache purge now works)
- deploy.sh CF zone ID baked in as fallback (no more env var required)
- ~/.cloudflare-projelli-token created for deploy.sh

**Documentation + drafts created in `docs/marketing/campaigns/2026-04-launch-blast/`:**
- `README.md`, campaign goal, decisions ratified, phased execution
- `plan.md`, phase deliverables + advance criteria
- `tracking.md`, running daily harvest log (today's progress logged)
- `retro.md`, campaign retrospective template (fill in at Day 7)
- `launch-day-harvest-template.md`, per-day metrics capture template
- `copy/ph-hunter-strategy.md`, dual-path PH plan with self-hunt fallback
- `copy/reddit-posts.md`, 5 subreddits, 5 angles, voice-clean and ready
- `copy/projelli-posts-queue.md`, first 5 brand-X posts ready with cadence
- `copy/newsletter-pitches.md`, Day-4 packet with personalized pitches for 8 outlets
- `copy/pre-launch-teases.md`, r/SideProject tease + T-3 email + T-1 @projelliproject tweet + optional real-name post

**Reference doc updates:**
- `PH_HUNTERS.md`, refreshed for v1.7.2 framing (was v1.5)
- `CHANGELOG.md`, `[Unreleased]` section logged with all overnight changes

---

## Verification status (end-of-night health check)

| System | Status |
|---|---|
| Homepage live | ✅ HTTP 200, voice-clean, Option B copy verified |
| License validator service | ✅ active, /healthz returns "ok" |
| form-handler service | ✅ active (PID 180129, restarted overnight) |
| Telemetry endpoint | ✅ accepts POST, returns 200 |
| Email-list endpoint | ✅ accepts POST, returns Option B success message |
| Spots-remaining cron | ✅ firing every 5 min, log healthy, files updating |
| LemonSqueezy API | ✅ verified, 0 paid+non-test orders for variant 1506887 |
| projelli-telemetry-digest.timer | ✅ scheduled for 09:01 UTC daily |
| Cloudflare cache purge from deploy.sh | ✅ working end-to-end |
| Plausible event triggers (in homepage code) | ✅ wired (waiting on dashboard goals) |
| Brevo welcome email | ✅ wired (sent automatically on email-list signup) |
| Brevo contact-list add | ✅ wired (PROJELLI_BREVO_LIST_ID optional) |

---

## Where to find anything

| If you need… | Open this |
|---|---|
| The strategic plan | `~/projelli/docs/marketing/strategy/README.md` |
| The campaign for this push | `~/projelli/docs/marketing/campaigns/2026-04-launch-blast/README.md` |
| Day-by-day execution | `~/projelli/docs/marketing/campaigns/2026-04-launch-blast/plan.md` |
| Daily progress log | `~/projelli/docs/marketing/campaigns/2026-04-launch-blast/tracking.md` |
| What you specifically need to do | `~/projelli/docs/marketing/action-packs/JAMESON_ACTION_PACK.md` |
| All ready-to-paste copy | `~/projelli/docs/marketing/campaigns/2026-04-launch-blast/copy/` |
| Channel playbooks (PH, HN, IH, etc.) | `~/projelli/docs/marketing/channels/` |
| Email lifecycle sequences | `~/projelli/docs/marketing/playbook/EMAIL_SEQUENCES.md` |
| Competitive ammo for replies | `~/projelli/docs/reference/COMPETITIVE_LANDSCAPE.md` |
| The 22 anti-patterns to re-read before any tactical change | `~/projelli/docs/marketing/strategy/07-anti-patterns.md` |
| The CHANGELOG with full overnight diff | `~/projelli/CHANGELOG.md` |

---

## What I did NOT do (and why)

- ❌ **Did not generate beta tester license keys.** Blocked on Q1 above. Generating the discount code touches money and external state; wanted your sign-off on tier first.
- ❌ **Did not commit any of this to git.** Per CLAUDE.md instruction, only commit when explicitly requested. Want your review of the campaign artifacts first. Run `git status` in `~/projelli/` to see the diff. If it looks right, the suggested commit message is at the bottom of this brief.
- ❌ **Did not post to any social account.** Per `feedback_linkedin_approval.md`, Claude drafts, Jameson posts. All drafts are queued in `copy/`.
- ❌ **Did not update the PH_HUNTERS.md per-hunter DM bodies.** They still say "v1.5 adds…" in each hunter's individualized DM. The fix is described in the doc's top note (replace v1.5 phrasing on the fly when you send each one). Rewriting all 15 individualized DMs would have been busywork given the personalization layer needs your eyes anyway.
- ❌ **Did not pivot any product strategy or pricing.** All decisions remain as ratified in PROJELLI_BUSINESS_PLAN.md and `strategy/`.

---

## Suggested git commit (when you've reviewed)

If the overnight work looks good and you want to commit:

```bash
cd ~/projelli
git add -A
git commit -m "$(cat <<'EOF'
Marketing: Option B positioning live + launch-blast campaign artifact

Implements board-ratified Option B (founder wedge + universal product
story) across homepage, press kit, /docs/, /vs/, /tour, /roadmap, and
all 11 blog posts. Removes ~285 user-facing em dashes site-wide and
~250 across launch-critical channel docs (PH, HN, IH, Newsletter,
Email Sequences, Reddit, etc.). Fixes 3 "leverage" voice-rule
violations.

Adds spots-remaining auto-decrement (Bun script + 5-min cron polling
LemonSqueezy Orders API). Patches deploy.sh CF cache purge to work
with the global API key (was Bearer-only) and bakes in the zone ID.

Rewrites form-handler welcome email with Option B framing and updates
the launch email-list success message (was outdated "v1.1 ships" copy).
Service restarted to pick up changes.

Lands new campaign artifact at docs/marketing/campaigns/2026-04-launch-blast/
covering the readiness-gated execution plan for the hard launch:
README, plan.md, tracking.md, retro.md, launch-day-harvest-template.md,
plus copy/ subdirectory with PH hunter strategy (dual-path with self-hunt
backup), 5 Reddit post drafts, first 5 @projelliproject brand-X posts queued,
newsletter cold-pitch packet, and pre-launch tease drafts.

No app changes. Updated CHANGELOG.md [Unreleased] section.
EOF
)"
```

---

## What's next once you complete your 5 actions today

When the 5 Phase 1 actions are done, we hit Phase 2 advance criteria. Phase 2 is roughly 7-10 days of:
- Beta cohort actively using the product (your 5+ DMs accepted give us this)
- Build-in-public posts continuing on @projelliproject
- First Jameson real-name amplification post (1-of-2 monthly slots)
- Blog post #1 publishing (`how-i-built-projelli-in-8-weeks`, voice-clean, ready)
- Demo video upload to YouTube (the asset already exists at `press-kit/assets/demo-30s-v5.mp4`)
- Final QA pass on all installers from fresh VMs
- PH hunter timing locked OR self-hunt path activated
- License validator 14-day uptime green (we're on day 5 of consecutive green per UptimeRobot 797, comfortably on track)

Then Phase 3 (the 5-day hard launch sequence) triggers on the next available Tuesday.

**No calendar pressure.** We move when ready.

---

*Brief assembled overnight by Claude (CEO mode). Coffee, then Q1, then start the timer.*
