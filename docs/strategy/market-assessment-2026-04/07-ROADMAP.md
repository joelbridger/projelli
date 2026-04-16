# 07 — Roadmap (6-month calendar view)

> How the recommendations in `06-RECOMMENDATIONS_BY_LOE.md` sequence against the existing 8-week launch ramp in `PROJELLI_BUSINESS_PLAN.md` and the next 6 months. Calibrated for Jameson's 5-10 hr/week side-project pace. Contains hard dates (launch day, WWDC) plus soft month-level buckets.
> Sister docs: `05-DIFFERENTIATION_STRATEGY.md` for why these bets, `06-RECOMMENDATIONS_BY_LOE.md` for what each item requires.

---

## Key dates

- **Today:** April 16, 2026
- **Launch week (Product Hunt + Show HN):** ~Week 6 of the launch ramp → **week of May 19-22, 2026** (target Tuesday May 19 or Wednesday May 20)
- **Apple WWDC 2026:** June 8-12, 2026 — risk: Apple ships AI-deep-integrated Notes
- **Q3 check-in:** July 2026 — re-audit competitive landscape (`02-COMPETITIVE_DEEP_DIVE.md`)
- **End of 6-month horizon:** October 2026

---

## Guardrails on this roadmap

Before the calendar: three principles that cap what any sprint can attempt.

1. **Pre-launch focus = polish and fix drop-offs, not new capabilities.** The product works. Launch converting that product is the job in weeks 1-6. A feature added in week 5 is a launch-day bug risk, not a launch-day win. Only Quick Wins with HIGH conversion impact belong in the pre-launch window.
2. **One Flag at a time post-launch.** Attempting M1 + M4 + M5 in parallel across a 5-10 hr/week pace is how you end up with three broken things and no shipped thing. Sequence.
3. **Leave 30% margin for support + course correction.** Launches generate 10-30 hours of unanticipated work (bug reports, comment replies, email volume, hotfixes). Don't schedule full-tilt build through the launch week.

---

## The 6-month calendar

```
Apr 2026   May 2026    Jun 2026    Jul 2026   Aug 2026   Sep 2026   Oct 2026
---------  ----------  ----------  ---------  ---------  ---------  ---------
 PRE-LAUNCH  HARD       RECOVER +  LAUNCH +2  LAUNCH +3  LAUNCH +4  LAUNCH +5
             LAUNCH     v1.1
  Q10 Q20    (wk May    Q3 Q7 Q15  M4 MCP...  M4 MCP...  M5 Canvas  M5 Canvas
  Q3 Q9      19-22)     start M1   M1 cont.              M3 memory  M6 Voice
  Q17                   M1 cont.                                     
  +buffer                                                            
```

Detailed week-by-week below.

---

## Pre-launch (now → May 22, 2026) — 5 weeks

Current state per `BACKLOG.md`: most launch-critical engineering is done. Remaining engineering ticket that's NOT an action item for Jameson personally: W2-01 test GH Actions workflow, W3-03 wire Mac notarization when Apple recovers, W4-08 release v1.2.0.

Remaining Jameson-hands items per `BOARD_ACTION_ITEMS.md` + `JAMESON_ACTION_PACK.md`: beta tester recruitment, screenshots, demo video, X posts, Plausible goals, W4-06 homepage pricing update.

### What to add to pre-launch — 4 high-impact Quick Wins

In addition to existing BACKLOG items:

| Week | New addition | Rationale | Hours |
|---|---|---|---|
| Week of Apr 20 (this week) | **Q3** (real-time cost meter) | Anchors BYOK launch story. Show HN title can include "watch your API cost live." | 4-6 |
| Week of Apr 20 | **Q9** (Haiku 4.5 default for free tier) | Sub-hour fix. Makes free-tier feel snappier. | 1 |
| Week of Apr 27 | **Q10** (template preview gallery) | Fixes #1 homepage conversion gap per marketing assessment. | 6-8 |
| Week of Apr 27 | **Q20** (API-key onboarding wizard with screenshots) | Fixes #1 first-run drop-off per VOC. | 6-8 |
| Week of May 4 | **Q17** (/vs-obsidian, /vs-notion comparison pages) | Marketing surface, SEO, direct reply content for PH/HN. | 4-6 |
| Week of May 4 | **Q19** (template fork / remix) | Optional; only if there's budget after the above | 6-8 |
| Week of May 11 | **Freeze** — only critical bug fixes | The week before launch is rehearsal + buffer, not building | — |

