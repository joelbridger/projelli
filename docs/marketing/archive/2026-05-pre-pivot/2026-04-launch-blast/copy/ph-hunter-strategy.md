# PH Hunter Strategy, Dual-Path Plan

**Per board ratification 2026-04-28:** Run hunter outreach AND self-hunt prep in parallel. Whichever path is ready first when Phase 2 advance criteria turn green is the path we take. We do not single-thread on a hunter.

---

## Path A, Hunter outreach (PRIMARY)

**Canonical shortlist + per-hunter personalized DMs:** `~/projelli/docs/marketing/channels/PH_HUNTERS.md`

That doc has:
- 15 hunters tiered HIGH (5) / MED (5) / LOW (5)
- Personalized DM drafts for each (with `[HOOK]` slots already filled)
- Operating rhythm (3 HIGH on day 1 spaced 30 min apart; wait 48 hr; next batch on day 3)
- Closing-the-loop rules (the moment one says yes, message every open thread)
- Status log table at the bottom (fill in as DMs go out)

**Updates needed before Jameson sends (Phase 1 task, Claude does this):**
1. **Version:** PH_HUNTERS.md currently references v1.5. Update to v1.7.2 (current shipped version) where relevant. The v1.5 features cited (memory/RAG, MCP server, Canvas-style editing) need fact-check against current product, some shipped, some may be deferred. Verify against `~/projelli/CHANGELOG.md` and adjust DM language.
2. **Positioning (Option B):** The DMs lean heavily on "for indie founders." Soften where natural to allow universal product story without losing the founder wedge. Don't over-rewrite, the hunters in this list are themselves founder-adjacent, so the founder framing is fine for the pitch context.
3. **Re-verify recent hunts:** Before Jameson sends, re-check each hunter's most recent activity (the DMs reference specific past hunts; if those are >60 days old by send time, they fall flat). 30 minutes of refresh per hunter.

**Operating procedure (Jameson):**
1. Day 1 of Phase 1: send 3 HIGH-priority DMs spaced 30 min apart (Chris Messina → KP → Flo Merian). Tuesday-Thursday, 9-11am their local time. Track in PH_HUNTERS.md status log.
2. Wait 48 hours. Most yes responses arrive in this window.
3. Day 3 of Phase 1: send next 3 (Kevin William David → Ben Lang → Nichole Elizabeth DeMeré or Hiten Shah depending on response patterns).
4. Day 5: if no yes yet, work the MED tier.
5. Day 7: if still no yes, send to LOW tier.
6. Day 10: if zero yes responses, **switch to Path B (self-hunt) per advance criterion.**

**Trigger to advance Phase 2 → Phase 3 with hunter:** at least one hunter has confirmed in writing AND we've sent them the press kit + screenshots + maker comment 3 days before launch.

## Path B, Self-hunt (BACKUP, fully prepared from Day 1)

PH officially supports self-hunting since 2024 and a meaningful share of indie launches in 2025-2026 have been self-hunted (per PH_HUNTERS.md research). The signal lift loss is real but recoverable with the prep below.

### What we need to be self-hunt-ready

| Asset | Status | Owner |
|---|---|---|
| @jamesondaines (or chosen handle) PH profile filled out: bio, photo, linked sites | UNVERIFIED | Jameson, confirm + complete |
| projelli.com link in PH profile | UNVERIFIED | Jameson |
| Maker comment finalized in `channels/PRODUCT_HUNT_LAUNCH.md` | DRAFTED, needs Jameson review | Jameson |
| 6 gallery captions finalized | DRAFTED in `channels/PRODUCT_HUNT_LAUNCH.md` | Jameson |
| 10-15 "engaged comment friends" primed from beta cohort + IH circle | NOT STARTED | Jameson (Phase 2) |
| PH support pre-notification email | NOT STARTED | Claude drafts, Jameson sends |
| Demo video uploaded YouTube unlisted | UPLOADED per asset capture pipeline | confirmed |

### The self-hunt operating sequence

**T-7 days (Phase 2 work):**
- Confirm Jameson's PH profile is complete and looks credible (bio, photo, projelli.com URL, jamesondaines.com URL, GitHub link, X handle). Empty profiles tank first-hour momentum because people click through to verify.
- Recruit 10-15 beta-tester / IH-circle / X-circle people who have **actually used Projelli** and will leave **substantive** comments in the first 3 hours. Not "great launch!", comments that name a feature they used and one they wished worked differently. These replace the hunter's primed audience.

