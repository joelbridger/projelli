# Projelli v1.5 launch-day playbook

> Minute-level plan for the single day you press publish on Product Hunt and Show HN at the same time. Written so you can tape it to the wall and execute without thinking. Assumes you're on Central Time (Wheel Health's timezone). If you move timezones, the clock shifts but the order and spacing do not.
>
> **Timing principle:** Product Hunt's day starts at **12:01 AM Pacific**. The HN launch goes up ~30 minutes after PH. You do NOT need to be awake at midnight PT, PH auto-publishes scheduled posts. Your real workday starts when the US East Coast wakes up, which is 7 AM CT.
>
> **Which day?** Tuesday or Wednesday. Never Monday (slow PH traffic), never Friday (weekend drop-off), never a US holiday week. Avoid June 8-12 (WWDC) and big-tech-event weeks.
>
> **Prereq:** every Jameson-only item in `JAMESON_ACTION_PACK.md` is done. Hunter confirmed. Beta testers contacted. Screenshots shot. Demo video recorded. Plausible goals set. If any of these are pending, do NOT launch, finish them first or the day burns with the engine half-built.

---

## T-1 day (the day before launch)

### Morning (8 AM, 2 hours)
- [ ] Final install smoke-test on fresh Windows VM + fresh Mac install. Record any install issue as v1.5.1 blocker.
- [ ] Tag `v1.5` final if dogfood is clean (see `docs/operations/SESSION_2026-04-17_v1.5_NIGHT.md` Step 1).
- [ ] Manually sign Windows `.exe` for updater (Step 2). Upload `.sig`.
- [ ] Patch `latest.json` (Step 3). **Don't publish yet.**
- [ ] Merge `release/v1.5` to `master` via fast-forward (Step 5).
- [ ] Run `./infra/deploy.sh`. Verify `projelli.com`, `/templates/`, `/vs/obsidian`, `/blog/projelli-1-5-announce` load.

### Midday (noon, 30 min)
- [ ] DM the PH hunter a "launching tomorrow at 12:01 PT" reminder. Include the scheduled PH URL if you have it.
- [ ] Pre-load every browser tab you'll need:
    - Product Hunt submit page (scheduled post)
    - Hacker News submit page
    - IndieHackers post draft
    - X compose window
    - Plausible dashboard
    - LemonSqueezy orders page
    - GitHub releases page
    - Email draft for the pre-launch list
- [ ] Email the pre-launch list a "we ship tomorrow" preview. Brief, 2 paragraphs, link to the blog announce post.

### Afternoon (3 PM, 1 hour)
- [ ] Write 3 backup "first comment" templates for PH (the founder-maker comment) in case the first one doesn't land well. See `REPLY_BANK.md` for tone, `PRODUCT_HUNT_LAUNCH.md` for specifics.
- [ ] Pre-compose the Show HN title. HN format: `Show HN: Projelli, desktop AI workspace (BYOK, one-time price)`. Nothing more. No emojis.
- [ ] Pre-compose 5 starter tweet variants from `BUILD_IN_PUBLIC_TWEETS.md` Day 0.
- [ ] Charge laptop. Phone. Backup phone.

### Evening (9 PM, 30 min)
- [ ] Eat dinner.
- [ ] No more work.
- [ ] Phone on do-not-disturb after 10 PM. Set an alarm for 6 AM CT tomorrow. PH is already automatically publishing at midnight PT (2 AM CT) while you sleep.

---

## T-0 day (LAUNCH DAY)

### 2:00 AM CT (PH auto-publishes)
- Asleep. PH post auto-publishes. Hunter's network and insomniacs start upvoting.

### 6:00 AM CT (you wake up)
- [ ] Check PH rank. Expected: somewhere between #4 and #15 of the day depending on hunter reach.
- [ ] Check LemonSqueezy. First 1-3 sales likely already came from timezone-shifted early risers.
- [ ] Coffee. Breakfast. Shower. **Do not reply to anything yet.** You need 20 minutes of clear head.

