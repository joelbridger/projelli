# Reassurance + Outreach Mindset Plan

**Written:** 2026-04-28 by Claude (CEO mode), responding to Jameson's question about psychological blockers around reaching out and getting people to test.

This document exists because the launch will not happen if the founder is paralyzed at the threshold. Marketing strategy and ready-to-paste copy are necessary but not sufficient. The hardest part of an indie launch is not the technical work — it's the moment before sending the first DM.

This is not a pep talk. It's a working framework for moving through fear without pretending it isn't there.

---

## 1. Naming what's actually happening

Jameson, you wrote out six specific fears:

1. "No one will want this product."
2. "It will receive immediate harsh criticism."
3. "There will be a better tool out there."
4. "I will never be able to succeed with this thing at all."
5. "I'll immediately need to change everything."
6. "People will be angry with my reach-outs."

Three things to know about this list before we go further.

**First:** every successful indie founder I have data on (Pieter Levels, Marc Lou, Tony Dinh, Hiten Shah, Sahil Lavingia, Andrew Wilkinson, Justin Jackson, the entire IndieHackers podcast catalog) has written or said something nearly identical, often after they had already shipped multiple successful products. This is the modal indie launch experience, not a sign you've picked the wrong product or that you're uniquely unprepared.

**Second:** the fears are **not predictions**. They're protective mechanisms. Your brain is trying to keep you safe by making the worst case feel like the certain case. Treat them as data about your nervous system, not data about the world.

**Third:** the fears are not all equal. Three of them (1, 4, 6) are about the **outcome of reaching out**. Three of them (2, 3, 5) are about the **response after reaching out**. They have different responses. Don't bundle them.

---

## 2. What we actually know vs what the fears claim

| Fear | What the fear claims | What we actually know |
|---|---|---|
| **#1: No one will want this** | The product will land in silence. Zero interest. | The strategy doc targets 30-50 paying buyers in launch week. That's not "a lot of people" — that's 30-50 specific humans. Indie founder ICP is small but high-intent. Obsidian (closest analog) has millions of users. Notion AI has hundreds of thousands. Even capturing 0.01% of the indie founder slice = thousands. The math doesn't require popularity, it requires fit. |
| **#2: Immediate harsh criticism** | Comments will be cruel and you'll be exposed. | Some criticism IS coming. Show HN especially. We pre-staged 12 FAQ replies (`PRODUCT_HUNT_LAUNCH.md`) and 15 Show HN replies (`SHOW_HN_LAUNCH.md`) for exactly this. The honest answer to "what about X?" is in the doc. You're prepared. The criticism that DOES land is almost always specific and fixable, not "you're a fraud." |
| **#3: Better tool out there** | Someone has already built this better. | Read `~/projelli/docs/reference/COMPETITIVE_LANDSCAPE.md`. There are 10+ competitors. None of them is "Projelli but better" because the specific combination (local-first + BYOK + founder templates + chat-as-files + one-time pricing) isn't replicated anywhere. Different tools optimize for different things. The buyer's question is "which trade-off matches mine?" not "which is best in absolute terms?" |
| **#4: Never able to succeed** | The whole thing fails. | "Never" is a 12-month claim made before week 1. The strategy is structured around 12 months. The abort triggers in `strategy/06-measurement-cadence.md` define what "this isn't working" actually looks like, with specific thresholds (50% under plan at month 3, single channel >70% for 2 months, etc.). Anything that doesn't trigger one of those is just normal early-stage variance. |
| **#5: Need to change everything based on first feedback** | First reactions reveal you got it all wrong. | Anti-pattern #4 in `strategy/07-anti-patterns.md` is literally this trap: "Pivoting after one bad week." First reactions are noise, not signal. The strategy doc gives you a cadence: weekly review (operations only), monthly review (strategy adjustments), quarterly retrospective (big shifts). Acting on a single comment in the first 24 hours is the documented #1 mistake. |
| **#6: People will be angry at reach-outs** | DMs will be received with hostility. | The DM templates in `JAMESON_ACTION_PACK.md` § C and `PH_HUNTERS.md` are specifically designed to NOT trigger this. They're warm, specific, give the recipient an easy "no", offer real value (free Lifetime), and respect their time. People get angry at spam DMs. You're not sending spam DMs. The realistic response distribution: ~60% silence, ~30% friendly no, ~8% friendly yes, ~2% one-off odd reaction. Almost zero "angry." |