**T-3 days (Phase 2 → Phase 3):**
- Send `hello@producthunt.com` a polite email confirming Jameson plans to self-hunt his own product. Rajiv Ayyangar (PH CEO) has a public position that self-hunting is welcome, but a 48-hour heads-up email catches any account-status issues.

**T-2 days:**
- Final review of the maker comment with Jameson (per `channels/PRODUCT_HUNT_LAUNCH.md`). The maker comment does ~30% more work in a self-hunt because there's no hunter framing to warm the audience. Make sure paragraph 1 says WHY Jameson built it (the personal anecdote), paragraph 2 says WHAT it is (concrete + technical), paragraph 3 names ONE thing he wants help with (gives commenters a job).

**T-0 (launch Tuesday, 12:01 AM PT):**
- Jameson submits Projelli from his own PH account.
- **Within 60 seconds:** Jameson posts the maker comment from the same account. PH algorithm weighs this heaviest in the first hour.
- Within 5 minutes: 2-3 of the primed friends start commenting substantively.
- Brand X account (@projelliproject) posts the launch thread immediately.
- Email blast to launch list within 15 minutes.

### Self-hunt anti-patterns (do not do)

1. **Do not buy upvotes / hire "guaranteed top-5" services.** PH detects them. Permanent delist.
2. **Do not coordinate friends to upvote in a Slack/Discord burst.** Detected by clustering analysis. Same outcome.
3. **Do not pretend the self-hunt is hunter-driven** by adding "thanks to @hunter for hunting!" with no real hunter. Cleaning the truth shows up in audits.
4. **Do not delete or edit the maker comment** mid-launch. Visible in PH's edit history.
5. **Do not respond to negative comments defensively.** Engage honestly: "fair point, here's the trade-off I made and why."

### Realistic self-hunt outcome (per PH_HUNTERS.md research)

| Outcome | Hunted (HIGH-tier) | Hunted (MED-tier) | Self-hunt (good prep) | Self-hunt (weak prep) |
|---|---|---|---|---|
| Day-1 upvotes | 200-500 | 100-250 | 80-200 | 20-60 |
| Day rank | top 5 | top 10 | top 10 | unranked |
| Site visitors | 500+ | 300+ | 200+ | 50 |

**The gap between HIGH-tier hunted and well-prepped self-hunted is ~30-50% on day-1 upvotes.** That's real but not campaign-killing. A self-hunted launch with strong beta-tester comments + good email list + brand account amplification can still produce the 30-50 paying customers that define this campaign's success.

## Decision rule (when Phase 2 ends)

When Phase 2 advance criteria are otherwise green:

| Hunter status | Action |
|---|---|
| ≥1 hunter confirmed with date | Path A. Schedule launch on hunter's next available Tuesday. |
| ≥3 DM threads still open after 10 days | Wait one more business day, then commit to self-hunt. |
| Zero responses across full 15-hunter list after 10+ days | Self-hunt on next available Tuesday. |
| Hunter says yes but timing pushes >2 weeks out | Negotiate or self-hunt, don't slip the launch for one hunter. |

**Default if uncertain:** Self-hunt. The campaign should not stall waiting for a hunter beyond the readiness window.

## Why parallel preparation matters

Without parallel prep:
- Single point of failure (one hunter falls through, scramble for 5 days)
- Sunk-cost bias (we already invested in Path A; switching feels like loss)
- Worse self-hunt execution because we did it as a panic-pivot

With parallel prep:
- Path A is the upside if it lands, Path B is the floor if it doesn't
- Switching is mechanical, not emotional
- Self-hunt prep work (PH profile completeness, primed beta commenters) is **wasted on neither path**, it improves Path A outcomes too because hunter-driven launches still benefit from a strong founder profile and primed audience.

## References

- `~/projelli/docs/marketing/channels/PH_HUNTERS.md`, the canonical 15-hunter shortlist with personalized DMs
- `~/projelli/docs/marketing/channels/PRODUCT_HUNT_LAUNCH.md`, submission fields, maker comment, gallery captions, 24-hour timeline, 12 anticipated FAQ replies
- `~/projelli/docs/marketing/strategy/02-launch-fuel.md` § 6, full launch readiness gates
- `~/projelli/docs/marketing/action-packs/JAMESON_ACTION_PACK.md` § B, original PH hunter outreach action item with template
