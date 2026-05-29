# Campaign Plan, Phase-by-Phase Execution

**Operating principle:** No fixed dates. Each phase advances when its criteria are green. Day-N labels are *relative* to phase start, not calendar dates.

---

## Phase 1, Engine ignition (active NOW)

### Phase 1 deliverables

| Deliverable | Owner | Status | Dependencies |
|---|---|---|---|
| Campaign README + this plan | Claude | ✅ DONE |, |
| PH hunter strategy (dual-path) | Claude | ✅ DONE |, |
| Update PH_HUNTERS.md for v1.7.2 + Option B | Claude | TODO | Verify v1.7 features |
| Homepage Option B implementation (universal copy + em dash cleanup + non-founder use case slots) | Claude | TODO | None, surgical edits |
| Press kit voice audit | Claude | TODO | None |
| Spots-remaining auto-decrement webhook wired into license-validator | Claude | TODO | LS API key (already in env) |
| Generate 20 beta tester license keys via LS API | Claude | TODO | Beta tester strategy decision (one Lifetime each, or Pro?) |
| Plausible event triggers in homepage code (deploy-ready) | Claude | TODO | Jameson Action G to activate |
| Pre-stage Reddit posts (5 subreddits, 5 angles) | Claude | TODO | Option B copy locked |
| Newsletter cold-pitch tracker spreadsheet | Claude | TODO | None |
| Soft pre-launch r/SideProject post draft | Claude | TODO | Option B copy locked |
| @projelliproject first 3 posts queued for Jameson posting | Claude | TODO | Jameson confirms @projelliproject handle |
| Launch list pre-launch teaser email draft | Claude | TODO | None |
| Confirm @projelliproject handle exists + share with Claude | Jameson | TODO (asked) |, |
| Plausible conversion goals setup (browser) | Jameson | TODO | None, 5 min in browser |
| First 3 build-in-public posts on @projelliproject | Jameson | TODO | Drafts queued |
| DMs to first 3 HIGH PH hunters (Chris Messina, KP, Flo Merian) | Jameson | TODO | PH_HUNTERS.md updated for v1.7.2 |
| DMs to 15-20 beta testers (warm + cold) | Jameson | TODO | License keys generated |
| Tier-1 newsletter cold pitches sent (BetaList, MakerNews, Console.dev) | Jameson | TODO | Cold pitch tracker live |

### Phase 1 → Phase 2 advance criteria

ALL must be green before Phase 2 starts:
- [ ] Homepage Option B deployed and verified live
- [ ] Press kit voice-audited
- [ ] Spots auto-decrement webhook live and tested
- [ ] @projelliproject X account active with 3+ posts published
- [ ] 5+ beta tester DMs sent by Jameson, 3+ accepted
- [ ] 5+ PH hunter DMs sent by Jameson (whether responses yet or not)
- [ ] Plausible conversion goals live
- [ ] Tier-1 newsletter cold pitches sent

### Phase 1 daily harvest

Update `tracking.md` each day with:
- Number of beta tester DMs sent → accepted
- Number of PH hunter DMs sent → responses
- Newsletter pitches sent → responses
- @projelliproject posts published → engagement signals
- Email list signups (delta from yesterday)
- Telemetry events (delta from yesterday)

---

## Phase 2, Credibility accumulation

### Phase 2 deliverables

| Deliverable | Owner | Status | Dependencies |
|---|---|---|---|
| Beta cohort actively using product (5+ for 7+ days, 3+ giving substantive feedback) | Jameson | DEPENDS | Beta tester DMs from Phase 1 |
| Build-in-public posts continue from @projelliproject (3-5/week) | Jameson | DEPENDS | Drafts queued by Claude |
| First Jameson real-name amplification post (1/month max per platform) | Jameson | DEPENDS | Draft from `JAMESON_REAL_NAME_POSTS.md` |
| Blog post #1 published: how-i-built-projelli-in-8-weeks | Both | DEPENDS | Voice audit pass |
| Demo video uploaded to YouTube unlisted, embed updated on homepage | Jameson | DEPENDS | Already exists (`press-kit/assets/demo-30s-v5.mp4`) |
| Final QA pass on all installers (fresh-VM smoke tests) | Claude | DEPENDS | Time, fresh VMs available |
| Final review of PH listing copy + maker comment | Jameson | DEPENDS | PRODUCT_HUNT_LAUNCH.md |
| PH path locked (hunter confirmed OR self-hunt strategy ready) | Both | DEPENDS | Phase 1 hunter outreach complete |
| Pre-launch email to launch-list subscribers (T-3 days) | Both | DEPENDS | Email list has subscribers |
| Founder's Launch tease tweet (T-1 day) | Jameson | DEPENDS |, |
| Reddit post drafts finalized for 5 target subreddits | Claude | DEPENDS | None |
| Newsletter tier-2 pitches sent | Jameson | DEPENDS | Tier-1 response patterns inform tier-2 personalization |
| Directory submissions where possible (AlternativeTo, SaaSHub, etc.) | Both | DEPENDS | Completed assets |