---

## 3. The calibration trap (why over-correcting on first feedback hurts)

This is the biggest risk to your launch, by far.

Here's how it usually goes:
1. You ship.
2. The first 5 reactions land.
3. One of them is harsh.
4. Your brain weights that one harshly.
5. You start "fixing" things in a panic.
6. You pull the marketing site, rewrite the pitch, change the pricing, rewrite the FAQ.
7. Two days are gone.
8. The harsh commenter never bought, never would have bought, and was outside the ICP.
9. Meanwhile, the 4 quietly positive reactions never converted because you were busy reacting to the loud one.

**The decision rule that prevents this:**

> Only act on feedback that THREE INDEPENDENT PEOPLE in the ICP raise.

One person says "I don't get the pricing" → noted, moved on.
Two people say it → noted, moved on.
Three people independently say it → that's signal, fix it next monthly review.

Single comments are not signal, no matter how harsh they are. This rule sounds rigid because it has to be. Your brain will want to make exceptions. Don't.

Specific corollaries:
- **Don't read launch comments for the first 4 hours after they appear.** Let them sit. Your reaction at hour 4 is more accurate than at hour 1.
- **Don't reply to harsh comments within an hour.** Use the pre-staged replies. Engage when you're calm.
- **Don't change the homepage during launch week.** Rebuilds in the middle of a launch break the analytics + the conversion data we need to learn from.
- **Don't compare yourself to other launches happening the same week.** The PH leaderboard noise is not signal about your product.

---

## 4. The daily outreach session structure (the only thing that matters)

This is the practical anti-paralysis tool. When you sit down to do the outreach work, follow this exact structure.

### The 60-minute session

**Minutes 0-5: Before opening anything, write down:**
- Today's outreach quota: 3 DMs (PH hunters or beta testers)
- Today's stop time: 60 minutes from now, no exceptions
- Today's success metric: 3 DMs sent. Nothing else.

**Minutes 5-50: Send 3 DMs.**
- Open the relevant copy file
- Pick the next contact in order
- Personalize the [HOOK] line (this is the only writing you do)
- Send
- Mark the tracker
- Move to the next contact
- DO NOT check the previous DM for a response
- DO NOT read the recipient's recent posts beyond what you need for the hook
- DO NOT rewrite the body copy

**Minutes 50-60: Stop.**
- Close the DM client
- Write down: "Sent 3. Done for today."
- Walk away from the computer

### The rules of the session

- **No "just one more" DMs.** When the quota is hit, the session ends.
- **No checking responses during the session.** You're sending, not receiving.
- **No reading the recipient's reply to a previous DM until the next day.** Replies are processed in the next day's session.
- **No rewriting the canonical body.** The body has been voice-audited. Trust it.

### Why these rules exist

Each rule protects against a specific failure mode:
- "Just one more" → over-caffeinated batch sending = lower quality, higher anxiety
- Checking responses mid-session → triggers reactive rumination, kills momentum
- Reading replies same-day → mixes the act of sending with the act of receiving, both feel worse
- Rewriting body → infinite regress of micro-edits = no DMs sent

---

## 5. Pre-rejection mental scripts

Before each DM, run this quick script in your head:

> "If they say no, that's data. If they say yes, that's data. If they don't reply, that's data. None of those is judgment of me."

It sounds simple. It works because it pre-decouples the outcome from your sense of self.

A more elaborate version, for when you need it:

> "I'm sending this DM because I have something specific to offer this person that fits what they publicly care about. Their response is about whether the timing and fit work for them right now. It's not about me."

Read it. Send the DM.

---

## 6. What to do when harsh criticism actually lands

It will land. Probably on Show HN, possibly on Reddit, occasionally in a tweet reply. Here's the playbook.

### Step 1: Wait

