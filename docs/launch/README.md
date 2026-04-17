# Projelli v1.5 launch pack

> Everything you need to take Projelli v1.5 from "draft release" to "launched and selling." Built overnight 2026-04-17 while you slept. Read this first; jump into the specific files as you work the steps.

---

## What's in here

| File | What it gives you | When you use it |
|---|---|---|
| `BETA_TESTER_CANDIDATES.md` | 36 real indie founders, 14 HIGH / 16 MED / 6 LOW priority, with personalized DM drafts under 500 chars each | T-7 to T-1 days before launch. Aim for 10-20 testers signed up before publish. |
| `PH_HUNTERS.md` | 15 verified Product Hunt hunters with track records + tailored DMs under 800 chars each | T-7 to T-3 days. Pick a hunter so the launch goes through someone with a real PH following. |
| `REPLY_BANK.md` | 30 pre-drafted answers to PH/HN questions (vs Obsidian, vs Notion, BYOK, pricing, founder, technical) + 5 meta-templates for awkward situations | Launch day. Ctrl-F the keyword, tweak one detail, paste-send. |
| `BUILD_IN_PUBLIC_TWEETS.md` | 14-day arc of X posts: D-3 tease, D0 launch, D+10 reflection. 2-3 variants per slot, voice-rule clean. | Pre-launch through 2 weeks post. Use the day's slot, tweak the bracket placeholders, post. |
| `LAUNCH_DAY_PLAYBOOK.md` | Hour-by-hour minute-level runbook. T-1 prep, T+0 launch (every hour 7 AM, 10 PM CT), T+1 recovery. Plus emergency playbooks (installer break, payment outage, negative thread). | Launch day itself. Tape to wall, execute. |
| `INFRA_AND_WEBSITE_AUDIT.md` | Tonight's verification of email DKIM, MX, SPF, DMARC, UptimeRobot, LemonSqueezy, broken-link sweep, sitemap regen | Reference; nothing you need to do. |

---

## Plus: the night pre-existing docs that all this builds on

(These existed before tonight and are still the source of truth for their specific topic.)

- `docs/operations/SESSION_2026-04-17_v1.5_NIGHT.md`, the v1.5 ship procedure + dogfood checklist + memory-update snippet
- `docs/features/V1_5_RELEASE.md`, per-ticket status of every Q + M item
- `docs/features/PRODUCT_HUNT_LAUNCH.md`, the structural PH launch package (titles, gallery, maker comment) from Phase 6
- `docs/features/SHOW_HN_LAUNCH.md`, the HN equivalent
- `docs/features/INDIE_HACKERS_LAUNCH.md`, the IH equivalent
- `docs/features/MARKETING_PLAYBOOK.md`, the index that ties Phase 6 marketing artifacts together
- `docs/features/JAMESON_ACTION_PACK.md`, the daytime action items still unblocked
- `docs/features/EMAIL_SEQUENCES.md`, post-purchase email flow
- `docs/features/NEWSLETTER_OUTREACH.md`, 15 newsletter targets
- `docs/reference/COMPETITIVE_LANDSCAPE.md`, side-by-side reply ammo
- `docs/strategy/market-assessment-2026-04/`, the strategic source of truth

---

## The 4-line pre-launch sequence

If you only have a week, this is the order:

1. **Day -7:** Send 5-8 hunter DMs from `PH_HUNTERS.md`. Wait for 1 confirmation.
2. **Day -5:** Send 10-15 beta tester DMs from `BETA_TESTER_CANDIDATES.md`. Get 5+ active testers.
3. **Day -3 to -1:** Post the pre-launch tweets from `BUILD_IN_PUBLIC_TWEETS.md`. Email the pre-launch list a "shipping Thursday" preview.
4. **Day 0:** Run `LAUNCH_DAY_PLAYBOOK.md` top to bottom. Use `REPLY_BANK.md` for every comment.

If you only have 48 hours, drop step 1 (self-hunt) and step 2 (skip beta, ship to public direct). Risk increases but it's still a launch.

---

## What the night-run did NOT do

These still need your hands. Listed in priority order:

1. **Dogfood `v1.5-rc.8` for at least 30 minutes.** Install on your dev machine, exercise the 4 flags, confirm no install-or-startup bugs. This is the quality gate I cannot replace.
2. **6 product screenshots on Windows** (`JAMESON_ACTION_PACK.md` item D). Drop into `website/press-kit/assets/screenshot-NN-name.png`.
3. **30-second demo video on Windows** (item E). Drop into same folder as `projelli-demo-30s.mp4` + `.gif`.
4. **3 Plausible conversion goals** (item G). Browser, 5 minutes. Goals: `Download click`, `GitHub click`, `Buy click`. Already wired in homepage JS so they fire as soon as the goals exist.
5. **Wheel Health pre-launch sanity note** (item 6 in `BOARD_ACTION_ITEMS.md`).
6. **Decide personal vs brand X account** (item F). Affects how you adapt the Day 0 launch tweet from `BUILD_IN_PUBLIC_TWEETS.md`.

Everything around these is now green. The night-run made the surface ready; you bring the trigger pulls.

---

## The 5-minute morning version

```bash
# 1. Verify night-run state
cd ~/projelli
git log --oneline release/v1.5 | head -25
git status                          # should be clean
npm run typecheck                   # silent = pass
npm run test 2>&1 | tail -3         # 781+ passing / 0 failing
gh release list --repo projelli/projelli | head -5  # rc.8 as draft

# 2. Skim what landed
ls docs/launch/
cat docs/launch/README.md           # this file
cat docs/operations/SESSION_2026-04-17_v1.5_NIGHT.md  # the ship guide

# 3. Pick your next action
#    a) dogfood rc.8 (30 min)
#    b) take screenshots + record demo (1-2 hours, Windows)
#    c) start hunter outreach (pick 3 from PH_HUNTERS.md, send DMs)
```