### 7:00 AM CT (response mode)
- [ ] Post PH-maker comment. Use `docs/features/PRODUCT_HUNT_LAUNCH.md` template. Personalize one detail to the hunter.
- [ ] Reply to every PH comment from the last 5 hours. Expect 10-30 comments waiting. See `REPLY_BANK.md` for pre-written answers. Aim for under 5-minute response windows.
- [ ] Tweet Day 0 launch tweet (variant A from `BUILD_IN_PUBLIC_TWEETS.md`). Link to PH.
- [ ] Pin that tweet.

### 7:30 AM CT (HN launch)
- [ ] Submit `Show HN: Projelli` to Hacker News. Title exactly: `Show HN: Projelli, desktop AI workspace (BYOK, one-time price)`. URL: `https://projelli.com`.
- [ ] Immediately after submitting, add the first comment (the maker comment from `SHOW_HN_LAUNCH.md`). HN counts the first comment as part of the post context.
- [ ] Tweet that HN is live (don't link directly; HN penalizes cross-promotion; just say "Show HN is up" without a URL).

### 8:00 AM CT (momentum check)
- [ ] Open Plausible. Current visitors should be in the 100-500 range. If it's in the 20s, the PH post isn't trending, think about a mid-morning boost.
- [ ] Check PH rank again. If you're top 5, start prepping the "we're #X" thank-you post.
- [ ] Reply to new PH comments. Don't batch; each reply in under 5 minutes.
- [ ] Check HN thread. Reply to any question in the first 30 minutes. Early comments on HN carry outsized weight for ranking.

### 9:00 AM CT
- [ ] Post to IndieHackers. Use `INDIE_HACKERS_LAUNCH.md` template. IH is narrative-heavy, lean into the "8 weeks to first paying customer" story, not the feature list.
- [ ] Continue replying to PH + HN. Goal: zero unreplied comments more than 30 minutes old.
- [ ] Snack. Stretch. Don't eat a full meal yet.

### 10:00 AM CT (3 hours in)
- [ ] Hour-3 stats post. Tweet the real numbers. Variant: "Projelli 1.5 at 3 hours: X upvotes, Y comments, Z sales. Thanks everyone." See `BUILD_IN_PUBLIC_TWEETS.md` Day 0 mid-morning update.
- [ ] Refresh PH. If you're not top 3, do NOT panic; PH traffic accelerates through the day as East Coast wakes up then slows through West Coast lunch. Peak position usually hits 10-11 AM PT.
- [ ] Check for bugs reported by real buyers. If any are critical (install fails, crash on launch), drop everything and triage.

### 11:00 AM CT
- [ ] If you have 5 friends you haven't poked yet, DM them now asking for a PH comment (not an upvote, a thoughtful comment). Comments drive PH ranking more than upvotes.
- [ ] If the HN thread is active, reply to 3 top-level comments with substantive responses. HN readers scroll the comments before deciding.

### 12:00 PM CT (5 hours in, peak traffic zone)
- [ ] Lunch. 30 minutes. **Step away from the computer.** Set a phone timer. Projelli does not die from 30 minutes of silence.
- [ ] When you come back: batch-reply to any comments from the break.

### 1:00 PM CT (6 hours in)
- [ ] Mid-day tweet: observation or unexpected-surprise-from-launch format. Not a stats post. Shows you're alive + thinking, not just farming engagement.
- [ ] Check Reddit r/SideProject + r/Entrepreneur. Post if you haven't already. Brief, no-hype, mention it's Show HN day if that adds context.

### 2:00 PM CT (7 hours in)
- [ ] If PH position is strong (top 5), start drafting the "Maker comment update" for PH. Include any notable reactions, specific commenter questions you answered in depth, momentum.
- [ ] Check LemonSqueezy. Count sales. If revenue > $500, that's a milestone worth naming internally. If revenue > $2000, tweet it.

### 3:00 PM CT (8 hours in)
- [ ] Second stats tweet. Variant: "7 hours in: X upvotes, Y sales. Y/X ratio is higher than I expected, which means the people coming through are buying, not just upvoting."
- [ ] Newsletter outreach: send the 5-10 newsletter pitches from `NEWSLETTER_OUTREACH.md` to editors. They'll run it tomorrow or next week, compounds the launch.

### 4:00 PM CT (9 hours in)
- [ ] East coast winding down; PH traffic shifts west coast. Keep replying but the pace slows.
- [ ] Check your inbox. Reply to beta testers, journalists, potential partners.
- [ ] If the PH hunter has engaged in the thread, DM them a thank-you.

### 5:00 PM CT (10 hours in)
- [ ] Early dinner or late lunch. Eat with family if possible, 45-minute break.
- [ ] Come back to reply-cleanup mode.

### 6:00 PM CT (11 hours in)
- [ ] Check rank. Peak PH position is usually set by 5-6 PM ET, which is 5-6 PM CT.
- [ ] Tweet the "end-of-US-workday" update. Variant: "11 hours in: peak rank was #X of the day. Still catching new comments. Replying to everything. Thank you."

### 7:00 PM CT (12 hours in)
- [ ] Slow down. Reply only to comments you can see the full thread context for. Quality > speed now.
- [ ] Eat dinner if you haven't.
- [ ] Call one friend. Don't talk about Projelli for 20 minutes. Mental break.

### 8:00 PM CT
- [ ] Tweet the end-of-day summary (Day 0 evening thanks from `BUILD_IN_PUBLIC_TWEETS.md`). Real numbers.
- [ ] Update the pre-launch email list with day-end results. 3-paragraph email. Thank, numbers, one specific moment.

### 9:00 PM CT
- [ ] Batch-reply to the last unaddressed comments on PH + HN + IH.
- [ ] Commit to the inbox being at zero by 10 PM.

### 10:00 PM CT
- [ ] Check all three threads one more time. Reply to any new comments.
- [ ] Post the "pinning this, going to sleep" tweet. Real tone: grateful but tired.
- [ ] Set alarm for 8 AM tomorrow. **Not 6. 8.** Sleep is non-negotiable.

### 11:00 PM CT
- [ ] No more checking. Phone on do-not-disturb. Laptop closed.

---

## T+1 day (Friday, launch +1)

### 8:00 AM CT
- [ ] Start with 30 minutes of quiet. Coffee. No screens.
- [ ] Check overnight stats. Expect: PH position holding or slight decline, HN thread tapered, 3-5 overnight sales.
- [ ] Reply to any new overnight comments.

### 9:00 AM CT
- [ ] Post the Day 1 overnight reflection tweet from `BUILD_IN_PUBLIC_TWEETS.md` Day 1.
- [ ] Ship v1.5.1 patch if any bugs surfaced that are fixable. Auto-updater delivers; no user action needed.
- [ ] Write 1-paragraph email to the list: overnight recap + any patch news.

### 10-5 PM CT
- [ ] Respond to anyone who DMs or emails you.
- [ ] No new launches. No new content beyond the Day 1 tweet.
- [ ] Breathe.

### Evening
- [ ] Take the whole evening off. Celebrate. Dinner with someone you care about. Back to normal work tomorrow.

---

## T+2 day (weekend after launch)

- [ ] No obligatory tasks. Browse your own traffic, see who's using the product, screenshot anything surprising.
- [ ] If you're rested: post the Saturday "using my own product" tweet from Day 2-3 of `BUILD_IN_PUBLIC_TWEETS.md`.
- [ ] Monday you start the week-2 cadence. Until then, rest.

---

## What "winning" looks like (and doesn't)

**Realistic good outcome (conservative):**
- 50-150 upvotes on PH by end of day
- Top 10 finish (not necessarily top 3)
- 80-200 comments (PH + HN + IH combined)
- 20-50 paying customers by end of day (roughly $1K-$3K revenue)
- 200-600 unique visitors to projelli.com per Plausible
- 1-3 beta testers give good feedback you bake into v1.5.1

**Realistic great outcome:**
- 300-500 upvotes on PH, top 5 finish
- HN front page for 2+ hours
- 100-300 paying customers, $5K-$15K revenue on day 1
- 1 newsletter picks it up the next day
- 1-2 inbound partnership / podcast / write-up requests

**Unrealistic but not impossible:**
- #1 of the day on PH
- Top 3 on HN for the full day
- 500+ paying customers, $25K+ revenue on day 1
- Viral tweet with 100K+ impressions

**Bad outcome:**
- Under 20 upvotes on PH (hunter didn't deliver, or launch day collided with something bigger)
- HN thread dies on page 2-3
- Under 10 paying customers

**If you hit the bad outcome:**
- Don't panic. One bad launch day doesn't kill an indie tool.
- Pause marketing posts for 24 hours.
- Analyze what went wrong specifically (wrong hunter, wrong title, wrong day, wrong hook). Write it up in a file.
- Re-launch in 2-3 weeks with the fix.
- Bad outcome is recoverable; drained + discouraged founder is the real risk.

---

## What NOT to do on launch day

- **Don't announce in multiple places in the same 20-minute window.** PH, HN, and IH stagger. Post to each one separately with 30+ min between them.
- **Don't argue with critics.** Reply calmly once with specifics; if they keep attacking, stop, don't feed it.
- **Don't promise features in comments.** "Great suggestion, I'll think about it" not "I'll add that next week."
- **Don't check rank obsessively.** Set a 20-minute timer. Check once per timer. Keeps the anxiety spiral at bay.
- **Don't drink coffee past 2 PM.** Adrenaline will keep you up regardless, but caffeine wrecks sleep and you need the sleep Friday.
- **Don't post a new tweet every 15 minutes.** Algorithm punishes it. 4-6 tweets for the whole launch day is plenty.
- **Don't promote your launch to Wheel Health coworkers unless cleared.** Stay professional with your day job.
- **Don't go for a run, a bike ride, or anything where you're offline for 2+ hours.** A 30-minute lunch walk is fine.

---

## Emergency playbook

### If the installer breaks on Windows (SmartScreen false-positive, missing DLL, etc.)
- Pin a tweet acknowledging: "Known installer issue on Windows [specific detail]. Fix in v1.5.1 rolling out in 2-4 hours. Auto-updater will deliver. New buyers: [link to manual workaround instruction]."
- Post same message on PH + HN as a comment on your own thread.
- Ship v1.5.1 same day.

### If the payment flow breaks
- Immediately tweet: "LemonSqueezy checkout flow temporarily down, troubleshooting. If you tried to buy in the last X minutes and got an error, DM me, I'll hold your slot at current price and process manually."
- Check LemonSqueezy status page. Contact support.

### If the domain / website goes down
- Check Cloudflare tunnel status on the server: `systemctl status cloudflared`. Restart if needed.
- Check Caddy: `systemctl status caddy`.
- Temporary replacement tweet: "projelli.com is temporarily down, fixing now. GitHub releases still works: [link]". Buy some goodwill by being calm.

### If negative press / viral take
- Don't respond in the first hour. Read it twice. Sleep on it if it's evening.
- If the critique is fair: thank, commit to a specific fix, link to the commit that fixes it within 48h.
- If the critique is unfair: one clear, evidence-based reply. Then stop.
- Never pile on with more replies. The internet loves escalation; don't supply it.

### If you burn out mid-day
- Close the laptop for 1 hour.
- Call one friend.
- The internet will not move without you for 60 minutes. The launch will continue.
- Return, reply to the 20 most important comments, ignore the rest.

---

## Check-in targets

Set these as expectations so you don't freak out when you see intermediate numbers:

- **Hour 3:** 40-80 upvotes PH, 20-40 HN points, 3-8 sales
- **Hour 6 (noon CT):** 80-150 upvotes, HN at 40-80 points, 8-20 sales
- **Hour 9 (3 PM CT):** 150-250 upvotes, HN peak 80-150 points, 20-40 sales
- **Hour 12 (6 PM CT):** 200-350 upvotes, HN tapered, 30-60 sales
- **Hour 14 (8 PM CT):** peak PH position set, 40-100 sales

If you're tracking 2-3x above these, you're having an exceptional day. If you're tracking 0.5x, don't panic; check the bad-outcome-plan above.

---

## Day-of kit (physical)

- Laptop charged + charger plugged in
- Phone charged + charger ready
- Water bottle, 2L
- Snacks: nuts, fruit, nothing heavy
- One real meal in the fridge you can microwave
- Noise-canceling headphones
- Alarm set for next day 8 AM
- Calendar cleared. No other meetings, no other commitments.

---

*Created 2026-04-17 night run. Don't modify on launch day; modify the week after with actual timings.*