**Why these four Quick Wins and not others?**

- **Q3** is the single most tweet-worthy pre-launch feature. Every PH/HN comment about "yet another BYOK thing" gets the reply: *"BYOK + cost meter = you pay me $49 and see exactly how little you spend on tokens."*
- **Q10** closes the "I don't know what this does" conversion gap. The homepage lists template names; the gallery shows outputs. Direct conversion driver.
- **Q20** closes the "I don't know how to get an API key" drop-off. Every VOC source names this as the #1 BYOK onboarding friction.
- **Q17** gives Jameson pre-written `/vs-notion` and `/vs-obsidian` URLs for every comment that says "how is this different from X." Direct reply ammunition.

**Not on the pre-launch list:**

- Q7 Ollama — too risky to ship for launch day. Wire it week after launch when bugs are fine.
- Q15 Multi-model "Run on all 3" — important but not a launch-day conversion driver. Ship in v1.1.
- Q5, Q6 Audit log polish — niche. Ship later.
- Q1, Q2 Mermaid + KaTeX — important for credibility but most users won't notice their absence at launch.

### Launch week (May 19-22, 2026)

Zero new code. The week is:

- **Monday May 18:** dry run / final QA. Confirm all 9 signed installer artifacts produce. Test Windows + Mac + Linux installs. Test LemonSqueezy buy flow end-to-end.
- **Tuesday May 19 or Wednesday May 20:** Product Hunt launch (via confirmed PH hunter — per `JAMESON_ACTION_PACK.md` item B). Simultaneous Show HN.
- **Tues-Fri:** all-hands support. Reply to every PH comment in 30 min, HN in real time, email in 1 hour. This is a full-time job for the launch day plus 2-3 hours/day for the rest of the week.
- **Over the weekend:** hotfix any launch-day bugs. Post Week 7 distribution posts (IndieHackers, Reddit, AlternativeTo).

---

## Launch recovery + v1.1 (May 25 — June 30, 2026) — 5 weeks

Post-launch window is about consolidating momentum, NOT starting new flags. First month of paying customers needs:

- Bug fixes from launch week
- Reply to buyer-requested features (VOC from actual paying users > pre-launch assumptions)
- Plausible conversion analysis per BACKLOG W8-01
- Testimonial collection per BACKLOG W7-05

In parallel, ship the **second batch of Quick Wins** and **start M1**:

### v1.1 — week of May 25

- **Q7** Ollama as 4th provider (~4-6h) + **Q8** per-template model assignment (~3-4h)
  - *Release messaging:* "Privacy mode: Projelli now works fully offline with local Ollama."
- **Q15** Run-on-all-3 button (~6-8h)
  - *Release messaging:* "Pro: compare Claude, GPT, Gemini side-by-side in one click."

### v1.2 — week of June 1 - June 8

- **Q5** Audit log export (~2-3h) + **Q6** filtering (~3-4h)
- **Q1** Mermaid (~3-4h) + **Q2** KaTeX (~2-3h)
- **Q12** Smart paste URL (~2-3h) + **Q13** Image paste (~4-6h)
- **Begin M1** local RAG — set up fastembed-rs + LanceDB scaffolding (~8h in this window)

### v1.2.1 hotfix / June 8-12 — WWDC week

- **WWDC is June 8-12.** Apple may announce AI-deep-integrated Notes.
- Watch the keynote. Reply on X / HN / IH with a framed "why Projelli is the cross-platform BYOK alternative to Apple Notes + AI." Draft this reply in advance.
- Don't ship major features during WWDC week — it's noise you can't beat.

### v1.3 — week of June 15 - June 29

- **M1 continues** — incremental indexing, retrieval API, testing with 1000+ file workspaces (~16-20h across 2-3 weeks)
- **Q4** Monthly cost dashboard (~4-6h) — compounds with Q3
- **Q11** Sample workspace on first run (~3-4h)

---

## Q3 reflection + Flag 1 ship (July 2026) — 4 weeks