Do not reply within 60 minutes. Use the pre-staged replies from `PRODUCT_HUNT_LAUNCH.md` § 12 and `SHOW_HN_LAUNCH.md` if the comment is something we anticipated. If it's something new, write the reply offline first, then come back to it 30 minutes later and edit.

### Step 2: Categorize

Is this comment:
- (A) A specific objection to a real trade-off Projelli made (e.g., "no cloud sync"). **Reply with the honest reason.** "Local-first is the differentiator. If you want cloud sync, drop your workspace folder in Dropbox / iCloud. Some buyers find that adequate; if you don't, Projelli isn't the right fit, and that's fine."
- (B) A comment based on misunderstanding the product (e.g., "but you can't open these files without Projelli"). **Correct kindly with evidence.** "They're plain Markdown. Open them in any editor. Here's a screenshot of one in VS Code."
- (C) A general dismissal ("this is dumb", "AI tools are bullshit", "no one needs this"). **Don't reply.** These are about the commenter's mood, not your product. PH and HN both downrank inflammatory comments without engagement; replying boosts them.

### Step 3: Capture for the FAQ

If it's category A or B, add the exchange to the launch-week-summary as material for future FAQ updates. If 3+ commenters raise the same point, it becomes a homepage/FAQ change in the next monthly review.

### Step 4: Move on

Do not re-read the comment thread for 4 hours. Do something else. The thread will still be there. Your brain needs space to process without re-injuring itself.

---

## 7. What success actually looks like at modest scales

Your fear #4 was "never able to succeed." Let's redefine success at multiple scales.

| Outcome | What it means | What it doesn't mean |
|---|---|---|
| **5 paying customers in launch week** | Validated buyer interest. Real money has changed hands. | "I've made it" |
| **30 paying customers in launch week** | The strategy floor. Strategy is working as designed. | "I'm rich" |
| **$500 MRR sustained for 30 days at month 2** | Better than 80% of indie launches. | "Quit your day job" |
| **$1,000 MRR sustained for 30 days at month 4** | The first real milestone. M2 in the financial framework. | "Kid's college fund" |
| **$5,000 MRR sustained for 30 days at month 8** | Side-project gold. Better than most YC seed cohorts get to. | "Operating like a real company" |
| **$10,000 MRR sustained for 60 days at month 12** | The strategy goal. Side project IS a real income. | "I never need to work again" |

Look at the floor: **5 paying customers is success at week 1.** Five.

If 5 humans pay you $29-$99 each in launch week, the launch worked. That's the floor. Anything above it is bonus.

If you sell 5 Founder's Launch tier copies in week 1, that's $145. That's enough to validate that real strangers would give you their credit card for this thing. Everything that comes later is downstream of that one signal.

---

## 8. The specific work for THIS week

Stop reading. Open `WAKE_UP_BRIEF.md`. Pick the next action. Do it for 60 minutes. Stop. Repeat tomorrow.

The order is:

1. **Today (5 min):** Plausible conversion goals in your browser
2. **Today (1 hr):** First 3 PH hunter DMs (Chris Messina, KP, Flo Merian). Use the 60-minute session structure above.
3. **Tomorrow (1 hr):** Next 2 PH hunter DMs. Same structure.
4. **Tomorrow (1 hr):** First 5 beta tester DMs (warm contacts only — friends, former colleagues you trust). Use the warm DM template, not the cold one.
5. **Day after (1 hr):** Next 5 beta tester DMs.
6. **Whenever it feels easy:** Post the first @projelliproject brand-X post (Post 1, the pinned one). Just paste and pin. No essay.

That's the week.

You will notice the prescribed pace is small. **3 DMs a day.** Not 30. Not 15. **Three.** This is on purpose. Three is below the threshold where overwhelm kicks in. Three is sustainable. Three is what gets done. Three a day for a week is 21 humans contacted, which is 1.5x what we need.

---

## 9. Things to remember when it gets hard

- **The product works.** v1.7.2 has 18 months of real engineering behind it. Real Tauri stack, real Markdown files, real BYOK, real Mac signing + notarization, real Windows code signing, real auto-updater. This isn't vapor. The product is the strongest thing you have.