### Phase 2 → Phase 3 advance criteria

ALL must be green:
- [ ] Beta cohort: 5+ users running product for 7+ days, 3+ giving substantive feedback
- [ ] PH path locked: hunter confirmed with date OR self-hunt strategy ready to execute
- [ ] License validator: 14 consecutive days green on UptimeRobot monitor 797
- [ ] All installers smoke-tested on fresh VMs (Mac aarch64, Mac Intel, Win, Linux .deb/.rpm/.AppImage)
- [ ] Demo video on YouTube and embedded in homepage hero
- [ ] PH listing finalized with hunter (or self-hunt path), maker comment ready
- [ ] At least one blog post live
- [ ] Email sequence drafts ready in Brevo for launch-day blast
- [ ] Reply bank reviewed and current

---

## Phase 3, Hard launch (5-day sequence)

When Phase 2 is green, the launch triggers on the **next available Tuesday**. The 5-day timeline is from `strategy/02-launch-fuel.md` § 2 verbatim, do not improvise.

### Day 0 (Sunday before)

- [ ] Final smoke test on Mac, Windows, Linux installers from fresh user state
- [ ] Final website QA: every link, every CTA, every legal page
- [ ] Press kit live and tested at projelli.com/press-kit/
- [ ] Email to existing launch list: "Launching Tuesday, here's what to expect"
- [ ] Founder's Launch tier ($29 lifetime, first 100) live and tested
- [ ] Plausible conversion goals confirmed firing
- [ ] All draft posts pre-staged in `channels/`
- [ ] Hunter (or self-hunt) confirmed
- [ ] All 6 screenshots in press-kit/assets/
- [ ] 30-second demo video uploaded and embedded
- [ ] Personal-brand "I'm shipping tomorrow" tweet drafted (NOT posted; for Tuesday morning)

**If any item is missing on Sunday: SLIP THE LAUNCH.** Do not launch with broken things.

### Day 1 (Tuesday), PH + announcement

| Time PT | Action |
|---|---|
| 00:01 | PH listing goes live; hunter publishes (or Jameson self-publishes) |
| 00:05 | Founder maker comment posted (from `PRODUCT_HUNT_LAUNCH.md`) |
| 08:00 | Email blast to launch list ("It's live") |
| 08:30 | Jameson real-name amplification post (X + LinkedIn; the 1/month allowed) |
| 09:00 | @projelliproject brand X live thread, 5-7 tweets walking through the product |
| All day | Reply to every PH comment within 1 hour |
| 15:00 | Mid-day update on @projelliproject X |
| 20:00 | End-of-day update: numbers + thanks |
| All day | Capture every backlink, mention, quote in `tracking.md` |

**What we do NOT do on Day 1:** Show HN, Reddit, IndieHackers, Newsletter outreach, Cold DMs.

### Day 2 (Wednesday), Show HN

| Time PT | Action |
|---|---|
| 08:00 | Show HN submission. Title + body from `SHOW_HN_LAUNCH.md` verbatim |
| First hour | Founder reply to first organic comment within 30 min. Honest, technical, willing to acknowledge limitations |
| All day | Reply to every HN comment within 2 hours during waking hours |
| All day | @projelliproject amplifies HN thread (one share, no spamming) |
| 20:00 | Update on PH listing referencing HN feedback |

**Critical:** Show HN can flag-spike negative if we come in over-promotional. Trust the playbook.