**Mid-point checkpoint.** Re-run the competitive audit:
- Update `02-COMPETITIVE_DEEP_DIVE.md` against July 2026 state
- Check what competitors shipped in May/June (Apple's WWDC products ship with macOS 27 / iOS 27 beta Jul-Aug, check beta signals)
- Review Plausible + LemonSqueezy data against the launch-week goals

### v1.3.5 — early July

- **Ship M2** — `@workspace` + Ask my workspace mode (~1 week). Flag 1 becomes user-visible.
  - *Release messaging:* "Ask Projelli what you wrote three months ago."
- **Ship M3** — memory facts file + extraction UI (~1-2 weeks)
  - *Release messaging:* "The AI you talk to today knows what matters to you."
- Plan demo video showing M1+M2+M3 as a combined story ("the AI workspace that remembers your stuff")

### July end: Flag 1 complete

By August 1, Projelli should have:
- Local RAG over every workspace file (M1)
- `@workspace` command + dedicated "ask my workspace" mode (M2)
- Memory facts file with fact extraction (M3)

**Marketing moment:** Blog post "How Projelli remembers what you wrote." Re-introduce Projelli on X / HN / IH. "Flag 1" becomes the category flag.

---

## Flag 2 MCP + Flag 3 Canvas (August - September 2026) — 9 weeks

### August — M4 Projelli MCP server + .mcpb bundle (~2-3 weeks)

- Build the MCP server exposing list/read/search/write of workspace files
- Package as `.mcpb` Desktop Extension
- Submit to the Official MCP Registry
- Demo: install `.mcpb` in Claude Desktop → Claude can now read your Projelli workspace.
  - *Marketing:* "Projelli is now a first-class citizen of every AI tool you use."

### Late August — start M5 side-by-side AI editing (Flag 3)

- Inline chat anchored to active document
- Streaming diff in-place
- Accept/reject per hunk
- Version history attribution

### September — M5 continues + M7 template chaining

- Polish M5 to demo-quality
- **Ship M5.** Big demo moment. Video worth making: "highlight text, say tighten, accept the change."
- **Ship M7** — template chaining — now that structured outputs are reliable (available in all 3 providers as of early 2026).
  - *Marketing:* "The workflow becomes the workspace."

---

## Flag 4 voice + polish (October 2026) — 4 weeks

### October — M6 voice input

- **Ship M6** — Parakeet.cpp integrated, press-to-talk hotkey, voice-to-note quick capture (~1-2 weeks)
- **Voice + Ollama narrative:** "Projelli, fully offline. Talk to it. No cloud. No subscription. No one sees your data."
- **Ship M8** multi-interview synthesis (~1-2 weeks) — big-value InvestorUpdate / UserInterviews enhancement

### Late October — v1.5 consolidation

- Full Q3 audit of competitive landscape
- Ship all remaining Quick Wins that slipped (Q14, Q16, Q18 if not done)
- Retrospective: what sold, what didn't, what to bet on for H1 2027
- Decide on one B-item (B1 template editor, B2 MCP client marketplace, or B3 scheduled runs) for Q4 2026 into Q1 2027

---

## What the roadmap DOESN'T commit to

Explicitly deferred past October 2026 until user signal says otherwise:

- **B1** Template editor UI — huge lift, defer until paying users explicitly ask.
- **B2** Full MCP client + marketplace — MCP server (M4) is the half that matters most; the client half can wait.
- **B3** Scheduled template runs — high-value but complex; defer until M1+M4+M5 are solid so "agents are coming" isn't a launch promise during Flag 1-3 build.
- **B4** Browser automation research agent — reliability tarpit. Ship only if voice of customer in summer 2026 makes the case.
- **B5** Prompt library with parameterization — overlaps with B1.
- **B6** Founder-voice content engine — high impact but dependent on B2 for LinkedIn/X ingestion via MCP.

These aren't NO's. They're "not in 2026."

---

## Summary: what ships in 6 months

**Pre-launch (now → May 19):** 5 Quick Wins (Q3, Q9, Q10, Q17, Q20) + optional Q19
**v1.1 (late May):** 3 Quick Wins (Q7, Q8, Q15)
**v1.2 (early June):** 6 Quick Wins (Q5, Q6, Q1, Q2, Q12, Q13) + M1 foundation
**v1.3 (mid-late June):** M1 complete + Q4, Q11
**v1.3.5 / v1.4 (July):** M2, M3 — **Flag 1 shipped**
**v1.5 (August):** M4 — **Flag 2 foundation shipped**
**v1.6 (September):** M5, M7 — **Flag 3 shipped**
**v1.7 (October):** M6, M8 — **Flag 4 shipped**

Total feature velocity: ~18-20 items shipped over 6 months, averaging ~3 per month. At a 5-10 hr/week pace, this is aggressive but achievable, especially since the Quick Wins are mostly polishing existing systems (not new capabilities) and the Mediums are sequenced so each builds on the prior.

---

## Dependencies check

Ensures nothing in the sequence blocks itself:

| Item | Depends on | Unblocks |
|---|---|---|
| Q3 (cost meter) | — | Marketing story |
| Q10 (preview gallery) | — | Sample workspace Q11, /vs pages Q17 |
| Q20 (API wizard) | — | First-run conversion |
| Q7 (Ollama) | Tauri CSP update | Flag 4 voice-+-local story |
| Q15 (run on 3) | — | Power-user demo |
| M1 (local RAG) | fastembed-rs + LanceDB working in Tauri | M2, M4, M5 (memory-aware edits) |
| M2 (@workspace) | M1 | — |
| M3 (memory facts) | — | Compounds M1/M2 |
| M4 (MCP server) | M1 (search is the killer MCP capability) | Distribution story |
| M5 (Canvas) | — | — |
| M6 (voice) | Parakeet.cpp sidecar packaged | Flag 4 narrative |
| M7 (chaining) | Structured outputs (already available in providers) | Founder-voice content B6 later |
| M8 (multi-interview) | M7 | — |

No circular deps. M1 is the keystone (gate for M2, M4, much of M5's context).

---

## How to execute this roadmap

1. **One item in progress at a time** during the pre-launch window. The launch is the forcing function; parallel work dilutes it.
2. **Two items in flight max** post-launch. One feature + one polish/bug-fix thread is the sustainable pace.
3. **Every shipped item gets:**
   - A CHANGELOG.md entry
   - A homepage/docs mention if user-visible
   - A tweet/post if it's on the "Flag N" critical path
4. **Quarterly re-audit** using `02-COMPETITIVE_DEEP_DIVE.md` as the template. Update the landscape; re-triage if a competitor shipped something that changes the calculus.
5. **Kill switch on any item that exceeds its LOE estimate by 100%.** If M1 is 2-3 weeks budgeted and at week 6 it's still broken, cut scope or reassess. Sunk-cost kills side projects.

---

## What "done" looks like at October 31, 2026

If the roadmap executes as above, the October 31 state is:

- **~20 features shipped** past v1.0.8 (today's state)
- **All 4 flags implemented** — memory, MCP, Canvas, voice
- **500-2000 paid customers** (conservative: 500 × $49 = $24K; optimistic: 2000 × average $60 = $120K lifetime)
- **Post-launch content engine running** — weekly blog posts, shipped feature announcements
- **Updated positioning documents** reflecting what worked in the wild
- **Clear signal on what B-items belong in H1 2027**

The differentiator narrative ("the AI workspace that remembers your stuff, is available in every other AI tool, edits with you side-by-side, and you can talk to offline") is fully buildable, fully demo-able, fully defensible.

---

## What could go wrong (contingency)

**If launch is a bust** (< 10 paid customers in Week 6): immediately pause Flag 1 build. Go into sales / user interview mode. Something in the pitch or product is broken; find it before building more.

**If Apple ships AI Notes with deep integration at WWDC:** re-position Mac launch copy as "the cross-platform alternative." Don't panic; Apple Notes will still be Apple-only, cloud-ish, no BYOK, no Claude/GPT/Gemini.

**If an Obsidian community plugin launches and closes the gap:** accelerate M4 (MCP server) so Projelli's differentiation shifts from "features" to "distribution" faster.

**If Jameson's day-job intensifies (Wheel Health priority changes):** cut scope on Quick Wins (defer Q1, Q2, Q12, Q13, Q14, Q16, Q18), protect the M1→M4 critical path. Flag 1 and 2 alone are enough to stand up a differentiated product.

---

## Update cadence

This roadmap should be reviewed:
- **Weekly** during pre-launch (is Q3/Q10/Q20 done? are we on track for May 19?)
- **Bi-weekly** during launch recovery (are bug reports stabilizing? is v1.1 shipping?)
- **Monthly** during build mode (July onward)
- **Quarterly** as a full document refresh

Next scheduled review: **May 1, 2026** (2 weeks pre-launch checkpoint).