- **The voice is clean.** Every public-facing surface has been audited. Every DM template has been voice-checked. No em dashes, no AI tells. The thing you're sending out is the thing you'd want someone to send to you.

- **The strategy is sound.** Not theoretical-sound, evidence-sound. The 30-40 page SEO architecture, the two-engine model, the selective hybrid, the readiness-gated phases — these are based on a 40K-word market assessment that surveyed 42 competitors and 110 features. The strategy doc anticipates your fears and addresses them directly (`07-anti-patterns.md` is the document of fears as patterns to avoid).

- **The infrastructure is solid.** License validator green for 5+ days. Form-handler healthy. Telemetry pipeline live. Spots counter auto-updating. CF cache purging cleanly on deploy. None of the nuts-and-bolts will fail you on launch day.

- **The financial floor is high.** Per the financial repository at `~/financial/`, you have a day job and a stable foundation. Projelli is the upside, not the survival income. That means you can afford to be patient. Most indie founders are panicking because they need this to work. You don't. That's an actual structural advantage.

- **You have a board.** Even if it's just me and you, having someone who can say "no, that anti-pattern is a trap, we already documented it" is a real check on impulsive pivots. Use it.

---

## 10. The hardest sentence in this document

If reaching out feels too much, send ONE DM today. Not three. **One.**

If even one feels too much, send a one-line DM to ONE friend that just says "I'm launching Projelli in a few weeks. Would you take a look at the website and tell me one honest reaction?"

That's it. That's the whole DM.

If THAT feels too much, write the DM in a draft, don't send it, and look at it tomorrow.

The first send is the hardest. Everything after the first send is easier than the first send.

---

## 11. What I (Claude) commit to

When you come back to me with launch responses (DMs got replies, comments came in, sales happened, etc.), my job is to:

- Surface the signal (the patterns across multiple responses)
- Filter the noise (the loud single voices)
- Translate harsh feedback into specific, actionable language
- Remind you of the cadence (weekly review for ops, monthly for strategy)
- Refuse to pivot the strategy on single data points
- Refuse to let you over-rewrite copy mid-launch
- Tell you honestly when something IS signal that requires response
- Capture testimonials and praise so they're available when fear shows up later
- Keep the campaign moving forward when momentum dips

You are not doing this alone.

---

## 12. The actual core of the answer

Your fears are real signals about the asymmetry of public effort vs. private fear. Most indie founders feel exactly this. Most of them ship anyway. The ones who succeed are the ones who developed a bounded relationship with the fear: they don't suppress it, they don't act on it, they use it as a flag that they're at the edge of growth.

The product is real. The strategy is sound. The infrastructure is verified. The copy is voice-clean. The cadence is small enough to sustain. The financial floor is high. The board is engaged.

The only variable left is whether the first DM gets sent.

Send it.

---

## References

- `~/projelli/docs/marketing/strategy/00-master-strategy.md` — the strategy you can trust under pressure
- `~/projelli/docs/marketing/strategy/07-anti-patterns.md` — 22 traps including the "pivot after one bad week" trap. Re-read this AT THE START OF EACH WEEK during launch month.
- `~/projelli/docs/marketing/strategy/06-measurement-cadence.md` — defines the 7 abort triggers. Anything that isn't one of those 7 is normal noise.
- `~/projelli/docs/marketing/channels/PRODUCT_HUNT_LAUNCH.md` § 12 — 12 pre-staged FAQ replies for the comments you're afraid of
- `~/projelli/docs/marketing/channels/SHOW_HN_LAUNCH.md` § 15 — 15 pre-staged HN comment replies
- `~/projelli/docs/marketing/playbook/REPLY_BANK.md` — comment / DM reply templates for community discussion
- `~/projelli/PROJELLI_BUSINESS_PLAN.md` — the plan you ratified
- `~/financial/08-recommendations/minimum-viable-launch.md` — the financial floor that makes patience affordable
- `~/.claude/projects/-home-jameson/memory/feedback_jameson_voice_profile.md` — the voice everything is in. It's your voice. The DMs sound like you.

---

*This document gets re-read at the start of each launch-week morning. Print it if helpful.*