### Day 3 (Thursday), IndieHackers + Reddit

| Time PT | Action |
|---|---|
| 07:00 | IndieHackers post: "8 weeks to first paying customer" (from `INDIE_HACKERS_LAUNCH.md`) |
| 09:00 | r/SideProject post (from `REDDIT_SIDEPROJECT_POST.md`) |
| 12:00 | r/Entrepreneur post (different angle) |
| All day | Reply to every comment within 2 hours |
| All day | Capture backlinks |

### Day 4 (Friday), Newsletter + directories

| Time PT | Action |
|---|---|
| 08:00 | Cold pitches to 15+ newsletters (from `NEWSLETTER_OUTREACH.md`); track in `tracking.md` |
| All day | Submit to directories: AlternativeTo, SaaSHub, There's An AI For That, ToolFinder, Console.dev tools list. ~30 min per directory. |
| All day | Continue replying to PH/HN/IH/Reddit threads |

### Day 5-6 (Sat-Sun), Harvest + breathe

- Saturday: Compile launch week numbers in `tracking.md`. Update `retro.md` with revenue / signups / top backlinks / top quotes / surprises / non-working things.
- Sunday: Final round of replies on dormant threads. Each reply mentions the launch week number ("we hit X buyers in 5 days, thanks").

**Do NOT** announce a re-launch, feature drop, or new beat the same week. The product is launched. Let it breathe.

### Phase 3 → Phase 4 advance criteria

- [ ] All 5 launch-day channels published
- [ ] Daily harvest log updated through Day 5
- [ ] Retro template populated through Day 7

---

## Phase 4, Conversion (post-launch ~3 weeks)

### Phase 4 deliverables

| Deliverable | Owner | Status | Dependencies |
|---|---|---|---|
| Welcome email blast to all new signups | Both | DEPENDS | Phase 3 signups exist |
| Email sequence emails 2-5 fire on schedule | Brevo (auto) | DEPENDS | Sequences armed in Phase 2 |
| Top-10 backlink thank-you outreach | Jameson | DEPENDS | Backlinks captured in Phase 3 |
| Founder's Lifetime tier closure announce when 100 hits | Both | DEPENDS | Sales actually hit 100 |
| Blog post #2 publish: why-local-first-ai-for-founders | Both | DEPENDS | Voice audit |
| Blog post #3 publish: picking-the-15-founder-templates | Both | DEPENDS | Voice audit |
| First 1-2 SEO cornerstone pages from `strategy/01-seo-engine.md` | Claude | DEPENDS | Strategy doc keyword targets |
| v1.x post-launch update ("here's what I shipped in week 3") | Jameson | DEPENDS | Real feature from launch feedback |
| Quote-tweets and amplification of organic mentions | @projelliproject | DEPENDS | Organic mentions exist |
| Recruit 1-2 paying customers for first case study | Jameson | DEPENDS | Buyers willing to share |

### Phase 4 → Phase 5 advance criteria

- [ ] Welcome sequence delivering for 14+ days
- [ ] Backlink harvest complete (top 10 thanked)
- [ ] First 1-2 SEO cornerstone pages published
- [ ] First case study draft started (even if not published)

---

## Phase 5, Engine 1 takes over

This campaign formally closes when Phase 4 is complete. Ongoing work moves to monthly cadence per `strategy/06-measurement-cadence.md` and `strategy/01-seo-engine.md`.

The campaign retro (`retro.md`) is the formal handoff.

---

## Cross-cutting operating rules (apply across all phases)

1. **Voice rules apply to every public-facing draft**, see `README.md` § 11
2. **Approval rules apply to every social post**, see `README.md` § 11. Claude drafts; Jameson approves and posts. Never auto-post.
3. **Anti-patterns** in `strategy/07-anti-patterns.md` are the do-not-cross list, re-read at the start of each phase
4. **Daily harvest log** in `tracking.md` is non-negotiable, fill in even on quiet days
5. **Decision escalation:** Any tactical decision Claude can make alone, Claude makes. Anything that touches identity, money beyond what's already approved, Wheel Health, or strategic pivots goes to Jameson as a board ask
6. **Phase advance criteria are the only trigger.** No calendar pressure. No "let's just go now." If criteria aren't green, the next phase doesn't start.
